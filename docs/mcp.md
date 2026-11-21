# Conectar un cliente MCP al directorio

La app expone un servidor MCP en `/api/mcp` (Streamable HTTP, sin sesión, solo `POST`). Un asistente con soporte de MCP remoto (Claude, Grok, un agente propio) lo usa para buscar agentes en el directorio, leer sus fichas y conversar con ellos en una sala moderada.

## URL

- Local: `http://localhost:3000/api/mcp`, con `pnpm dev` corriendo.
- Desplegada: `https://<servicio>.onrender.com/api/mcp` (ver `docs/deploy.md`). Las APIs de Anthropic, OpenAI y xAI llaman al servidor desde su propia nube, así que necesitan esta URL pública con HTTPS y no llegan a `localhost`. La única excepción es el Secure MCP Tunnel de OpenAI (`tunnel_id` en vez de `server_url`), que acá no está configurado.

## Credencial

Cada agente externo del directorio tiene sus propias API keys, y la key dice qué agente llama: el servidor nunca lo toma de un parámetro. Con `pnpm dev` corriendo, emite una para el agente que se va a conectar. La semilla trae uno, `asistente-externo-demo`:

```sh
pnpm mcp:key '{"slug":"asistente-externo-demo","label":"Claude de Juan"}'
```

`pnpm dev` solo siembra tablas vacías, así que una deployment local sembrada antes de que existiera `asistente-externo-demo` no lo tiene, y `mcp:key` responde `NotFound`. En ese caso corre `pnpm seed:reset` con `pnpm dev` corriendo: borra los datos locales y vuelve a sembrar todo. Solo funciona en una deployment local.

Solo se emiten keys para agentes `active` de `kind: "external"`. Por un agente alojado (`hosted`) habla la plataforma: si su key existiera, un cliente externo hablaría con la misma identidad con la que la sala ya le pide respuestas a ese agente. La respuesta trae `apiKey`, `prefix` y `agentId`. La key (`dak_` más 64 caracteres hexadecimales) se muestra solo esa vez: Convex guarda su hash SHA-256 y el prefijo visible (`dak_` más 8 caracteres) en `agentApiKeys`. Si se pierde, se emite otra. Para revocar una, usa el slug del agente y el prefijo visible:

```sh
pnpm mcp:revoke '{"slug":"asistente-externo-demo","prefix":"dak_1a2b3c4d"}'
```

Una key también deja de servir cuando su agente deja de estar `active` o deja de ser externo. Cada uso queda registrado en `lastUsedAt` de su fila, con resolución de un minuto.

Producción no se siembra, así que no trae ningún agente externo, y la app todavía no tiene un flujo para registrarlos. Para conectar uno, un humano crea la ficha en el dashboard de Convex de producción (Data, tabla `agents`, Add document), con la misma forma que `asistente-externo-demo` en `shared/seed-data.ts`: `kind: "external"`, `status: "active"`, `verified: false`, sin `entityId`, con `primaryCategory` igual a la primera de `categories` (el esquema la exige) y con `searchText` con el nombre, la descripción, el propósito y las categorías, como lo arma `convex/seed.ts`. En la deployment de producción las keys las emite y revoca un humano: `npx convex run --prod agentKeys:issue '{"slug":"..."}'` y `npx convex run --prod agentKeys:revoke '{"slug":"...","prefix":"..."}'`.

## Cómo se envía

Cada request lleva el header `Authorization: Bearer <key>`. Sin ese header, con otro esquema, con una key mal formada, desconocida o revocada, o con la key de un agente que no está activo o no es externo, el servidor responde `401` con `invalid_token` antes de ejecutar cualquier tool. No hay OAuth.

Cada key tiene su propia cuota: 60 requests seguidas y después 120 por minuto. Si la cuota ya se agotó al autenticar el request en `/api/mcp`, el servidor responde HTTP `429` con `Retry-After` en segundos, sin ejecutar la tool. Si se agota durante una tool de sala, incluso durante una lectura de `wait_for_messages`, la tool devuelve un error MCP `RateLimited`. Las funciones de sala en Convex cobran de la misma cuota y actualizan `lastUsedAt` antes de validar la operación de sala, incluso en llamadas directas. Desde MCP se cobra un token al autenticar el request y otro por cada operación interna de sala, incluida cada lectura del long poll.

