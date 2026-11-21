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

const HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;
const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443" };

// DNS rebinding guard from the MCP spec: the host the client used and the Origin a browser sends
// must be loopback or the deployment's public origin. The allowed values come from configuration,
// never from the request, because a rebound page sends an Origin and a Host that match each other.
// The host is the first value of X-Forwarded-Host (a chain of proxies appends the rest), or Host.
// A client can send X-Forwarded-Host itself, but a page in a browser also sends an Origin it cannot
// forge, and that Origin must pass too.
function allowedRequest(
  { headers, url }: Request,
  publicOrigin: string | undefined,
) {
  const publicUrl = publicOrigin ? toUrl(publicOrigin) : null;
  const host = (
    headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    headers.get("host") ||
    new URL(url).host
  ).toLowerCase();
  const hostUrl = HOST.test(host) ? toUrl(`http://${host}`) : null;
  const publicHosts = publicUrl
    ? [
        publicUrl.host,
        `${publicUrl.hostname}:${publicUrl.port || DEFAULT_PORT[publicUrl.protocol]}`,
      ]
    : [];
  if (
    !hostUrl ||
    (!LOOPBACK.has(hostUrl.hostname) && !publicHosts.includes(host))
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
