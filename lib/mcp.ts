import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

// Next builds request.url from the address it listens on, so the public origin comes from the
// proxy's forwarded headers when there are any.
function crossOrigin({ headers, url }: Request) {
  const origin = headers.get("origin");
  if (origin === null) return false;
  const own = new URL(url);
  const proto = headers.get("x-forwarded-proto") ?? own.protocol.slice(0, -1);
  const host =
    headers.get("x-forwarded-host") ?? headers.get("host") ?? own.host;
  return origin !== `${proto}://${host}`;
}

export function createMcpEndpoint() {
  const handler = createMcpHandler(
    () =>
      new McpServer(
        { name: "directorio-agentes", version: "0.1.0" },
        { capabilities: { tools: {} } },
      ),
  );
  return async (request: Request) => {
    if (crossOrigin(request)) {
      return new Response("Origin not allowed", { status: 403 });
    }
    return handler.fetch(request);
  };
}
