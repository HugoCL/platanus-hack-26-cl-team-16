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
import { ConvexError } from "convex/values";
import type { z } from "zod";
import { api } from "../convex/_generated/api";
import { isApiKeyFormat } from "../convex/agentKeys";
import {
  type CloseSessionInput,
  type GetAgentInput,
  MCP_TOOLS,
  type McpToolName,
  type OpenSessionInput,
  type SearchAgentsInput,
  type SendMessageInput,
  type WaitForMessagesInput,
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
const POLL_MS = 500;

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
        await run(args as z.output<Tool<N>["input"]>).catch(readableError),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );
}

function readableError(error: unknown): never {
  if (error instanceof ConvexError && typeof error.data?.message === "string") {
    const { kind, rule, message } = error.data;
    throw new Error(`${kind}${rule ? ` (${rule})` : ""}: ${message}`);
  }
  throw error;
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

// E2 only opens moderated rooms. The room tools forward the caller's key and let Convex resolve
// the agent from it (convex/mcpRooms.ts).
async function openSession(
  convex: ConvexCaller,
  apiKey: string,
  { targetAgentId, intent, mode }: z.output<typeof OpenSessionInput>,
) {
  if (mode !== "moderated") {
    throw new Error("only moderated sessions are available");
  }
  return convex.action(api.mcpRooms.open, {
    apiKey,
    targetAgentId,
    intent: intent.name,
    request: intent.description,
  });
}

async function sendMessage(
  convex: ConvexCaller,
  apiKey: string,
  input: z.output<typeof SendMessageInput>,
) {
  return {
    message: await convex.action(api.mcpRooms.send, { apiKey, ...input }),
  };
}

// Polls until a visible message arrives, the room stops being active or `timeoutMs` passes. A read
// still running at the deadline is abandoned; its cursor was never handed out, so nothing is lost.
async function waitForMessages(
  convex: ConvexCaller,
  apiKey: string,
  { sessionId, after, timeoutMs }: z.output<typeof WaitForMessagesInput>,
) {
  const deadline = performance.now() + timeoutMs;
  const read = (cursor: string | null) =>
    convex.query(api.mcpRooms.messages, {
      apiKey,
      sessionId,
      after: cursor ?? undefined,
    });
  const untilDeadline = <T>(promise: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(
          () => resolve(undefined),
          deadline - performance.now(),
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };
  let result = await read(after ?? null);
  while (result.messages.length === 0 && result.sessionStatus === "active") {
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(POLL_MS, remaining)),
    );
    if (performance.now() >= deadline) break;
    const next = await untilDeadline(read(result.cursor));
    if (!next) break;
    result = next;
  }
  return result;
}

// The contract's optional reason has nowhere to go: E2's close takes none.
async function closeSession(
  convex: ConvexCaller,
  apiKey: string,
  { sessionId }: z.output<typeof CloseSessionInput>,
) {
  return convex.mutation(api.mcpRooms.close, { apiKey, sessionId });
}

export function createMcpEndpoint(
  convex: ConvexCaller,
  { publicOrigin }: { publicOrigin?: string } = {},
) {
  const handler = createMcpHandler(({ authInfo }) => {
    const apiKey = authInfo?.token ?? "";
    const server = new McpServer(
      { name: "directorio-agentes", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    registerTool(server, "search_agents", (input) =>
      searchAgents(convex, input),
    );
    registerTool(server, "get_agent", (input) => getAgent(convex, input));
    registerTool(server, "open_session", (input) =>
      openSession(convex, apiKey, input),
    );
    registerTool(server, "send_message", (input) =>
      sendMessage(convex, apiKey, input),
    );
    registerTool(server, "wait_for_messages", (input) =>
      waitForMessages(convex, apiKey, input),
    );
    registerTool(server, "close_session", (input) =>
      closeSession(convex, apiKey, input),
    );
    return server;
  });
  return async (request: Request) => {
    if (!allowedRequest(request, publicOrigin)) {
      return new Response("Origin not allowed", { status: 403 });
    }
    const apiKey =
      BEARER.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    const caller = isApiKeyFormat(apiKey)
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
    return handler.fetch(request, {
      authInfo: { token: apiKey, clientId: apiKey.slice(0, 12), scopes: [] },
    });
  };
}
