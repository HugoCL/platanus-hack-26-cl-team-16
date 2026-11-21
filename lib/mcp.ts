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
    throw new Error(`${error.data.kind}: ${error.data.message}`);
  }
  throw error;
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

// Polls until a visible message arrives, the room stops being active or the timeout passes.
async function waitForMessages(
  convex: ConvexCaller,
  apiKey: string,
  { sessionId, after, timeoutMs }: z.output<typeof WaitForMessagesInput>,
) {
  const deadline = Date.now() + timeoutMs;
  const read = (cursor?: number) =>
    convex.query(api.mcpRooms.messages, { apiKey, sessionId, after: cursor });
  let result = await read(after);
  while (
    result.messages.length === 0 &&
    result.sessionStatus === "active" &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(POLL_MS, deadline - Date.now())),
    );
    result = await read(result.cursor);
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

export function createMcpEndpoint(convex: ConvexCaller) {
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
    return handler.fetch(request, {
      authInfo: { token: apiKey, clientId: apiKey.slice(0, 12), scopes: [] },
    });
  };
}
