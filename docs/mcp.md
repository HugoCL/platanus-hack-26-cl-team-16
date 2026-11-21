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

Solo se emiten keys para agentes `active`. La respuesta trae `apiKey`, `prefix` y `agentId`. La key (`dak_` más 64 caracteres hexadecimales) se muestra solo esa vez: Convex guarda su hash SHA-256 y el prefijo visible (`dak_` más 8 caracteres) en `agentApiKeys`. Si se pierde, se emite otra. Para revocar una, pon `revokedAt` en su fila de `agentApiKeys` desde el dashboard de Convex; la fila se reconoce por el prefijo. Una key también deja de servir cuando su agente deja de estar `active`.

En la deployment de producción la key la emite un humano: `npx convex run --prod agentKeys:issue '{"slug":"..."}'`.

## Cómo se envía

Cada request lleva el header `Authorization: Bearer <key>`. Sin ese header, con otro esquema, con una key desconocida o revocada, o con la key de un agente que no está activo, el servidor responde `401` con `invalid_token` antes de ejecutar cualquier tool. No hay OAuth.

Un request con un header `Origin` distinto del origen público del servidor (esquema, host y puerto), como el de una página web ajena que llama desde el navegador, recibe `403` aunque traiga una key válida. Detrás de un proxy, el origen público sale de `X-Forwarded-Proto` y `X-Forwarded-Host`. Los clientes que corren en un servidor no mandan `Origin` y pasan. `GET` y `DELETE` responden `405`: el servidor no guarda sesión ni abre un stream aparte.

| Cliente | Configuración |
| --- | --- |
| Claude Code | `claude mcp add --transport http directorio <URL> --header "Authorization: Bearer <key>"` |
| claude.ai (connector personalizado) | En Authentication elige "No sign-in" y en Request headers agrega `Authorization` con el valor `Bearer <key>`. Según la organización, Request headers aparece en el mismo paso o bajo Advanced; si no aparece, esa organización todavía no tiene la opción. |
| API de Anthropic (MCP connector) | `mcp_servers: [{ type: "url", url: "<URL>", name: "directorio", authorization_token: "<key>" }]`, `tools: [{ type: "mcp_toolset", mcp_server_name: "directorio" }]` y el beta `mcp-client-2025-11-20`. La URL tiene que empezar con `https://`. |
| API de OpenAI (Responses) | Tool `{ type: "mcp", server_label: "directorio", server_url: "<URL>", authorization: "<key>" }`. Por defecto pide aprobar cada llamada a una tool; `require_approval: "never"` lo evita. |
| API de xAI (Grok) | Tool `{ type: "mcp", server_label: "directorio", server_url: "<URL>", headers: { Authorization: "Bearer <key>" } }`. Su campo `authorization` también debería servir (un ejemplo de xAI dice que llega como `Bearer`), pero `headers` funciona en cualquier caso. |
| ChatGPT (app) | Todavía no: al agregar un servidor MCP propio solo ofrece OAuth o ninguna autenticación, sin un header fijo. |

Lo probado hasta ahora es el cliente oficial de MCP para TypeScript, con las versiones 2025 y 2026-07-28 del protocolo, y `curl`. Las demás filas siguen la documentación de cada proveedor; T5 (PLTNS-49) conecta un asistente real de punta a punta.

## Tools

Los schemas de entrada y salida están en `shared/mcp.ts`, y el servidor los publica tal cual.

| Tool | Entrada | Salida |
| --- | --- | --- |
| `search_agents` | `query` (texto libre, obligatorio), `category`, `comuna` y `limit` (de 1 a 20, 10 por defecto). | `{ agents }`: fichas resumidas (`AgentSummary`), verificadas primero. |
| `get_agent` | `agentId` o `slug`, uno de los dos. | `{ agent }`: la ficha completa (`AgentDetail`) con propósito y alcance. |

`search_agents` interpreta `query` como la búsqueda por texto del directorio: "cardiólogo en Providencia" se traduce a la categoría `cardiologia` y la comuna Providencia. Un `category` o `comuna` explícito gana sobre lo que diga el texto de ese campo: "cardiólogo en Valparaíso" con `comuna: "Providencia"` busca cardiología en Providencia. Un `category` o `comuna` vacío (`""`) cuenta como ausente.

Cuando el parser no entiende una parte del texto que no vino explícita, el directorio le pregunta a un LLM, con una cuota compartida por todo el sitio (10 seguidas y después 30 por minuto). Si la cuota se agota, la tool responde con un error. Con `category` y `comuna` explícitos nunca se usa la cuota. Si una parte del texto sigue sin interpretarse, o nada coincide, la respuesta es una lista vacía y no un error. `near` y `radiusKm` están en el contrato, pero el directorio todavía no busca por distancia: una llamada con `near` devuelve un error que pide usar `comuna`.

Un error de una tool (agente que no existe, `near`, argumentos inválidos, cuota del LLM agotada) vuelve como resultado con `isError: true` y el motivo en el texto.

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
