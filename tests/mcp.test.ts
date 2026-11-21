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
import { AgentDetail, AgentSummary, MCP_TOOLS } from "../shared/mcp";
import { CLINIC_AGENT_SLUG, CONSUMER_AGENT_SLUG } from "../shared/seedData";

const modules = import.meta.glob("../convex/**/*.ts");
const MCP_URL = "http://localhost/api/mcp";
const REJECTED = /invalid_token|unauthorized|401/i;

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
  endpoint = createMcpEndpoint({
    query: (ref, ...args) => {
      convexCalls.push(getFunctionName(ref));
      return convex.query(ref, ...args);
    },
    action: (ref, ...args) => {
      convexCalls.push(getFunctionName(ref));
      return convex.action(ref, ...args);
    },
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
    const { agents } = z
      .object({ agents: z.array(AgentSummary) })
      .parse(result.structuredContent);
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
    const { agents } = z
      .object({ agents: z.array(AgentSummary) })
      .strict()
      .parse(result.structuredContent);
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
    ]) {
      await expect(searchSlugs(args)).resolves.toEqual([CLINIC_AGENT_SLUG]);
    }
  });

  it("search_agents returns an empty list when nothing matches or part of the text is not understood", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const args of [
      { query: "gimnasio en Pirque" },
      { query: "cardiólogo", comuna: "Comuna Inventada" },
      { query: "algo rarísimo zzz", comuna: "Providencia" },
      { query: "cardiólogo en Narnialandia", category: "cardiologia" },
    ]) {
      await expect(searchSlugs(args)).resolves.toEqual([]);
    }
    warn.mockRestore();
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

  const post = (headers: Record<string, string>) =>
    endpoint(
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
    ["an unknown key", { authorization: "Bearer dak_0000" }],
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
      "https://localhost",
      "http://localhost/api/mcp",
      "null",
    ]) {
      expect((await post({ authorization, origin })).status).toBe(403);
    }
    expect(directoryCalls()).toEqual([]);
    expect(
      (await post({ authorization, origin: "http://localhost" })).status,
    ).toBe(200);

    const proxy = {
      authorization,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "directorio.example",
    };
    expect(
      (await post({ ...proxy, origin: "https://directorio.example" })).status,
    ).toBe(200);
    expect((await post({ ...proxy, origin: "http://localhost" })).status).toBe(
      403,
    );
  });
});
