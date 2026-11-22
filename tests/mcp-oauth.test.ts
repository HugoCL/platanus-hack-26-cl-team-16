// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import authConfig from "../convex/auth.config";
import schema from "../convex/schema";
import { type ConvexCaller, createMcpEndpoint } from "../lib/mcp";
import {
  frontendApiOf,
  issuedForAnotherResource,
  mcpOauthConfig,
  protectedResourceMetadata,
} from "../lib/mcp-oauth";
import { EXTERNAL_AGENT_SLUG } from "../shared/seed-data";
import { errorKind } from "./convex/roomFixture";

const modules = import.meta.glob("../convex/**/*.ts");
const MCP_URL = "http://localhost/api/mcp";
const ISSUER = authConfig.providers[0].domain;
const SECRET = "server-secret";
const METADATA_URL =
  "http://localhost/.well-known/oauth-protected-resource/api/mcp";
const TOKENS: Record<string, string> = {
  "token-ana": "user_ana",
  "token-bruno": "user_bruno",
};

const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;
let endpoint: ReturnType<typeof createMcpEndpoint>;
let verified: number;
beforeEach(async () => {
  vi.stubEnv("MCP_OAUTH_SECRET", SECRET);
  t = createTest();
  rateLimiter.register(t);
  await t.mutation(internal.seed.ensure, {});
  verified = 0;
  endpoint = createMcpEndpoint(t as ConvexCaller, {
    oauth: {
      secret: SECRET,
      resourceMetadataUrl: METADATA_URL,
      verify: async (request) => {
        verified += 1;
        const token = request.headers.get("authorization")?.slice(7) ?? "";
        return TOKENS[token] ?? null;
      },
    },
  });
});
afterEach(() => vi.unstubAllEnvs());

async function connect(token: string, to = endpoint) {
  const client = new Client({ name: "oauth-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (url, init) => to(new Request(url, init)),
      authProvider: { token: async () => token },
    }),
  );
  return client;
}

const post = (authorization?: string, to = endpoint) =>
  to(
    new Request(MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );

const agentsOf = (userId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("agents")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", `${ISSUER}|${userId}`),
      )
      .collect(),
  );

describe("MCP endpoint with OAuth", () => {
  it("points a caller without credentials to the resource metadata", async () => {
    for (const authorization of [undefined, "Bearer not-a-token"]) {
      const response = await post(authorization);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        `resource_metadata="${METADATA_URL}"`,
      );
    }
    expect(await agentsOf("user_ana")).toHaveLength(0);
  });

  it("lets a signed-in person act as their own agent, created once", async () => {
    const first = await connect("token-ana");
    const { tools } = await first.listTools();
    expect(tools.map((tool) => tool.name)).toContain("open_session");
    await first.close();
    await (await connect("token-ana")).close();

    const mine = await agentsOf("user_ana");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      kind: "external",
      status: "draft",
      selfRegistered: true,
    });
    expect(await agentsOf("user_bruno")).toHaveLength(0);
    await (await connect("token-bruno")).close();
    expect((await agentsOf("user_bruno"))[0]._id).not.toBe(mine[0]._id);
  });

  it("still takes an agent's API key without asking Clerk", async () => {
    const { apiKey } = await t.action(internal.agentKeys.issue, {
      slug: EXTERNAL_AGENT_SLUG,
    });
    await (await connect(apiKey)).close();
    expect(verified).toBe(0);
  });

  it("answers 401 with no metadata when OAuth is off", async () => {
    const keysOnly = createMcpEndpoint(t as ConvexCaller);
    const response = await post("Bearer token-ana", keysOnly);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toContain(
      "resource_metadata",
    );
    expect(await agentsOf("user_ana")).toHaveLength(0);
  });
});

describe("mcpOauth.credential", () => {
  const credential = (secret: string, userId = "user_ana") =>
    t.mutation(api.mcpOauth.credential, { secret, userId });

  it("refuses a caller without the server secret", async () => {
    expect(await errorKind(credential("guess"))).toBe("Unauthorized");
    expect(await errorKind(credential(""))).toBe("Unauthorized");
    vi.stubEnv("MCP_OAUTH_SECRET", "");
    expect(await errorKind(credential(""))).toBe("Unauthorized");
    expect(await errorKind(credential(SECRET))).toBe("Unauthorized");
    expect(await agentsOf("user_ana")).toHaveLength(0);
  });

  it("refuses something that is not a Clerk user id", async () => {
    expect(await errorKind(credential(SECRET, "ana|https://evil"))).toBe(
      "InvalidArgument",
    );
  });

  it("answers the same key each time, and it stops working once revoked", async () => {
    const { apiKey } = await credential(SECRET);
    expect(await credential(SECRET)).toEqual({ apiKey });
    expect((await credential(SECRET, "user_bruno")).apiKey).not.toBe(apiKey);
    const [agent] = await agentsOf("user_ana");
    await t.mutation(internal.agentKeys.revoke, {
      slug: agent.slug,
      prefix: apiKey.slice(0, 12),
    });
    await credential(SECRET);
    expect(await t.mutation(api.agentKeys.authenticate, { apiKey })).toBeNull();
    expect((await post("Bearer token-ana")).status).toBe(401);
    expect(await agentsOf("user_ana")).toHaveLength(1);
  });
});

describe("OAuth configuration", () => {
  const key = (host: string, env = "test") => `pk_${env}_${btoa(`${host}$`)}`;
  const teamKey = key(new URL(ISSUER).host);
  const env = {
    publicOrigin: "https://agora.example/",
    publishableKey: teamKey,
    secret: SECRET,
  };

  it("reads the Frontend API out of a publishable key", () => {
    expect(frontendApiOf(teamKey)).toBe(ISSUER);
    expect(frontendApiOf(key("clerk.agora.example", "live"))).toBe(
      "https://clerk.agora.example",
    );
    for (const bad of [undefined, "", "sk_test_abc", "pk_test_%%%"]) {
      expect(frontendApiOf(bad)).toBeNull();
    }
  });

  it("is on only with the secret, the origin and the trusted Clerk instance", () => {
    const config = mcpOauthConfig(env, ISSUER);
    expect(config).toMatchObject({
      resource: "https://agora.example/api/mcp",
      resourceMetadataUrl:
        "https://agora.example/.well-known/oauth-protected-resource/api/mcp",
    });
    expect(config && protectedResourceMetadata(config)).toMatchObject({
      resource: "https://agora.example/api/mcp",
      authorization_servers: [ISSUER],
    });
    expect(mcpOauthConfig({ ...env, secret: undefined }, ISSUER)).toBeNull();
    expect(
      mcpOauthConfig({ ...env, publicOrigin: undefined }, ISSUER),
    ).toBeNull();
    expect(
      mcpOauthConfig(
        { ...env, publishableKey: key("other-app.clerk.accounts.dev") },
        ISSUER,
      ),
    ).toBeNull();
  });

  it("refuses a JWT issued for another resource", () => {
    const jwt = (payload: object) =>
      `h.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.s`;
    const resource = "https://agora.example/api/mcp";
    expect(issuedForAnotherResource(jwt({ aud: resource }), resource)).toBe(
      false,
    );
    expect(issuedForAnotherResource(jwt({ aud: [resource] }), resource)).toBe(
      false,
    );
    expect(
      issuedForAnotherResource(jwt({ aud: "https://other.example" }), resource),
    ).toBe(true);
    expect(issuedForAnotherResource(jwt({ sub: "user_ana" }), resource)).toBe(
      false,
    );
    expect(issuedForAnotherResource("oat_opaque", resource)).toBe(false);
  });
});
