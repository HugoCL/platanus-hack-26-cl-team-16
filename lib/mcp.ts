import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

function crossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (
    origin !== null && URL.parse(origin)?.host !== new URL(request.url).host
  );
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