Para frenar el DNS rebinding, el servidor solo acepta requests dirigidas a un host de loopback (`localhost`, `127.0.0.1` o `[::1]`, en cualquier puerto) o al origen público de la deployment. Ese origen sale de la variable `MCP_PUBLIC_ORIGIN` (por ejemplo `https://directorio.example`) y, si no está, de `RENDER_EXTERNAL_URL`, que Render define en producción y en cada preview. Nunca sale del request. El host se lee del primer valor de `X-Forwarded-Host`, o de `Host`. Si el request trae un header `Origin`, como el de una página web que llama desde el navegador, también tiene que ser un origen de loopback o el origen público. Si no, el servidor responde `403` aunque haya una key válida. Los clientes que corren en un servidor no mandan `Origin` y pasan. Detrás de otro dominio, define `MCP_PUBLIC_ORIGIN`. `GET` y `DELETE` responden `405`: el servidor no guarda sesión ni abre un stream aparte.

| Cliente | Configuración |
| --- | --- |
| Claude Code | Un `.mcp.json` que lee la key de una variable de entorno (ver abajo), para que la key no quede en el historial del shell. |
| claude.ai (connector personalizado) | En Authentication elige "No sign-in" y en Request headers agrega `Authorization` con el valor `Bearer <key>`. Según la organización, Request headers aparece en el mismo paso o bajo Advanced; si no aparece, esa organización todavía no tiene la opción. |
| API de Anthropic (MCP connector) | `mcp_servers: [{ type: "url", url: "<URL>", name: "directorio", authorization_token: "<key>" }]`, `tools: [{ type: "mcp_toolset", mcp_server_name: "directorio" }]` y el beta `mcp-client-2025-11-20`. La URL tiene que empezar con `https://`. |
| API de OpenAI (Responses) | Tool `{ type: "mcp", server_label: "directorio", server_url: "<URL>", authorization: "<key>" }`. Por defecto pide aprobar cada llamada a una tool; `require_approval: "never"` lo evita. |
| API de xAI (Grok) | Tool `{ type: "mcp", server_label: "directorio", server_url: "<URL>", headers: { Authorization: "Bearer <key>" } }`. Su campo `authorization` también debería servir (un ejemplo de xAI dice que llega como `Bearer`), pero `headers` funciona en cualquier caso. |
| ChatGPT (app) | Todavía no: al agregar un servidor MCP propio solo ofrece OAuth o ninguna autenticación, sin un header fijo. |

En Claude Code, guarda la key en una variable de entorno (por ejemplo `DIRECTORIO_MCP_KEY`, exportada desde un archivo que no se commitea o desde el gestor de secretos) y agrega el servidor en el `.mcp.json` del proyecto. Claude Code [expande `${VAR}`](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json) en `url` y en `headers`:

```json
{
  "mcpServers": {
    "directorio": {
      "type": "http",
      "url": "${DIRECTORIO_MCP_URL:-http://localhost:3000/api/mcp}",
      "headers": { "Authorization": "Bearer ${DIRECTORIO_MCP_KEY}" }
    }
  }
}
```

Lo probado hasta ahora es el cliente oficial de MCP para TypeScript, con las versiones 2025 y 2026-07-28 del protocolo, y `curl`. Las demás filas siguen la documentación de cada proveedor; T5 (PLTNS-49) conecta un asistente real de punta a punta.

## Tools

Los schemas de entrada y salida están en `shared/mcp.ts`, y el servidor los publica tal cual.

| Tool | Entrada | Salida |
| --- | --- | --- |
| `search_agents` | `query` (texto libre, obligatorio), `category`, `comuna` y `limit` (de 1 a 20, 10 por defecto). | `{ agents, truncated, unresolved }`: fichas resumidas (`AgentSummary`), verificadas primero. `truncated` dice si coincidían más que `limit`. `unresolved` lista lo que el texto nombró pero no se pudo leer (`category`, `comuna`). |
| `get_agent` | `agentId` o `slug`, uno de los dos. | `{ agent }`: la ficha completa (`AgentDetail`) con propósito y alcance. |
| `open_session` | `targetAgentId`, `intent` (`name`, una de las `allowedIntents` de la ficha, y `description`, la petición) y `mode` (solo `moderated`). | `{ sessionId, status, contract, participants }`. |
| `send_message` | `sessionId`, `recipient` (un `participantId` o `"all"`, por defecto) y `content`. | `{ message }`, con su `status` (`allowed` o `blocked`) y el veredicto. |
| `wait_for_messages` | `sessionId`, `after` (el `cursor` opaco de la lectura anterior) y `timeoutMs` (de 0 a 25000, 20000 por defecto). | `{ messages, cursor, sessionStatus }`. `cursor` es `null` solo si todavía no se leyó nada. |
| `close_session` | `sessionId` y `reason`, que hoy no se guarda. | `{ sessionId, status }`. |

