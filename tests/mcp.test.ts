// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { type ConvexCaller, createMcpEndpoint } from "../lib/mcp";
import { AgentDetail, MCP_TOOLS, SearchAgentsOutput } from "../shared/mcp";
import { CLINIC_AGENT_SLUG, CONSUMER_AGENT_SLUG } from "../shared/seed-data";

const modules = import.meta.glob("../convex/**/*.ts");
const MCP_URL = "http://localhost/api/mcp";
const REJECTED = /invalid_token|unauthorized|401/i;
const PUBLIC_ORIGIN = "https://directorio.example";

type Negotiation = "legacy" | "auto";

const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;
let endpoint: ReturnType<typeof createMcpEndpoint>;
let apiKey: string;
let convexCalls: string[];
beforeEach(async () => {
  t = createTest();
  rateLimiter.register(t);
  await t.mutation(internal.seed.ensure, {});
  ({ apiKey } = await t.action(internal.agentKeys.issue, {
    slug: CONSUMER_AGENT_SLUG,
  }));
  convexCalls = [];
  const convex = t as ConvexCaller;
  endpoint = createMcpEndpoint(
    {
      query: (ref, ...args) => {
        convexCalls.push(getFunctionName(ref));
        return convex.query(ref, ...args);
      },
      mutation: (ref, ...args) => convex.mutation(ref, ...args),
      action: (ref, ...args) => {
        convexCalls.push(getFunctionName(ref));
        return convex.action(ref, ...args);
      },
    },
    { publicOrigin: PUBLIC_ORIGIN },
  );
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

describe.each<[Negotiation, string]>([
  ["legacy", "legacy"],
  ["auto", "modern"],
])("MCP endpoint, %s client", (mode, era) => {
  let client: Client;
  beforeEach(async () => {
    client = await connect(mode, apiKey);
    return () => client.close();
  });

  const call = async (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });

  const searchSlugs = async (args: Record<string, unknown>) => {
    const result = await call("search_agents", args);
    expect(result.isError).toBeFalsy();
    const { agents } = SearchAgentsOutput.parse(result.structuredContent);
    return agents.map((agent) => agent.slug);
  };

  it(`speaks the ${era} protocol`, () => {
    expect(client.getProtocolEra()).toBe(era);
    expect(client.getServerVersion()?.name).toBe("directorio-agentes");
  });

  it("lists the directory tools with the schemas from shared/mcp.ts", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_agent",
      "search_agents",
    ]);
    for (const tool of tools) {
      const shared = MCP_TOOLS[tool.name as keyof typeof MCP_TOOLS];
      expect(tool.description).toBe(shared.description);
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        ...z.toJSONSchema(shared.input, { io: "input" }),
      });
      expect(tool.outputSchema).toMatchObject({
        type: "object",
        ...z.toJSONSchema(shared.output, { io: "output" }),
      });
    }
    const search = tools.find((tool) => tool.name === "search_agents");
    expect(Object.keys(search?.inputSchema.properties ?? {})).toEqual([
      "query",
      "category",
      "near",
      "comuna",
      "radiusKm",
      "limit",
    ]);
    expect(search?.inputSchema.required).toEqual(["query"]);
    const get = tools.find((tool) => tool.name === "get_agent");
    expect(Object.keys(get?.inputSchema.properties ?? {})).toEqual([
      "agentId",
      "slug",
    ]);
  });

  it("search_agents finds the seed clinic from free text", async () => {
    const result = await call("search_agents", {
      query: "cardiólogo en Providencia",
    });
    const { agents, truncated, unresolved } = SearchAgentsOutput.strict().parse(
      result.structuredContent,
    );
    expect({ truncated, unresolved }).toEqual({
      truncated: false,
      unresolved: [],
    });
    expect(agents[0]).toMatchObject({
      slug: CLINIC_AGENT_SLUG,
      comuna: "Providencia",
      verified: true,
    });
    expect(agents[0]?.allowedIntents).toContain("book");
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual(
      result.structuredContent,
    );
  });

  it("search_agents lets an explicit comuna or category win over the text", async () => {
    for (const args of [
      { query: "cardiólogo", comuna: "Providencia" },
      { query: "cardiólogo en Valparaíso", comuna: "Providencia" },
      { query: "en Providencia", category: "cardiologia" },
      { query: "hora médica", category: "cardiologia", comuna: "Providencia" },
      { query: "cardiólogo en Providencia", category: "", comuna: "" },
    ]) {
      await expect(searchSlugs(args)).resolves.toEqual([CLINIC_AGENT_SLUG]);
    }
  });

  const search = async (args: Record<string, unknown>) => {
    const result = await call("search_agents", args);
    expect(result.isError).toBeFalsy();
    const { agents, truncated, unresolved } = SearchAgentsOutput.parse(
      result.structuredContent,
    );
    return { slugs: agents.map((agent) => agent.slug), truncated, unresolved };
  };

  it("search_agents tells an empty result apart from text it could not read", async () => {
    for (const args of [
      { query: "gimnasio en Pirque" },
      { query: "cardiólogo", comuna: "Comuna Inventada" },
    ]) {
      await expect(search(args)).resolves.toEqual({
        slugs: [],
        truncated: false,
        unresolved: [],
      });
    }
    await expect(
      search({ query: "algo rarísimo zzz", comuna: "Providencia" }),
    ).resolves.toEqual({
      slugs: [],
      truncated: false,
      unresolved: ["category"],
    });
    await expect(
      search({ query: "cardiólogo en Narnialandia", category: "cardiologia" }),
    ).resolves.toEqual({ slugs: [], truncated: false, unresolved: ["comuna"] });
  });

  it("search_agents says when the list was cut at the limit", async () => {
    const { slugs, truncated } = await search({
      query: "en Providencia",
      limit: 1,
    });
    expect(slugs).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it("search_agents never sends the query text to the LLM fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // More searches than the site-wide LLM bucket holds (10): none of them spends from it.
      for (let i = 0; i < 12; i++) {
        await expect(
          search({ query: `me duele el pecho, soy Juan Pérez ${i}` }),
        ).resolves.toEqual({
          slugs: [],
          truncated: false,
          unresolved: ["category"],
        });
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("search_agents refuses near, which the directory cannot search yet", async () => {
    const result = await call("search_agents", {
      query: "cardiólogo",
      near: { lat: -33.43, lng: -70.61 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/near is not supported/);
  });

  it("get_agent reads a card by slug and by agentId", async () => {
    const bySlug = await call("get_agent", { slug: CLINIC_AGENT_SLUG });
    const { agent } = z
      .object({ agent: AgentDetail })
      .strict()
      .parse(bySlug.structuredContent);
    expect(agent.slug).toBe(CLINIC_AGENT_SLUG);
    expect(agent.purpose).toMatch(/reservar horas/);
    expect(agent.scope.forbiddenTopics).toContain("datos de otros pacientes");

    const byId = await call("get_agent", { agentId: agent.agentId });
    expect(byId.structuredContent).toEqual(bySlug.structuredContent);
  });

  it("get_agent reports an agent that is not listed", async () => {
    for (const [args, field] of [
      [{ slug: "no-existe" }, "slug"],
      [{ agentId: "garbage" }, "agentId"],
    ] as const) {
      const result = await call("get_agent", args);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        `No listed agent has that ${field}`,
      );
    }
  });
});

describe("MCP endpoint over raw HTTP", () => {
  it.each<Negotiation>(["legacy", "auto"])(
    "rejects a %s client without a valid key before it connects",
    async (mode) => {
      await expect(connect(mode)).rejects.toThrow(REJECTED);
      await expect(connect(mode, "dak_not-a-real-key")).rejects.toThrow(
        REJECTED,
      );
    },
  );

  const post = (headers: Record<string, string>, to = endpoint) =>
    to(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "search_agents",
            arguments: { query: "cardiólogo en Providencia" },
          },
        }),
      }),
    );
  const directoryCalls = () =>
    convexCalls.filter((name) => name.startsWith("directory"));

  it.each([
    ["no Authorization header", {}],
    ["a non-Bearer scheme", { authorization: "Basic dXNlcjpwYXNz" }],
    ["a malformed key", { authorization: "Bearer dak_0000" }],
    ["an unknown key", { authorization: `Bearer dak_${"0".repeat(64)}` }],
  ])(
    "answers 401 to a tool call with %s and runs no tool",
    async (_, headers) => {
      const response = await post(headers);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Bearer /);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_token",
      });
      expect(directoryCalls()).toEqual([]);
    },
  );

  it("serves the same tool call with a valid key", async () => {
    const response = await post({ authorization: `Bearer ${apiKey}` });
    expect(response.status).toBe(200);
    expect(directoryCalls()).toEqual(["directory:searchText"]);
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
      expect((await post({ authorization, origin })).status).toBe(403);
    }
    expect(directoryCalls()).toEqual([]);
    for (const origin of [
      "http://localhost",
      "http://localhost:3000",
      "https://127.0.0.1:8443",
      PUBLIC_ORIGIN,
    ]) {
      expect((await post({ authorization, origin })).status).toBe(200);
    }
  });

  it("refuses a page rebound to this server, whose Origin and Host match each other", async () => {
    const rebound = {
      authorization: `Bearer ${apiKey}`,
      host: "evil.example:3000",
    };
    expect(
      (await post({ ...rebound, origin: "http://evil.example:3000" })).status,
    ).toBe(403);
    expect((await post(rebound)).status).toBe(403);
    expect(directoryCalls()).toEqual([]);
  });

  it("reads the host strictly: default ports, no userinfo or path, empty forwarded host", async () => {
    const authorization = `Bearer ${apiKey}`;
    const status = async (headers: Record<string, string>) =>
      (await post({ authorization, ...headers })).status;
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
    const behindProxies = (forwardedHost: string, origin = PUBLIC_ORIGIN) => ({
      authorization,
      origin,
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": forwardedHost,
    });
    expect((await post(behindProxies("directorio.example"))).status).toBe(200);
    expect(
      (await post(behindProxies("directorio.example, internal.render:10000")))
        .status,
    ).toBe(200);
    expect((await post(behindProxies("evil.example"))).status).toBe(403);
    expect(
      (await post(behindProxies("directorio.example", "https://evil.example")))
        .status,
    ).toBe(403);

    const unconfigured = createMcpEndpoint(t as ConvexCaller);
    expect(
      (await post(behindProxies("directorio.example"), unconfigured)).status,
    ).toBe(403);
  });

  it("answers 429 with Retry-After once a key spends its bucket", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const authorization = `Bearer ${apiKey}`;
      const statuses = [];
      for (let i = 0; i < 60; i++) {
        statuses.push((await post({ authorization })).status);
      }
      expect(statuses).toEqual(Array(60).fill(200));
      const calls = directoryCalls().length;
      const limited = await post({ authorization });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(directoryCalls()).toHaveLength(calls);

      vi.advanceTimersByTime(1000);
      expect((await post({ authorization })).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
