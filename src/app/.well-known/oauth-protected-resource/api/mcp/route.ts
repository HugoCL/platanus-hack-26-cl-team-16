import { clerkMcpOauthConfig } from "../../../../../../lib/mcp-clerk";
import { protectedResourceMetadata } from "../../../../../../lib/mcp-oauth";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

// RFC 9728 metadata for the MCP endpoint: an OAuth client reads it after a 401 to find Clerk.
export function GET() {
  const config = clerkMcpOauthConfig();
  return config
    ? Response.json(protectedResourceMetadata(config), { headers: CORS })
    : new Response("OAuth is not configured", { status: 404, headers: CORS });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