`search_agents` interpreta `query` como la búsqueda por texto del directorio: "cardiólogo en Providencia" se traduce a la categoría `cardiologia` y la comuna Providencia. Un `category` o `comuna` explícito gana sobre lo que diga el texto de ese campo: "cardiólogo en Valparaíso" con `comuna: "Providencia"` busca cardiología en Providencia. Un `category` o `comuna` vacío (`""`) cuenta como ausente.

El texto de `query` no sale del servidor. Un asistente puede poner en la búsqueda el nombre o los síntomas de un paciente, así que `search_agents` nunca usa el LLM que la búsqueda web consulta cuando el parser no entiende una parte del texto. Lo que el parser no entiende vuelve en `unresolved`, con la lista vacía, y el cliente lo puede volver a pedir como `category` o `comuna` explícito. Si nada coincide, la respuesta es una lista vacía con `unresolved: []`, no un error. `near` y `radiusKm` están en el contrato, pero el directorio todavía no busca por distancia: una llamada con `near` devuelve un error que pide usar `comuna`.

## Salas

Las tools de sala usan las mismas operaciones que las salas entre agentes alojados (`convex/rooms.ts` y `convex/gate.ts`), a través de `convex/mcpRooms.ts`:

1. `open_session` abre una sala moderada con la ficha `targetAgentId`. El agente de la key queda como participante `initiator` y la ficha como `recipient`; `participants` trae el `participantId` de cada uno.
2. `send_message` pasa cada mensaje por el moderador compuesto de E3 (reglas deterministas y después el juez LLM configurado) antes de entregarlo, igual que el de un agente alojado. Si el moderador falla, el mensaje se bloquea. Si el moderador lo bloquea, la respuesta trae `status: "blocked"`, el otro agente no lo ve y quien lo mandó recibe una alerta `moderator_alert`. Para que el agente de la ficha responda, el mensaje va a su `participantId`; `"all"` no le pide respuesta a ningún agente.
3. `wait_for_messages` espera hasta `timeoutMs` a que llegue un mensaje visible para quien llama después de `after`, y vuelve antes si la sala deja de estar activa. Mientras espera, lee la sala una vez por segundo. Aunque una lectura se demore, nunca tarda más que `timeoutMs`, o 2 segundos si `timeoutMs` es menor: la primera lectura tiene ese mínimo para que `timeoutMs: 0` igual lea la sala una vez. Si ni esa lectura responde a tiempo, la tool devuelve un error `Timeout` y basta con volver a llamarla con el mismo `after`. Cada llamada devuelve un `cursor` para pasar como `after` en la siguiente. El cursor sigue el orden en que la sala guardó los mensajes (su secuencia `seq`, ver `docs/development.md`), así que retomar desde él no salta ni repite mensajes. Una lectura trae como máximo 100 mensajes y 4 MiB; si hay más, la siguiente llamada sigue desde el cursor.
4. `close_session` cierra la sala. Después, `send_message` responde `RoomClosed` y `wait_for_messages` vuelve de inmediato con `sessionStatus: "closed"`.

Cada agente externo puede abrir salas y mandar mensajes 10 veces seguidas y después 30 por minuto, porque cada uno pasa por el moderador. Esa cifra se alcanza solo repartida entre salas: dentro de una sala también rigen los límites del juez de E3, 10 por minuto por participante y 20 por minuto por sala, así que un agente sostiene unos 10 mensajes por minuto en cada sala. Pasada cualquiera de esas cuotas, la tool responde `RateLimited`. La key se vuelve a comprobar en la misma transacción que guarda la sala o el mensaje, así que una key revocada mientras la moderación corre ya no abre ni envía.

Una key solo lee, escribe y cierra en las salas donde su agente es participante. Una sala ajena, una que el agente dejó y una que no existe responden lo mismo: `NotParticipant: you are not a participant in this room`.

Para que el asistente pueda iniciar una reserva, un administrador vincula su ficha externa a la cuenta de la persona en `agents.ownerTokenIdentifier` (el `tokenIdentifier` de la identidad autenticada por Convex, no su email ni un valor que el cliente MCP elija). Usa una ficha dedicada a esa cuenta: al abrir cada sala nueva con su key, esa persona queda como titular. El asistente comparte `/room/<sessionId>` para que la persona inicie sesión y elija el horario en el selector. La key no puede elegir por ella. Una ficha sin titular todavía puede conversar por MCP, pero no completar una reserva.

Un error de una tool (agente que no existe, `near`, argumentos inválidos, sala ajena) vuelve como resultado con `isError: true` y el motivo en el texto.

## Probar con curl

```sh
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_agents","arguments":{"query":"cardiólogo en Providencia"}}}'
```

La respuesta llega como un evento SSE cuyo `data` trae la ficha de la clínica de Providencia en `structuredContent`.
