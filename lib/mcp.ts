import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";
import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import { api } from "../convex/_generated/api";

export type ConvexCaller = {
  query<Q extends FunctionReference<"query">>(
    query: Q,
    ...args: OptionalRestArgs<Q>
  ): Promise<FunctionReturnType<Q>>;
};

const BEARER = /^Bearer\s+(\S+)$/i;

function crossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (
    origin !== null && URL.parse(origin)?.host !== new URL(request.url).host
  );
}

export function createMcpEndpoint(convex: ConvexCaller) {
  const handler = createMcpHandler(
    () =>
      new McpServer(
        { name: "directorio-agentes", version: "0.1.0" },
        { capabilities: { tools: {} } },
      ),
  );
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
