// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { type ConvexCaller, createMcpEndpoint } from "../lib/mcp";
import { CONSUMER_AGENT_SLUG } from "../shared/seedData";

const modules = import.meta.glob("../convex/**/*.ts");
const MCP_URL = "http://localhost/api/mcp";
const REJECTED = /invalid_token|unauthorized|401/i;

type Negotiation = "legacy" | "auto";

const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;
let endpoint: ReturnType<typeof createMcpEndpoint>;
let apiKey: string;
beforeEach(async () => {
  t = createTest();
  await t.mutation(internal.seed.ensure, {});
  ({ apiKey } = await t.action(internal.agentKeys.issue, {
    slug: CONSUMER_AGENT_SLUG,
  }));
  endpoint = createMcpEndpoint(t as ConvexCaller);
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
    ["an unknown key", { authorization: "Bearer dak_0000" }],
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
      "https://localhost",
      "http://localhost/api/mcp",
      "null",
    ]) {
      expect((await post(initialize, { authorization, origin })).status).toBe(
        403,
      );
    }
    expect(
      (await post(initialize, { authorization, origin: "http://localhost" }))
        .status,
    ).toBe(200);

    const proxy = {
      authorization,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "directorio.example",
    };
    expect(
      (
        await post(initialize, {
          ...proxy,
          origin: "https://directorio.example",
        })
      ).status,
    ).toBe(200);
    expect(
      (await post(initialize, { ...proxy, origin: "http://localhost" })).status,
    ).toBe(403);
  });
});
