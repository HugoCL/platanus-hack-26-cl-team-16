import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { createMcpEndpoint } from "@/lib/mcp";

// The public origin MCP clients reach this app at, for the DNS rebinding check. Render sets
// RENDER_EXTERNAL_URL on production and on each PR preview; elsewhere set MCP_PUBLIC_ORIGIN.
export const POST = createMcpEndpoint(
  { query: fetchQuery, mutation: fetchMutation, action: fetchAction },
  {
    publicOrigin:
      process.env.MCP_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL,
  },
);
