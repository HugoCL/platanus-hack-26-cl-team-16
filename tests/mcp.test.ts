// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import * as referenceModel from "../convex/referenceLlm";
import schema from "../convex/schema";
import { type ConvexCaller, createMcpEndpoint } from "../lib/mcp";
import { REFERENCE_ATTACK } from "../shared/fixtures/moderation-set";
import {
  AgentDetail,
  MCP_TOOLS,
  type McpToolName,
  SearchAgentsOutput,
} from "../shared/mcp";
import * as rules from "../shared/moderator/rules";
import * as providers from "../shared/providers/llm";
import {
  CLINIC_AGENT_SLUG,
  CONSUMER_AGENT_SLUG,
  EXTERNAL_AGENT_SLUG,
} from "../shared/seed-data";
import { errorKind } from "./convex/roomFixture";
import { NOW } from "./convex/rooms";

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
    slug: EXTERNAL_AGENT_SLUG,
  }));
  convexCalls = [];
  const convex = t as ConvexCaller;
  endpoint = createMcpEndpoint(
    {
      query: (ref, ...args) => {
        convexCalls.push(getFunctionName(ref));
        return convex.query(ref, ...args);
      },
      mutation: (ref, ...args) => {
        convexCalls.push(getFunctionName(ref));
        return convex.mutation(ref, ...args);
      },
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

  it("lists the tools with the schemas from shared/mcp.ts", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      Object.keys(MCP_TOOLS).sort(),
    );
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
    const open = tools.find((tool) => tool.name === "open_session");
    expect(Object.keys(open?.inputSchema.properties ?? {})).toEqual([
      "targetAgentId",
      "intent",
      "mode",
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

describe("MCP room tools", () => {
  const REQUEST = "Necesito hora con un cardiólogo en Providencia";
  const NOT_IN_ROOM = "NotParticipant: you are not a participant in this room";
  type Output<N extends McpToolName> = z.output<
    (typeof MCP_TOOLS)[N]["output"]
  >;

  let client: Client;
  let agents: Record<"external" | "consumer" | "clinic", Id<"agents">>;
  let intent: { name: string; description: string };
  beforeEach(async () => {
    vi.spyOn(providers, "createLlmProvider").mockReturnValue(
      providers.createFakeLlmProvider({
        object: () => ({ decision: "allow", rule: "purpose" }),
      }),
    );
    client = await connect("auto", apiKey);
    const agentId = (slug: string) =>
      t.run(async (ctx) => {
        const agent = await ctx.db
          .query("agents")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .unique();
        if (!agent) throw new Error(`missing ${slug}`);
        return agent._id;
      });
    agents = {
      external: await agentId(EXTERNAL_AGENT_SLUG),
      consumer: await agentId(CONSUMER_AGENT_SLUG),
      clinic: await agentId(CLINIC_AGENT_SLUG),
    };
    const clinic = await t.query(api.directory.get, {
      slug: CLINIC_AGENT_SLUG,
    });
    intent = { name: clinic?.allowedIntents[0] ?? "", description: REQUEST };
    return async () => {
      await client.close();
      await t.finishInProgressScheduledFunctions();
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function use<N extends McpToolName>(
    name: N,
    args: Record<string, unknown>,
  ): Promise<Output<N>> {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    return MCP_TOOLS[name].output.parse(result.structuredContent) as Output<N>;
  }

  async function refusal(name: McpToolName, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    return JSON.stringify(result.content);
  }

  const text = (value: string) => ({ kind: "text" as const, text: value });

  const roleIn = (
    session: { participants: { role: string; participantId: string }[] },
    role: string,
  ) =>
    session.participants.find((p) => p.role === role)
      ?.participantId as Id<"participants">;

  async function openRoom() {
    const session = await use("open_session", {
      targetAgentId: agents.clinic,
      intent,
    });
    return {
      sessionId: session.sessionId as Id<"sessions">,
      session,
      me: roleIn(session, "initiator"),
      provider: roleIn(session, "recipient"),
    };
  }

  async function hostedRoom() {
    const session = await t.action(internal.rooms.open, {
      initiatorAgentId: agents.consumer,
      providerAgentId: agents.clinic,
      request: REQUEST,
    });
    return {
      sessionId: session.sessionId as Id<"sessions">,
      consumer: roleIn(session, "initiator"),
      provider: roleIn(session, "recipient"),
    };
  }

  const history = (sessionId: Id<"sessions">, viewer: Id<"participants">) =>
    t.query(internal.gate.historyForParticipant, {
      sessionId,
      viewerParticipantId: viewer,
    });

  it("open_session opens a moderated room with the key's agent as the initiator", async () => {
    const { session, sessionId, me } = await openRoom();

    expect(session).toMatchObject({ status: "active", contract: { intent } });
    expect(session.participants).toHaveLength(2);
    expect(session.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: me,
          agentId: agents.external,
          role: "initiator",
        }),
        expect.objectContaining({ agentId: agents.clinic, role: "recipient" }),
      ]),
    );
    const record = await t.run((ctx) =>
      ctx.db
        .query("participants")
        .withIndex("by_agentId_and_sessionId", (q) =>
          q.eq("agentId", agents.external).eq("sessionId", sessionId),
        )
        .unique(),
    );
    expect(record?._id).toBe(me);
    const { messages } = await use("wait_for_messages", {
      sessionId,
      timeoutMs: 0,
    });
    expect(messages.map((m) => m.content)).toMatchObject([
      { kind: "system", code: "session_opened" },
    ]);
  });

  it("takes the caller from the key and ignores an agentId in the arguments", async () => {
    const openedByConsumer = async () =>
      (await t.run((ctx) => ctx.db.query("sessions").collect())).filter(
        (s) => s.initiatorAgentId === agents.consumer,
      ).length;
    const before = await openedByConsumer();

    const session = await use("open_session", {
      targetAgentId: agents.clinic,
      intent,
      initiatorAgentId: agents.consumer,
      agentId: agents.consumer,
    });

    expect(session.participants).toMatchObject([
      { agentId: agents.external, role: "initiator" },
      { agentId: agents.clinic, role: "recipient" },
    ]);
    expect(await openedByConsumer()).toBe(before);
  });

  it("send_message goes through the gate and wait_for_messages returns the provider's reply", async () => {
    const { sessionId, me, provider } = await openRoom();
    const opened = await use("wait_for_messages", { sessionId, timeoutMs: 0 });

    const { message } = await use("send_message", {
      sessionId,
      recipient: provider,
      content: text("Busco hora esta semana"),
    });

    expect(message).toMatchObject({
      senderParticipantId: me,
      recipient: provider,
      status: "allowed",
    });
    expect(await history(sessionId, provider)).toContainEqual(message);
    const mine = await use("wait_for_messages", {
      sessionId,
      after: opened.cursor,
    });
    expect(mine.messages[0]).toEqual(message);
    const replies =
      mine.messages.length > 1
        ? mine.messages.slice(1)
        : (
            await use("wait_for_messages", {
              sessionId,
              after: mine.cursor,
            })
          ).messages;
    expect(replies).toMatchObject([
      { senderParticipantId: provider, recipient: me, status: "allowed" },
    ]);
  });

  it("books through the reference provider when the external agent's human owner selects a slot", async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      const identity = {
        subject: "mcp-owner",
        tokenIdentifier: "https://clerk.example|mcp-owner",
      };
      const owner = t.withIdentity(identity);
      const other = t.withIdentity({
        subject: "other",
        tokenIdentifier: "https://clerk.example|other",
      });
      await t.run((ctx) =>
        ctx.db.patch("agents", agents.external, {
          ownerTokenIdentifier: identity.tokenIdentifier,
        }),
      );
      vi.spyOn(referenceModel, "referenceLlm").mockReturnValue(
        providers.createFakeLlmProvider({
          object: () => ({ action: "offer_slots", offerings: [], text: "" }),
        }),
      );

      const { session, sessionId, provider } = await openRoom();
      const human = roleIn(session, "owner");
      expect(session.participants).toContainEqual(
        expect.objectContaining({
          kind: "human",
          role: "owner",
          onBehalfOfAgentId: agents.external,
        }),
      );
      expect(JSON.stringify(session)).not.toContain(identity.tokenIdentifier);
      expect(await owner.query(api.rooms.view, { sessionId })).toMatchObject({
        humanParticipantId: human,
      });
      expect(await errorKind(other.query(api.rooms.view, { sessionId }))).toBe(
        "NotParticipant",
      );

      await use("send_message", {
        sessionId,
        recipient: provider,
        content: text("Hola, ¿tienen una hora de cardiología?"),
      });
      const agentPage = await use("wait_for_messages", {
        sessionId,
        timeoutMs: 0,
      });
      expect(agentPage.messages.map((message) => message.content.kind)).toEqual(
        ["system", "text"],
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const picker = (await owner.query(api.gate.history, { sessionId })).at(
        -1,
      );
      if (
        picker?.content.kind !== "ui" ||
        picker.content.spec.type !== "slot_picker"
      ) {
        throw new Error("missing slot picker");
      }
      expect(picker).toMatchObject({
        senderParticipantId: provider,
        recipient: human,
        status: "allowed",
      });
      const afterPicker = await use("wait_for_messages", {
        sessionId,
        after: agentPage.cursor,
        timeoutMs: 0,
      });
      expect(afterPicker.messages).toEqual([]);
      expect(afterPicker.cursor).not.toBe(agentPage.cursor);
      const { id: pickerId, slots } = picker.content.spec;
      const slotId = slots[0].id;
      const choice = {
        sessionId,
        recipient: provider,
        content: {
          kind: "ui_response",
          inReplyTo: picker.messageId,
          response: { type: "slot_selected", pickerId, slotId },
        },
      } as const;
      expect(await refusal("send_message", choice)).toContain(
        "inReplyTo must name a delivered UI block sent to the sender",
      );
      expect(await errorKind(other.action(api.gate.send, choice))).toBe(
        "NotParticipant",
      );
      await owner.action(api.gate.send, choice);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await owner.query(api.gate.history, { sessionId })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recipient: human,
            status: "allowed",
            content: {
              kind: "ui",
              spec: expect.objectContaining({
                type: "confirmation",
                id: `reserva-${slotId}`,
              }),
            },
          }),
        ]),
      );
      const closed = await use("wait_for_messages", {
        sessionId,
        after: afterPicker.cursor,
        timeoutMs: 0,
      });
      expect(closed.sessionStatus).toBe("closed");
      expect(closed.messages.map((message) => message.content)).toMatchObject([
        { kind: "system", code: "session_closed" },
      ]);
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("transactions")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
            .take(2),
        ),
      ).toMatchObject([
        {
          kind: "booking",
          status: "confirmed",
          lines: [{ availabilityId: slotId }],
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("criterion 3: the gate blocks the reference attack from an external agent as it does from a hosted one", async () => {
    const { sessionId, me, provider } = await openRoom();
    const moderate = vi.spyOn(rules, "checkRules");

    const { message } = await use("send_message", {
      sessionId,
      recipient: provider,
      content: text(REFERENCE_ATTACK),
    });

    expect(message).toMatchObject({
      senderParticipantId: me,
      status: "blocked",
      verdict: { decision: "block", rule: "injection" },
    });
    expect(moderate).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: expect.objectContaining({
          participantId: me,
          agentId: agents.external,
        }),
        content: text(REFERENCE_ATTACK),
      }),
    );
    const { messages } = await use("wait_for_messages", {
      sessionId,
      timeoutMs: 0,
    });
    expect(messages.slice(1)).toMatchObject([
      message,
      {
        recipient: me,
        content: {
          kind: "ui",
          spec: {
            type: "moderator_alert",
            rule: "injection",
            blockedMessageId: message.messageId,
          },
        },
      },
    ]);
    await t.finishInProgressScheduledFunctions();
    expect(
      (await history(sessionId, provider)).map((m) => m.content.kind),
    ).toEqual(["system"]);

    const hosted = await hostedRoom();
    const fromHosted = await t.action(internal.gate.sendAsParticipant, {
      sessionId: hosted.sessionId,
      senderParticipantId: hosted.consumer,
      recipient: hosted.provider,
      content: text(REFERENCE_ATTACK),
    });
    expect(fromHosted).toMatchObject({
      status: message.status,
      verdict: message.verdict,
    });
  });

  it("criterion 3: open_session refuses a request carrying the reference attack and opens no room", async () => {
    const stored = async () => {
      const [sessions, messages] = await t.run(async (ctx) => [
        await ctx.db.query("sessions").collect(),
        await ctx.db.query("messages").collect(),
      ]);
      return { sessions: sessions.length, messages: messages.length };
    };
    const before = await stored();

    expect(
      await refusal("open_session", {
        targetAgentId: agents.clinic,
        intent: { ...intent, description: REFERENCE_ATTACK },
      }),
    ).toContain("RequestBlocked (injection)");

    expect(await stored()).toEqual(before);
    const fromHosted = await t
      .action(internal.rooms.open, {
        initiatorAgentId: agents.consumer,
        providerAgentId: agents.clinic,
        request: REFERENCE_ATTACK,
      })
      .catch((error: { data?: unknown }) => error.data);
    expect(fromHosted).toMatchObject({
      kind: "RequestBlocked",
      rule: "injection",
    });
  });

  it("criterion 5: a key cannot read, write or close a room its agent is not in", async () => {
    const { sessionId, provider } = await hostedRoom();
    const moderate = vi.spyOn(rules, "checkRules");
    const before = await history(sessionId, provider);

    for (const [name, args] of [
      ["wait_for_messages", { sessionId, timeoutMs: 0 }],
      ["send_message", { sessionId, content: text("Hola") }],
      [
        "send_message",
        { sessionId, recipient: provider, content: text("Hola") },
      ],
      ["close_session", { sessionId }],
    ] as const) {
      expect(await refusal(name, args)).toContain(NOT_IN_ROOM);
    }

    expect(await history(sessionId, provider)).toEqual(before);
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.status).toBe(
      "active",
    );
    expect(moderate).not.toHaveBeenCalled();
    for (const missing of ["not-a-room", agents.clinic]) {
      expect(
        await refusal("wait_for_messages", {
          sessionId: missing,
          timeoutMs: 0,
        }),
      ).toContain(NOT_IN_ROOM);
    }
  });

  it("send_message refuses a recipient from another room", async () => {
    const { sessionId } = await openRoom();
    const other = await hostedRoom();
    const before = await history(other.sessionId, other.provider);

    await refusal("send_message", {
      sessionId,
      recipient: other.provider,
      content: text("Hola"),
    });

    expect(await history(other.sessionId, other.provider)).toEqual(before);
  });

  it("list_sessions lists the active rooms the key's agent started, with the agents to address", async () => {
    expect(await use("list_sessions", {})).toEqual({
      sessions: [],
      truncated: false,
    });
    const { sessionId, provider } = await openRoom();
    const closed = await openRoom();
    await use("close_session", { sessionId: closed.sessionId });
    await hostedRoom();

    const room = {
      sessionId,
      request: REQUEST,
      agents: [{ participantId: provider, name: expect.any(String) }],
    };
    expect(await use("list_sessions", {})).toEqual({
      sessions: [room],
      truncated: false,
    });

    // Newest first, whatever the session ids happen to be.
    const newer = await openRoom();
    expect(await use("list_sessions", {})).toMatchObject({
      sessions: [{ sessionId: newer.sessionId }, room],
    });
  });

  it("close_session closes the room, later sends are refused and a wait returns at once", async () => {
    const { sessionId, provider } = await openRoom();

    expect(await use("close_session", { sessionId, reason: "Listo" })).toEqual({
      sessionId,
      status: "closed",
    });

    expect(
      await refusal("send_message", {
        sessionId,
        recipient: provider,
        content: text("Hola"),
      }),
    ).toMatch(/RoomClosed/);
    const read = await use("wait_for_messages", { sessionId, timeoutMs: 0 });
    expect(read.messages.at(-1)?.content).toMatchObject({
      code: "session_closed",
    });
    const started = Date.now();
    expect(
      await use("wait_for_messages", {
        sessionId,
        after: read.cursor,
        timeoutMs: 20000,
      }),
    ).toEqual({
      messages: [],
      cursor: read.cursor,
      sessionStatus: "closed",
      participants: read.participants,
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("wait_for_messages returns nothing when no message arrives before the timeout", async () => {
    const { sessionId } = await openRoom();
    const read = await use("wait_for_messages", { sessionId, timeoutMs: 0 });

    const started = Date.now();
    expect(
      await use("wait_for_messages", {
        sessionId,
        after: read.cursor,
        timeoutMs: 700,
      }),
    ).toEqual({
      messages: [],
      cursor: read.cursor,
      sessionStatus: "active",
      participants: read.participants,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
  });

  it("wait_for_messages returns by timeoutMs even when a read stalls", async () => {
    const { sessionId } = await openRoom();
    const read = await use("wait_for_messages", { sessionId, timeoutMs: 0 });
    const convex = t as ConvexCaller;
    let reads = 0;
    endpoint = createMcpEndpoint({
      query: (ref, ...args) => convex.query(ref, ...args),
      mutation: (ref, ...args) => convex.mutation(ref, ...args),
      action: (ref, ...args) =>
        getFunctionName(ref) === "mcpRooms:messages" && reads++ > 0
          ? new Promise<never>(() => {})
          : convex.action(ref, ...args),
    });
    const stalled = await connect("auto", apiKey);

    const started = performance.now();
    const result = await stalled.callTool({
      name: "wait_for_messages",
      arguments: { sessionId, after: read.cursor, timeoutMs: 1500 },
    });
    const elapsed = performance.now() - started;
    expect(result.structuredContent).toEqual({
      messages: [],
      cursor: read.cursor,
      sessionStatus: "active",
      participants: read.participants,
    });
    expect(reads).toBeGreaterThan(1);
    expect(elapsed).toBeGreaterThanOrEqual(1490);
    expect(elapsed).toBeLessThan(3000);
    await stalled.close();
  });

  it("wait_for_messages errors after FIRST_READ_MS when its first read stalls", async () => {
    const { sessionId } = await openRoom();
    const convex = t as ConvexCaller;
    endpoint = createMcpEndpoint({
      query: (ref, ...args) => convex.query(ref, ...args),
      mutation: (ref, ...args) => convex.mutation(ref, ...args),
      action: (ref, ...args) =>
        getFunctionName(ref) === "mcpRooms:messages"
          ? new Promise<never>(() => {})
          : convex.action(ref, ...args),
    });
    const stalled = await connect("auto", apiKey);

    const started = performance.now();
    const result = await stalled.callTool({
      name: "wait_for_messages",
      arguments: { sessionId, timeoutMs: 300 },
    });
    const elapsed = performance.now() - started;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Timeout");
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(5000);
    await stalled.close();
  });

  it("holds a key that calls Convex directly to the same request quota", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { sessionId } = await openRoom();
      const read = () => t.action(api.mcpRooms.messages, { apiKey, sessionId });
      await t.run(async (ctx) => {
        for (const key of await ctx.db.query("agentApiKeys").collect()) {
          await ctx.db.patch(key._id, { lastUsedAt: undefined });
        }
      });
      await expect(
        t.action(api.mcpRooms.messages, {
          apiKey,
          sessionId,
          after: "invalid",
        }),
      ).rejects.toMatchObject({ data: { kind: "InvalidArgument" } });
      const keys = await t.run((ctx) => ctx.db.query("agentApiKeys").collect());
      expect(keys.some((key) => key.lastUsedAt !== undefined)).toBe(true);
      let served = 0;
      let refusal = "";
      while (!refusal && served < 60) {
        await read().then(
          () => served++,
          (error) => {
            refusal = String(error.data?.kind ?? error);
          },
        );
      }
      expect(refusal).toBe("RateLimited");
      expect(served).toBeGreaterThan(0);
      expect(served).toBeLessThan(60);
      const limited = await endpoint(
        new Request(MCP_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      expect(limited.status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });

  const revokeKey = () =>
    t.run(async (ctx) => {
      for (const key of await ctx.db.query("agentApiKeys").collect()) {
        await ctx.db.patch(key._id, { revokedAt: Date.now() });
      }
    });

  // The judge runs between the key check and the final write: revoke the key there.
  const revokeDuringModeration = () => {
    const llm = providers.createFakeLlmProvider({
      object: () => ({ decision: "allow", rule: "purpose" }),
    });
    vi.spyOn(providers, "createLlmProvider").mockReturnValue({
      ...llm,
      async generateObject(args) {
        await revokeKey();
        return llm.generateObject(args);
      },
    });
  };

  it("send_message stores nothing when the key is revoked while moderation runs", async () => {
    const { sessionId, me, provider } = await openRoom();
    const before = await history(sessionId, me);
    revokeDuringModeration();

    expect(
      await refusal("send_message", {
        sessionId,
        recipient: provider,
        content: text("Hola"),
      }),
    ).toContain("Unauthorized: the API key is not valid");
    expect(await history(sessionId, me)).toEqual(before);
  });

  it("open_session opens no room when the key is revoked while moderation runs", async () => {
    revokeDuringModeration();
    expect(
      await refusal("open_session", { targetAgentId: agents.clinic, intent }),
    ).toContain("Unauthorized: the API key is not valid");
    expect(await t.run((ctx) => ctx.db.query("sessions").collect())).toEqual(
      await t.run((ctx) =>
        ctx.db
          .query("sessions")
          .filter((q) => q.neq(q.field("initiatorAgentId"), agents.external))
          .collect(),
      ),
    );
  });

  it("open_session opens no room if the bound owner changes during moderation", async () => {
    const setOwner = (ownerTokenIdentifier: string) =>
      t.run((ctx) =>
        ctx.db.patch("agents", agents.external, { ownerTokenIdentifier }),
      );
    await setOwner("https://clerk.example|original-owner");
    const llm = providers.createFakeLlmProvider({
      object: () => ({ decision: "allow", rule: "purpose" }),
    });
    vi.spyOn(providers, "createLlmProvider").mockReturnValue({
      ...llm,
      async generateObject(args) {
        await setOwner("https://clerk.example|new-owner");
        return llm.generateObject(args);
      },
    });

    expect(
      await refusal("open_session", { targetAgentId: agents.clinic, intent }),
    ).toContain("RoomOwnerChanged");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("sessions")
          .withIndex("by_initiatorAgentId_and_status", (q) =>
            q.eq("initiatorAgentId", agents.external),
          )
          .first(),
      ),
    ).toBeNull();
  });

  it("limits how often one external agent can ask the moderator, across its keys", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { sessionId } = await openRoom();
      const sent = [];
      for (let i = 0; i < 9; i++) {
        sent.push(
          await use("send_message", {
            sessionId,
            recipient: "all",
            content: text(`Mensaje ${i}`),
          }),
        );
      }
      expect(sent).toHaveLength(9);
      const { apiKey: otherKey } = await t.action(internal.agentKeys.issue, {
        slug: EXTERNAL_AGENT_SLUG,
      });
      const other = await connect("auto", otherKey);
      const result = await other.callTool({
        name: "send_message",
        arguments: { sessionId, recipient: "all", content: text("Uno más") },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("RateLimited");
      await other.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a room the agent rejoined, even if an older membership row has left", async () => {
    const { sessionId, me } = await openRoom();
    await t.run(async (ctx) => {
      await ctx.db.patch(me, { leftAt: Date.now() });
      await ctx.db.insert("participants", {
        sessionId,
        kind: "agent",
        agentId: agents.external,
        role: "initiator",
      });
    });
    const { messages } = await use("wait_for_messages", {
      sessionId,
      timeoutMs: 0,
    });
    expect(messages[0]?.content).toMatchObject({ code: "session_opened" });
  });

  describe("friends' agents", () => {
    const ANA = "https://clerk.example|ana";
    const BETO = "https://clerk.example|beto";
    const NOT_FRIEND =
      "NotFriend: you can only invite an agent that a friend owns";
    let friend: { agentId: Id<"agents">; client: Client };

    // Ana owns the key's agent, Beto owns a second external agent with its own key.
    async function friends({ autoApprove = false, linked = true } = {}) {
      const slug = "agenda-de-beto";
      await t.run(async (ctx) => {
        await ctx.db.patch("agents", agents.external, {
          ownerTokenIdentifier: ANA,
        });
        const external = await ctx.db.get("agents", agents.external);
        if (!external) throw new Error("missing external agent");
        const { _id, _creationTime, ...card } = external;
        await ctx.db.insert("agents", {
          ...card,
          slug,
          name: "Agenda de Beto",
          ownerTokenIdentifier: BETO,
        });
        if (!linked) return;
        await ctx.db.insert("friendships", {
          ownerTokenIdentifier: ANA,
          friendTokenIdentifier: BETO,
          friendName: "Beto Paz",
          autoApprove: false,
        });
        await ctx.db.insert("friendships", {
          ownerTokenIdentifier: BETO,
          friendTokenIdentifier: ANA,
          friendName: "Ana Rojas",
          autoApprove,
        });
      });
      const issued = await t.action(internal.agentKeys.issue, { slug });
      friend = {
        agentId: issued.agentId,
        client: await connect("auto", issued.apiKey),
      };
    }
    afterEach(() => friend?.client.close());

    const asFriend = async <N extends McpToolName>(
      name: N,
      args: Record<string, unknown> = {},
    ) => {
      const result = await friend.client.callTool({ name, arguments: args });
      return {
        error: result.isError ? JSON.stringify(result.content) : null,
        output: result.isError
          ? null
          : (MCP_TOOLS[name].output.parse(
              result.structuredContent,
            ) as Output<N>),
      };
    };
    const guests = (sessionId: Id<"sessions">) =>
      t.run(async (ctx) =>
        (
          await ctx.db
            .query("participants")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
            .collect()
        ).filter((p) => p.role === "guest"),
      );

    it("list_friend_agents lists the agents of the owner's friends, and none without an owner or friends", async () => {
      expect(await use("list_friend_agents", {})).toEqual({ agents: [] });
      await friends();
      expect(await use("list_friend_agents", {})).toEqual({
        agents: [
          expect.objectContaining({
            agentId: friend.agentId,
            name: "Agenda de Beto",
            friendName: "Beto Paz",
          }),
        ],
      });
      expect((await asFriend("list_friend_agents")).output).toEqual({
        agents: [
          expect.objectContaining({
            agentId: agents.external,
            friendName: "Ana Rojas",
          }),
        ],
      });
    });

    it("invite_agent leaves the request pending for the owner, and the guest reads the room only once approved", async () => {
      await friends();
      const { sessionId, me } = await openRoom();

      expect(
        await use("invite_agent", { sessionId, agentId: friend.agentId }),
      ).toEqual({ status: "pending" });
      expect(await guests(sessionId)).toEqual([]);
      expect((await asFriend("list_invitations")).output).toEqual({
        invitations: [
          { sessionId, status: "pending", inviterName: "Ana Rojas" },
        ],
        truncated: false,
      });
      expect(
        (await asFriend("wait_for_messages", { sessionId, timeoutMs: 0 }))
          .error,
      ).toContain(NOT_IN_ROOM);
      expect(
        await refusal("invite_agent", { sessionId, agentId: friend.agentId }),
      ).toContain("AlreadyInvited");

      const [{ invitationId }] = await t
        .withIdentity({ tokenIdentifier: BETO })
        .query(api.roomInvitations.inbox, {});
      await t
        .withIdentity({ tokenIdentifier: BETO })
        .mutation(api.roomInvitations.respond, { invitationId, approve: true });

      expect((await asFriend("list_invitations")).output).toEqual({
        invitations: [
          {
            sessionId,
            status: "approved",
            inviterName: "Ana Rojas",
            request: REQUEST,
          },
        ],
        truncated: false,
      });
      const seen = await asFriend("wait_for_messages", {
        sessionId,
        timeoutMs: 0,
      });
      expect(seen.output?.messages.map((m) => m.content)).toMatchObject([
        { kind: "system", code: "agent_joined" },
      ]);
      const room = await use("wait_for_messages", { sessionId, timeoutMs: 0 });
      const guest = room.participants.find((p) => p.role === "guest");
      expect(guest).toMatchObject({ kind: "agent", agentId: friend.agentId });
      expect(room.participants.map((p) => p.kind)).toEqual([
        "agent",
        "agent",
        "agent",
      ]);
      expect(seen.output?.participants).toEqual(room.participants);
      await use("send_message", {
        sessionId,
        recipient: guest?.participantId,
        content: text("¿Puede Beto el martes?"),
      });
      const next = await asFriend("wait_for_messages", {
        sessionId,
        after: seen.output?.cursor,
        timeoutMs: 0,
      });
      expect(next.output?.messages).toMatchObject([
        { senderParticipantId: me, content: text("¿Puede Beto el martes?") },
      ]);
    });

    it("invite_agent adds the agent at once when its owner auto-approves the caller's owner", async () => {
      await friends({ autoApprove: true });
      const { sessionId } = await openRoom();

      expect(
        await use("invite_agent", { sessionId, agentId: friend.agentId }),
      ).toEqual({ status: "approved" });
      expect(await guests(sessionId)).toMatchObject([
        { agentId: friend.agentId },
      ]);
      const { messages } = await use("wait_for_messages", {
        sessionId,
        timeoutMs: 0,
      });
      expect(messages.at(-1)?.content).toMatchObject({ code: "agent_joined" });
    });

    it("invite_agent refuses a stranger's agent, an agent that is not there and a key with no owner, all the same way", async () => {
      await friends({ linked: false });
      const { sessionId } = await openRoom();
      expect(
        await refusal("invite_agent", { sessionId, agentId: friend.agentId }),
      ).toContain(NOT_FRIEND);
      expect(
        await refusal("invite_agent", { sessionId, agentId: "nope" }),
      ).toContain(NOT_FRIEND);
      expect(
        await refusal("invite_agent", { sessionId, agentId: agents.clinic }),
      ).toContain(NOT_FRIEND);
      expect(await guests(sessionId)).toEqual([]);
    });

    it("invite_agent is for the agent that opened the room: not a guest, and not a key outside it", async () => {
      await friends({ autoApprove: true });
      const { sessionId } = await openRoom();
      const other = await hostedRoom();

      expect(
        await refusal("invite_agent", {
          sessionId: other.sessionId,
          agentId: friend.agentId,
        }),
      ).toContain(NOT_IN_ROOM);
      expect(
        (
          await asFriend("invite_agent", {
            sessionId,
            agentId: agents.external,
          })
        ).error,
      ).toContain(NOT_IN_ROOM);

      await use("invite_agent", { sessionId, agentId: friend.agentId });
      expect(
        (
          await asFriend("invite_agent", {
            sessionId,
            agentId: agents.external,
          })
        ).error,
      ).toContain("Forbidden");
    });

    it("list_invitations drops a room once it is closed and never shows another agent's invitations", async () => {
      await friends();
      const { sessionId } = await openRoom();
      await use("invite_agent", { sessionId, agentId: friend.agentId });

      expect(await use("list_invitations", {})).toEqual({
        invitations: [],
        truncated: false,
      });
      await use("close_session", { sessionId });
      expect((await asFriend("list_invitations")).output).toEqual({
        invitations: [],
        truncated: false,
      });
    });

    it("list_invitations still shows an active room behind many newer invitations to closed rooms", async () => {
      await friends();
      const { sessionId } = await openRoom();
      await use("invite_agent", { sessionId, agentId: friend.agentId });
      const closed = await openRoom();
      await use("close_session", { sessionId: closed.sessionId });
      await t.run(async (ctx) => {
        for (let i = 0; i < 60; i++) {
          await ctx.db.insert("roomInvitations", {
            sessionId: closed.sessionId,
            agentId: friend.agentId,
            inviterTokenIdentifier: ANA,
            inviterName: "Ana Rojas",
            ownerTokenIdentifier: BETO,
            status: "pending",
            autoApproved: false,
          });
        }
      });

      expect((await asFriend("list_invitations")).output).toEqual({
        invitations: [
          { sessionId, status: "pending", inviterName: "Ana Rojas" },
        ],
        truncated: false,
      });
    });

    it("list_invitations shows a room the agent is in ahead of a backlog of pending invitations", async () => {
      await friends({ autoApprove: true });
      const waiting = await openRoom();
      await t.run(async (ctx) => {
        for (let i = 0; i < 50; i++) {
          await ctx.db.insert("roomInvitations", {
            sessionId: waiting.sessionId,
            agentId: friend.agentId,
            inviterTokenIdentifier: ANA,
            inviterName: "Ana Rojas",
            ownerTokenIdentifier: BETO,
            status: "pending",
            autoApproved: false,
          });
        }
      });
      const { sessionId } = await openRoom();
      await use("invite_agent", { sessionId, agentId: friend.agentId });

      const { output } = await asFriend("list_invitations");
      expect(output?.invitations).toHaveLength(50);
      expect(output?.invitations[0]).toEqual({
        sessionId,
        status: "approved",
        inviterName: "Ana Rojas",
        request: REQUEST,
      });
      expect(output?.truncated).toBe(true);
    });

    it("list_friends shows each friend's own auto-approve switch and the friend link still waiting", async () => {
      await friends();
      // Beto lets Ana's invitations in; Ana does not return the favour.
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("friendships")
          .withIndex("by_ownerTokenIdentifier_and_friendTokenIdentifier", (q) =>
            q.eq("ownerTokenIdentifier", BETO).eq("friendTokenIdentifier", ANA),
          )
          .unique();
        if (!row) throw new Error("missing friendship");
        await ctx.db.patch("friendships", row._id, { autoApprove: true });
      });
      expect(await use("list_friends", {})).toEqual({
        friends: [{ name: "Beto Paz", autoApprovesYou: true }],
        inviteExpiresAt: null,
      });
      expect((await asFriend("list_friends")).output).toEqual({
        friends: [{ name: "Ana Rojas", autoApprovesYou: false }],
        inviteExpiresAt: null,
      });
      expect(
        await use("invite_agent", {
          sessionId: (await openRoom()).sessionId,
          agentId: friend.agentId,
        }),
      ).toEqual({ status: "approved" });

      const { expiresAt } = await t
        .withIdentity({ tokenIdentifier: ANA })
        .mutation(api.friends.createInvite, { displayName: "Ana Rojas" });
      expect((await use("list_friends", {})).inviteExpiresAt).toBe(expiresAt);
    });

    it("list_friends needs a linked human", async () => {
      expect(await refusal("list_friends", {})).toContain(
        "NotLinked: you have no human yet",
      );
    });
  });

  describe("whoami and renew_link", () => {
    const ANA = "https://clerk.example|ana";
    const codeOf = (url: string) => url.split("/").at(-1) ?? "";

    it("tells an unlinked agent so, and renew_link hands out a link that replaces the previous one", async () => {
      expect(await use("whoami", {})).toEqual({
        agentId: agents.external,
        name: expect.any(String),
        slug: EXTERNAL_AGENT_SLUG,
        published: expect.any(Boolean),
        linked: false,
        linkExpiresAt: null,
      });

      const first = await use("renew_link", {});
      expect(first.linkUrl).toMatch(
        new RegExp(`^${PUBLIC_ORIGIN}/link/[0-9a-f-]+$`),
      );
      expect((await use("whoami", {})).linkExpiresAt).toBe(first.expiresAt);

      const second = await use("renew_link", {});
      expect(
        await t.query(api.agentRegistration.linkInfo, {
          code: codeOf(first.linkUrl),
        }),
      ).toBeNull();

      await t
        .withIdentity({ tokenIdentifier: ANA })
        .mutation(api.agentRegistration.link, {
          code: codeOf(second.linkUrl),
        });
      expect(await use("whoami", {})).toMatchObject({
        linked: true,
        linkExpiresAt: null,
      });
      expect(await refusal("renew_link", {})).toContain(
        "AlreadyLinked: you are already linked to a human",
      );
    });
  });
});
