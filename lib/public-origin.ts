export function publicOrigin(request: Request) {
  return new URL(
    process.env.MCP_PUBLIC_ORIGIN ||
      process.env.RENDER_EXTERNAL_URL ||
      request.url,
  ).origin;
}
