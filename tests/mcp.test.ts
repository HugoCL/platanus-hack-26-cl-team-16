// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import rateLimiter from "@convex-dev/rate-limiter/test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { type ConvexCaller, createMcpEndpoint } from "../lib/mcp";
import { CONSUMER_AGENT_SLUG } from "../shared/seedData";

const modules = import.meta.glob("../convex/**/*.ts");
const MCP_URL = "http://localhost/api/mcp";
const REJECTED = /invalid_token|unauthorized|401/i;
const PUBLIC_ORIGIN = "https://directorio.example";

type Negotiation = "legacy" | "auto";

const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;
let endpoint: ReturnType<typeof createMcpEndpoint>;
let apiKey: string;
beforeEach(async () => {
  t = createTest();
  rateLimiter.register(t);
  await t.mutation(internal.seed.ensure, {});
  ({ apiKey } = await t.action(internal.agentKeys.issue, {
    slug: CONSUMER_AGENT_SLUG,
  }));
  endpoint = createMcpEndpoint(t as ConvexCaller, {
    publicOrigin: PUBLIC_ORIGIN,
  });
});

async function connect(mode: Negotiation, key?: string) {
  const client = new Client(
    { name: "e5-test", version: "0.0.0" },
    { versionNegotiation: { mode } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (url, init) => endpoint(new Request(url, init)),
      authProvider: key ? { token: async () => key } : undefined,
    }),
  );
  return client;
}

const post = (body: unknown, headers: Record<string, string>) =>
  endpoint(
    new Request(MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "raw", version: "0" },
  },
};

describe.each<[Negotiation, string]>([
  ["legacy", "legacy"],
  ["auto", "modern"],
])("MCP endpoint, %s client", (mode, era) => {
  it(`speaks the ${era} protocol to a client with a valid key`, async () => {
    const client = await connect(mode, apiKey);
    expect(client.getProtocolEra()).toBe(era);
    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
    await client.close();
  });

  it("rejects a client without a key or with an invalid one", async () => {
    await expect(connect(mode)).rejects.toThrow(REJECTED);
    await expect(connect(mode, "dak_not-a-real-key")).rejects.toThrow(REJECTED);
  });
});

describe("MCP endpoint over raw HTTP", () => {
  it.each([
    ["no Authorization header", {}],
    ["a non-Bearer scheme", { authorization: "Basic dXNlcjpwYXNz" }],
    ["a malformed key", { authorization: "Bearer dak_0000" }],
    ["an unknown key", { authorization: `Bearer dak_${"0".repeat(64)}` }],
  ])("answers 401 with a Bearer challenge for %s", async (_, headers) => {
    const response = await post(initialize, headers);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer /);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_token",
    });
  });

  it("serves the request with a valid key", async () => {
    const response = await post(initialize, {
      authorization: `Bearer ${apiKey}`,
    });
    expect(response.status).toBe(200);
  });

  it("refuses a request from another site's page with 403, key or not", async () => {
    const authorization = `Bearer ${apiKey}`;
    for (const origin of [
      "https://evil.example",
      "http://localhost.evil.example",
      "http://localhost/api/mcp",
      "file://localhost",
      "null",
    ]) {
      expect((await post(initialize, { authorization, origin })).status).toBe(
        403,
      );
    }
    for (const origin of [
      "http://localhost",
      "http://localhost:3000",
      "https://127.0.0.1:8443",
      PUBLIC_ORIGIN,
    ]) {
      expect((await post(initialize, { authorization, origin })).status).toBe(
        200,
      );
    }
  });

  it("refuses a page rebound to this server, whose Origin and Host match each other", async () => {
    const rebound = {
      authorization: `Bearer ${apiKey}`,
      host: "evil.example:3000",
    };
    expect(
      (
        await post(initialize, {
          ...rebound,
          origin: "http://evil.example:3000",
        })
      ).status,
    ).toBe(403);
    expect((await post(initialize, rebound)).status).toBe(403);
  });

  it("reads the host strictly: default ports, no userinfo or path, empty forwarded host", async () => {
    const authorization = `Bearer ${apiKey}`;
    const status = async (headers: Record<string, string>) =>
      (await post(initialize, { authorization, ...headers })).status;
    expect(await status({ host: "directorio.example:443" })).toBe(200);
    expect(await status({ "x-forwarded-host": "Directorio.Example:443" })).toBe(
      200,
    );
    expect(await status({ host: "directorio.example:80" })).toBe(403);
    expect(
      await status({ host: "directorio.example", "x-forwarded-host": "" }),
    ).toBe(200);
    for (const host of [
      "evil.example@localhost",
      "localhost/evil",
      "localhost?x",
      "localhost#x",
    ]) {
      expect(await status({ host })).toBe(403);
    }
    expect(
      await status({ "x-forwarded-host": "evil@directorio.example" }),
    ).toBe(403);
  });

  it("accepts the public origin behind proxies and only that one", async () => {
    const authorization = `Bearer ${apiKey}`;
    const behindProxies = (forwardedHost: string, origin = PUBLIC_ORIGIN) =>
      post(initialize, {
        authorization,
        origin,
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": forwardedHost,
      });
    expect((await behindProxies("directorio.example")).status).toBe(200);
    expect(
      (await behindProxies("directorio.example, internal.render:10000")).status,
    ).toBe(200);
    expect((await behindProxies("evil.example")).status).toBe(403);
    expect(
      (await behindProxies("directorio.example", "https://evil.example"))
        .status,
    ).toBe(403);

    const unconfigured = createMcpEndpoint(t as ConvexCaller);
    const response = await unconfigured(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization,
          origin: PUBLIC_ORIGIN,
          "x-forwarded-host": "directorio.example",
        },
        body: JSON.stringify(initialize),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("answers 429 with Retry-After once a key spends its bucket", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const authorization = `Bearer ${apiKey}`;
      const statuses = [];
      for (let i = 0; i < 60; i++) {
        statuses.push((await post(initialize, { authorization })).status);
      }
      expect(statuses).toEqual(Array(60).fill(200));
      const limited = await post(initialize, { authorization });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

      vi.advanceTimersByTime(1000);
      expect((await post(initialize, { authorization })).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
