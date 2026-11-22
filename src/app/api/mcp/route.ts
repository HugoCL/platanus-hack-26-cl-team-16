import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { createMcpEndpoint } from "../../../../lib/mcp";
import { clerkMcpOauth, mcpPublicOrigin } from "../../../../lib/mcp-clerk";

// The public origin is also what the DNS rebinding check compares against.
export const POST = createMcpEndpoint(
  { query: fetchQuery, mutation: fetchMutation, action: fetchAction },
  { publicOrigin: mcpPublicOrigin(), oauth: clerkMcpOauth() },
);
