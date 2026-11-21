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
