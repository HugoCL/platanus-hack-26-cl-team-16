import { clerkClient } from "@clerk/nextjs/server";
import authConfig from "../convex/auth.config";
import type { McpOauth } from "./mcp";
import { issuedForAnotherResource, mcpOauthConfig } from "./mcp-oauth";

// The public origin MCP clients reach this app at. Render sets RENDER_EXTERNAL_URL on production
// and on each PR preview; elsewhere set MCP_PUBLIC_ORIGIN.
export const mcpPublicOrigin = () =>
  process.env.MCP_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;

export const clerkMcpOauthConfig = () =>
  mcpOauthConfig(
    {
      publicOrigin: mcpPublicOrigin(),
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secret: process.env.MCP_OAUTH_SECRET,
    },
    authConfig.providers[0].domain,
  );

const BEARER = /^Bearer\s+(\S+)$/i;

// Clerk checks the access token's signature, expiry and revocation.
export function clerkMcpOauth(): McpOauth | undefined {
  const config = clerkMcpOauthConfig();
  if (!config) return undefined;
  return {
    secret: config.secret,
    resourceMetadataUrl: config.resourceMetadataUrl,
    verify: async (request) => {
      const token = BEARER.exec(
        request.headers.get("authorization") ?? "",
      )?.[1];
      if (!token || issuedForAnotherResource(token, config.resource))
        return null;
      const clerk = await clerkClient();
      const state = await clerk.authenticateRequest(request, {
        acceptsToken: "oauth_token",
      });
      if (!state.isAuthenticated) return null;
      return state.toAuth().userId ?? null;
    },
  };
}
