# Conectar un cliente MCP al directorio

La app expone un servidor MCP en `/api/mcp` (Streamable HTTP, sin sesión, solo `POST`). Un asistente con soporte de MCP remoto (Claude, Grok, un agente propio) lo usa para buscar agentes en el directorio y leer sus fichas. Las tools de sala (`open_session`, `send_message`, `wait_for_messages` y `close_session`) llegan con T4 (PLTNS-48). El servidor solo anuncia las tools que funcionan, así que hoy un cliente ve dos.

## URL

- Local: `http://localhost:3000/api/mcp`, con `pnpm dev` corriendo.
- Desplegada: `https://<servicio>.onrender.com/api/mcp` (ver `docs/deploy.md`). Las APIs de Anthropic, OpenAI y xAI llaman al servidor desde su propia nube, así que necesitan esta URL pública con HTTPS y no llegan a `localhost`. La única excepción es el Secure MCP Tunnel de OpenAI (`tunnel_id` en vez de `server_url`), que acá no está configurado.

## Credencial

Cada agente del directorio tiene sus propias API keys, y la key dice qué agente llama: el servidor nunca lo toma de un parámetro. Con `pnpm dev` corriendo, emite una para el agente que se va a conectar:

```sh
pnpm mcp:key '{"slug":"mi-agente-juan","label":"Claude de Juan"}'
```

Solo se emiten keys para agentes `active`. La respuesta trae `apiKey`, `prefix` y `agentId`. La key (`dak_` más 64 caracteres hexadecimales) se muestra solo esa vez: Convex guarda su hash SHA-256 y el prefijo visible (`dak_` más 8 caracteres) en `agentApiKeys`. Si se pierde, se emite otra. Para revocar una, usa el slug del agente y el prefijo visible:

```sh
pnpm mcp:revoke '{"slug":"mi-agente-juan","prefix":"dak_1a2b3c4d"}'
```

Una key también deja de servir cuando su agente deja de estar `active`. Cada uso queda registrado en `lastUsedAt` de su fila, con resolución de un minuto.

En la deployment de producción las keys las emite y revoca un humano: `npx convex run --prod agentKeys:issue '{"slug":"..."}'` y `npx convex run --prod agentKeys:revoke '{"slug":"...","prefix":"..."}'`.

## Cómo se envía

Cada request lleva el header `Authorization: Bearer <key>`. Sin ese header, con otro esquema, con una key mal formada, desconocida o revocada, o con la key de un agente que no está activo, el servidor responde `401` con `invalid_token` antes de ejecutar cualquier tool. No hay OAuth.

Cada key tiene su propia cuota: 60 requests seguidas y después 120 por minuto. Pasada la cuota, el servidor responde `429` con `Retry-After` en segundos, sin ejecutar la tool.

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

`search_agents` interpreta `query` como la búsqueda por texto del directorio: "cardiólogo en Providencia" se traduce a la categoría `cardiologia` y la comuna Providencia. Un `category` o `comuna` explícito gana sobre lo que diga el texto de ese campo: "cardiólogo en Valparaíso" con `comuna: "Providencia"` busca cardiología en Providencia. Un `category` o `comuna` vacío (`""`) cuenta como ausente.

El texto de `query` no sale del servidor. Un asistente puede poner en la búsqueda el nombre o los síntomas de un paciente, así que `search_agents` nunca usa el LLM que la búsqueda web consulta cuando el parser no entiende una parte del texto. Lo que el parser no entiende vuelve en `unresolved`, con la lista vacía, y el cliente lo puede volver a pedir como `category` o `comuna` explícito. Si nada coincide, la respuesta es una lista vacía con `unresolved: []`, no un error. `near` y `radiusKm` están en el contrato, pero el directorio todavía no busca por distancia: una llamada con `near` devuelve un error que pide usar `comuna`.

Un error de una tool (agente que no existe, `near`, argumentos inválidos) vuelve como resultado con `isError: true` y el motivo en el texto.

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
