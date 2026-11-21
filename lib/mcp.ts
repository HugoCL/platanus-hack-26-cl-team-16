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
import { isApiKeyFormat } from "../convex/agentKeys";

export type ConvexCaller = {
  mutation<M extends FunctionReference<"mutation">>(
    mutation: M,
    ...args: OptionalRestArgs<M>
  ): Promise<FunctionReturnType<M>>;
};

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

export function createMcpEndpoint(
  convex: ConvexCaller,
  { publicOrigin }: { publicOrigin?: string } = {},
) {
  const handler = createMcpHandler(
    () =>
      new McpServer(
        { name: "directorio-agentes", version: "0.1.0" },
        { capabilities: { tools: {} } },
      ),
  );
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
