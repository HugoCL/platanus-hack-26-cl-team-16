// Clerk is the OAuth authorization server for MCP clients that sign a person in instead of holding
// an API key. These helpers have no Clerk SDK in them, so tests run them offline.

export const MCP_PATH = "/api/mcp";
export const MCP_SCOPES = ["profile"];

// A publishable key is `pk_<env>_` plus the base64 of the instance's Frontend API host and a `$`.
export function frontendApiOf(publishableKey: string | undefined) {
  const encoded = /^pk_(?:test|live)_(.+)$/.exec(publishableKey ?? "")?.[1];
  if (!encoded) return null;
  try {
    const host = atob(encoded).replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

export type McpOauthConfig = {
  issuer: string;
  resource: string;
  resourceMetadataUrl: string;
  secret: string;
};

// OAuth is on only when the server secret is set, the public origin is known and the Clerk keys
// are of the instance Convex trusts: a user of any other instance is nobody to Convex.
export function mcpOauthConfig(
  env: {
    publicOrigin?: string;
    publishableKey?: string;
    secret?: string;
  },
  trustedIssuer: string,
): McpOauthConfig | null {
  const { publicOrigin, secret } = env;
  if (!publicOrigin || !secret) return null;
  if (frontendApiOf(env.publishableKey) !== trustedIssuer) return null;
  const origin = publicOrigin.replace(/\/+$/, "");
  return {
    issuer: trustedIssuer,
    resource: `${origin}${MCP_PATH}`,
    resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`,
    secret,
  };
}

// RFC 9728: where a client that got a 401 finds the authorization server.
export function protectedResourceMetadata(config: McpOauthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: MCP_SCOPES,
  };
}

// A JWT access token names the resource it was issued for. One issued for another resource of the
// same Clerk instance is refused; an opaque token, or a JWT without `aud`, cannot be checked here.
export function issuedForAnotherResource(token: string, resource: string) {
  const payload = token.split(".")[1];
  if (!payload || token.split(".").length !== 3) return false;
  try {
    const { aud } = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (aud === undefined) return false;
    return !(Array.isArray(aud) ? aud : [aud]).includes(resource);
  } catch {
    return false;
  }
}
