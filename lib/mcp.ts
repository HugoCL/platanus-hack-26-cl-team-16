import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import type { z } from "zod";
import { api } from "../convex/_generated/api";
import {
  type GetAgentInput,
  MCP_TOOLS,
  type McpToolName,
  type SearchAgentsInput,
} from "../shared/mcp";

export type ConvexCaller = {
  query<Q extends FunctionReference<"query">>(
    query: Q,
    ...args: OptionalRestArgs<Q>
  ): Promise<FunctionReturnType<Q>>;
  action<A extends FunctionReference<"action">>(
    action: A,
    ...args: OptionalRestArgs<A>
  ): Promise<FunctionReturnType<A>>;
};

type Tool<N extends McpToolName> = (typeof MCP_TOOLS)[N];
type ToolRun<N extends McpToolName> = (
  input: z.output<Tool<N>["input"]>,
) => Promise<z.input<Tool<N>["output"]>>;

const BEARER = /^Bearer\s+(\S+)$/i;

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

function registerTool<N extends McpToolName>(
  server: McpServer,
  name: N,
  run: ToolRun<N>,
) {
  const {
    description,
    input,
    output,
  }: {
    description: string;
    input: StandardSchemaWithJSON;
    output: z.ZodType<Record<string, unknown>>;
  } = MCP_TOOLS[name];
  server.registerTool(
    name,
    { description, inputSchema: input, outputSchema: output },
    async (args) => {
      const structuredContent = output.parse(
        await run(args as z.output<Tool<N>["input"]>),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );
}

// E1 has no distance search, so `near` is refused instead of ignored.
async function searchAgents(
  convex: ConvexCaller,
  { query, category, comuna, limit, near }: z.output<typeof SearchAgentsInput>,
) {
  if (near) {
    throw new Error("near is not supported yet: filter by comuna instead");
  }
  const { agents } = await convex.action(api.directory.searchText, {
    query,
    category,
    comuna,
    limit,
  });
  return { agents };
}

async function getAgent(
  convex: ConvexCaller,
  { agentId, slug }: z.output<typeof GetAgentInput>,
) {
  const agent = await convex.query(api.directory.get, { agentId, slug });
  if (!agent) {
    throw new Error(`No listed agent has that ${slug ? "slug" : "agentId"}`);
  }
  return { agent };
}

export function createMcpEndpoint(convex: ConvexCaller) {
  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: "directorio-agentes", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    registerTool(server, "search_agents", (input) =>
      searchAgents(convex, input),
    );
    registerTool(server, "get_agent", (input) => getAgent(convex, input));
    return server;
  });
  return async (request: Request) => {
    if (crossOrigin(request)) {
      return new Response("Origin not allowed", { status: 403 });
    }
    const apiKey = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
    if (
      !apiKey ||
      !(await convex.query(api.agentKeys.authenticate, { apiKey }))
    ) {
      return bearerAuthChallengeResponse(
        new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Missing or invalid API key",
        ),
      );
    }
    return handler.fetch(request);
  };
}
