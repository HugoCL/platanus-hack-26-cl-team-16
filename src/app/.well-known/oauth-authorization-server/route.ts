import { clerkMcpOauthConfig } from "../../../../lib/mcp-clerk";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

// Older MCP clients look for the authorization server's metadata on the MCP server's own origin
// instead of following RFC 9728, so this relays Clerk's.
export async function GET() {
  const config = clerkMcpOauthConfig();
  if (!config) {
    return new Response("OAuth is not configured", {
      status: 404,
      headers: CORS,
    });
  }
  const upstream = await fetch(
    `${config.issuer}/.well-known/oauth-authorization-server`,
    { cache: "no-store" },
  );
  if (!upstream.ok) {
    return new Response("Authorization server is unavailable", {
      status: 502,
      headers: CORS,
    });
  }
  return Response.json(await upstream.json(), { headers: CORS });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
