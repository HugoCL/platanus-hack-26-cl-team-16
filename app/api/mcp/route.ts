import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { createMcpEndpoint } from "@/lib/mcp";

export const POST = createMcpEndpoint({
  query: fetchQuery,
  mutation: fetchMutation,
  action: fetchAction,
});
