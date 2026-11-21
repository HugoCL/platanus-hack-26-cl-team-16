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
import { isApiKeyFormat } from "../convex/agentKeys";
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
  mutation<M extends FunctionReference<"mutation">>(
    mutation: M,
    ...args: OptionalRestArgs<M>
  ): Promise<FunctionReturnType<M>>;
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

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function toUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// DNS rebinding guard from the MCP spec: the host the client used and the Origin a browser sends
// must be loopback or the deployment's public origin. The allowed values come from configuration,
// never from the request, because a rebound page sends an Origin and a Host that match each other.
// A chain of proxies lists several hosts in X-Forwarded-Host; the first is the one the client used.
function allowedRequest(
  { headers, url }: Request,
  publicOrigin: string | undefined,
) {
  const publicUrl = publicOrigin === undefined ? null : toUrl(publicOrigin);
  const host = toUrl(
    `http://${
      headers.get("x-forwarded-host")?.split(",")[0].trim() ??
      headers.get("host") ??
      new URL(url).host
    }`,
  );
  if (
    !host ||
    (!LOOPBACK.has(host.hostname) && host.host !== publicUrl?.host)
  ) {
    return false;
  }
  const origin = headers.get("origin");
  if (origin === null) return true;
  const originUrl = toUrl(origin);
  if (originUrl?.origin !== origin) return false;
  return (
    origin === publicUrl?.origin ||
    (LOOPBACK.has(originUrl.hostname) && /^https?:$/.test(originUrl.protocol))
  );
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

// E1 has no distance search, so `near` is refused instead of ignored. The query text never leaves
// this server: `llmFallback: false` keeps it from the LLM provider, so what the parser cannot read
// comes back in `unresolved` for the client to pass as `category` or `comuna`.
async function searchAgents(
  convex: ConvexCaller,
  { query, category, comuna, limit, near }: z.output<typeof SearchAgentsInput>,
) {
  if (near) {
    throw new Error("near is not supported yet: filter by comuna instead");
  }
  const { agents, truncated, interpretation } = await convex.action(
    api.directory.searchText,
    { query, category, comuna, limit, llmFallback: false },
  );
  return { agents, truncated, unresolved: interpretation.unresolved };
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

export function createMcpEndpoint(
  convex: ConvexCaller,
  { publicOrigin }: { publicOrigin?: string } = {},
) {
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
    if (!allowedRequest(request, publicOrigin)) {
      return new Response("Origin not allowed", { status: 403 });
    }
    const apiKey = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
    const caller =
      apiKey && isApiKeyFormat(apiKey)
        ? await convex.mutation(api.agentKeys.authenticate, { apiKey })
        : null;
    if (!caller) {
      return bearerAuthChallengeResponse(
        new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Missing or invalid API key",
        ),
      );
    }
    if (!caller.ok) {
      return new Response("Too many requests for this API key", {
        status: 429,
        headers: {
          "retry-after": String(
            Math.max(1, Math.ceil(caller.retryAfterMs / 1000)),
          ),
        },
      });
    }
    return handler.fetch(request);
  };
}
