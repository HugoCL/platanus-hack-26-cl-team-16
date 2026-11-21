import { fetchQuery } from "convex/nextjs";
import { createMcpEndpoint } from "@/lib/mcp";

export const POST = createMcpEndpoint({ query: fetchQuery });
