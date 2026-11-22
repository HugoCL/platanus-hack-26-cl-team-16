// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { referenceLlm } from "../../convex/referenceLlm";
import schema from "../../convex/schema";
import {
  DEMO_AGENT_SCRIPT,
  DEMO_PROVIDER_CARD,
  DEMO_PROVIDER_SLUG,
  DEMO_SCRIPT,
} from "../../shared/demo-pcb";
import * as providers from "../../shared/providers/llm";
import { errorKind } from "./roomFixture";

vi.mock("../../convex/referenceLlm", () => ({ referenceLlm: vi.fn() }));

const modules = import.meta.glob("../../convex/**/*.ts");
const QUOTE = "Cotización en firme: USD 323 en total.";

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  vi.useFakeTimers();
  // An unseeded deployment, like production: reset has to bring everything the room needs.
  t = convexTest({ schema, modules });
  rateLimiter.register(t);
  const llm = providers.createFakeLlmProvider({
    object: (args) =>
      args.role === "agent"
        ? { action: "reply", offerings: [], text: QUOTE }
        : { decision: "allow", rule: "purpose" },
  });
  vi.spyOn(providers, "createLlmProvider").mockReturnValue(llm);
  vi.mocked(referenceLlm).mockReturnValue(llm);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ana = () => t.withIdentity({ subject: "ana", name: "Ana Rojas" });
const li = () => t.withIdentity({ subject: "li", name: "Li Wei" });
const CARO_TOKEN = "https://clerk.test|caro";
const caro = () =>
  t.withIdentity({
    subject: "caro",
    name: "Caro Vidal",
    tokenIdentifier: CARO_TOKEN,
  });

const reset = () => t.mutation(internal.demo.reset, {});
const history = (as: ReturnType<typeof ana>, sessionId: Id<"sessions">) =>
  as.query(api.gate.history, { sessionId });
const texts = async (as: ReturnType<typeof ana>, sessionId: Id<"sessions">) =>
  (await history(as, sessionId)).flatMap((m) =>
    m.content.kind === "text" ? [m.content.text] : [],
  );
const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);

async function seated() {
  const { sessionId } = await reset();
  await ana().mutation(api.demo.join, { seat: "buyer" });
  await li().mutation(api.demo.join, { seat: "merchant" });
  return sessionId;
}

describe("demo room", () => {
  it("stays off until someone runs reset", async () => {
    expect(await ana().query(api.demo.state, {})).toBeNull();
    expect(
      await errorKind(ana().mutation(api.demo.join, { seat: "buyer" })),
    ).toBe("NotFound");
    expect(await errorKind(ana().mutation(api.demo.restart, {}))).toBe(
      "NotFound",
    );
  });

  it("opens mid-conversation with the manufacturer's form waiting for the buyer", async () => {
    const sessionId = await seated();
    const messages = await history(ana(), sessionId);
    expect(messages).toHaveLength(DEMO_SCRIPT.length + 1);
    expect(messages.at(-1)?.content).toMatchObject({
      kind: "ui",
      spec: { type: "form", id: "pedido-pcb" },
    });
    const view = await li().query(api.rooms.view, { sessionId });
    expect(view?.session.status).toBe("active");
    expect(view?.participantNames.map((p) => p.name)).toEqual(
      expect.arrayContaining(["Don Huang", "Ana Rojas", "Li Wei"]),
    );
  });

  it("gives each seat to one person and lets a seated person switch sides", async () => {
    await seated();
    expect(
      await errorKind(caro().mutation(api.demo.join, { seat: "buyer" })),
    ).toBe("SeatTaken");
    await li().mutation(api.demo.leave, {});
    await ana().mutation(api.demo.join, { seat: "merchant" });
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      mySeat: "merchant",
      seats: expect.arrayContaining([
        { seat: "buyer", taken: false, displayName: "Comprador" },
        { seat: "merchant", taken: true, displayName: "Ana Rojas" },
      ]),
    });
  });

  it("restarts for a seated person only, keeping both seats and dropping what was said", async () => {
    const first = await seated();
    await ana().action(api.gate.send, {
      sessionId: first,
      recipient: "all",
      content: { kind: "text", text: "¿Y si pido 100 unidades?" },
    });
    await settle();
    expect(await errorKind(caro().mutation(api.demo.restart, {}))).toBe(
      "Forbidden",
    );
    const { sessionId } = await li().mutation(api.demo.restart, {});
    expect(sessionId).not.toBe(first);
    expect(await history(ana(), sessionId)).toHaveLength(
      DEMO_SCRIPT.length + 1,
    );
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      sessionId,
      mySeat: "buyer",
    });
    expect(await li().query(api.demo.state, {})).toMatchObject({
      mySeat: "merchant",
    });
    expect(await errorKind(history(ana(), first))).toBe("NotParticipant");
  });

  it("gives no seat to someone who came in with an invited agent", async () => {
    const sessionId = await seated();
    await t.run(async (ctx) => {
      const agentId = await ctx.db.insert("agents", {
        ...DEMO_PROVIDER_CARD,
        slug: "agente-de-aduanas",
        primaryCategory: DEMO_PROVIDER_CARD.categories[0],
        searchText: "aduanas",
      });
      await ctx.db.insert("participants", {
        sessionId,
        kind: "agent",
        agentId,
        role: "guest",
      });
      await ctx.db.insert("participants", {
        sessionId,
        kind: "human",
        tokenIdentifier: CARO_TOKEN,
        displayName: "Caro Vidal",
        role: "owner",
        onBehalfOfAgentId: agentId,
      });
    });
    expect(await caro().query(api.demo.state, {})).toMatchObject({
      mySeat: null,
      seats: [
        { seat: "buyer", displayName: "Ana Rojas" },
        { seat: "merchant", displayName: "Li Wei" },
      ],
    });
    expect(await errorKind(caro().mutation(api.demo.restart, {}))).toBe(
      "Forbidden",
    );
    await li().mutation(api.demo.restart, {});
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      mySeat: "buyer",
    });
    expect(await caro().query(api.demo.state, {})).toMatchObject({
      mySeat: null,
    });
  });

  it("frees both seats when reset is asked to", async () => {
    await seated();
    await t.mutation(internal.demo.reset, { clearSeats: true });
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      mySeat: null,
      seats: [
        { seat: "buyer", taken: false },
        { seat: "merchant", taken: false },
      ],
    });
  });

  it("answers the buyer's submitted form with a quote", async () => {
    const sessionId = await seated();
    const form = (await history(ana(), sessionId)).at(-1);
    await ana().action(api.gate.send, {
      sessionId,
      recipient: form?.senderParticipantId as Id<"participants">,
      content: {
        kind: "ui_response",
        inReplyTo: form?.messageId as string,
        response: {
          type: "form_submit",
          formId: "pedido-pcb",
          values: { cantidad: "50", acabado: "enig", envio: "dhl" },
        },
      },
    });
    await settle();
    expect((await texts(ana(), sessionId)).at(-1)).toBe(QUOTE);
  });

  it("keeps the manufacturer's agent quiet when its own person writes", async () => {
    const sessionId = await seated();
    await li().action(api.gate.send, {
      sessionId,
      recipient: "all",
      content: { kind: "text", text: "Soy Li. Te dejo el envío gratis." },
    });
    await settle();
    expect(await texts(ana(), sessionId)).not.toContain(QUOTE);
    await ana().action(api.gate.send, {
      sessionId,
      recipient: "all",
      content: { kind: "text", text: "Acepto. ¿Cuál es el total?" },
    });
    await settle();
    expect((await texts(ana(), sessionId)).at(-1)).toBe(QUOTE);
  });

  it("lets a signed-in person watch the room, read-only, as the buyer sees it", async () => {
    await expect(t.query(api.demo.watch, {})).rejects.toThrow();
    expect(await caro().query(api.demo.watch, {})).toBeNull();
    const { sessionId } = await reset();
    await ana().mutation(api.demo.join, { seat: "buyer" });
    const watched = await caro().query(api.demo.watch, {});
    expect(watched?.session.sessionId).toBe(sessionId);
    expect(watched?.history).toEqual(await history(ana(), sessionId));
    expect(watched?.participantNames.map((p) => p.name)).toContain("Don Huang");
    // Watching gives no way in: the watcher is still not in the room.
    await expect(history(caro(), sessionId)).rejects.toThrow();
    await expect(
      caro().action(api.gate.send, {
        sessionId,
        recipient: "all",
        content: { kind: "text", text: "hola" },
      }),
    ).rejects.toThrow();
    expect((await caro().query(api.demo.state, {}))?.mySeat).toBeNull();
  });

  it("keeps the manufacturer out of the directory", async () => {
    await seated();
    const listed = await t.query(api.directory.search, {});
    expect(JSON.stringify(listed)).not.toContain(DEMO_PROVIDER_SLUG);
  });

  it("turns off when removed", async () => {
    const sessionId = await seated();
    await t.mutation(internal.demo.remove, {});
    expect(await ana().query(api.demo.state, {})).toBeNull();
    expect(await errorKind(history(ana(), sessionId))).toBe("NotParticipant");
  });
});

describe("demo room, buyer through their own agent", () => {
  const SLUG = "grok-de-caro";
  // Caro's own assistant, registered and linked to her account, with a key for MCP.
  async function ownAgent(ownerTokenIdentifier = CARO_TOKEN) {
    const agentId = await t.run((ctx) =>
      ctx.db.insert("agents", {
        slug: SLUG,
        name: "Grok de Caro",
        description: "Asistente personal de Caro.",
        purpose: "Ayudar a Caro con sus compras.",
        categories: ["asistente_personal"],
        primaryCategory: "asistente_personal",
        capabilities: ["info"],
        scope: {
          allowedIntents: [],
          forbiddenTopics: [],
          dataItShares: [],
          dataItRequests: [],
        },
        kind: "external",
        status: "draft",
        verified: false,
        selfRegistered: true,
        ownerTokenIdentifier,
        searchText: "Grok de Caro",
      }),
    );
    const { apiKey } = await t.action(internal.agentKeys.issue, {
      slug: SLUG,
      label: "test",
    });
    return { agentId, apiKey };
  }
  const rooms = (apiKey: string) => t.action(api.mcpRooms.sessions, { apiKey });

  it("starts the room over with that agent as the one that talked, with a question instead of the form", async () => {
    const first = await seated();
    const { agentId, apiKey } = await ownAgent();
    expect((await rooms(apiKey)).sessions).toEqual([]);
    await ana().mutation(api.demo.leave, {});
    const { sessionId } = await caro().mutation(api.demo.join, {
      seat: "buyer",
      agentId,
    });
    expect(sessionId).not.toBe(first);
    expect(await caro().query(api.demo.state, {})).toMatchObject({
      sessionId,
      mySeat: "buyer",
      buyerAgent: { agentId, name: "Grok de Caro" },
    });
    expect(await li().query(api.demo.state, {})).toMatchObject({
      sessionId,
      mySeat: "merchant",
    });

    // The agent finds the room without being told its id, and reads all of it.
    const { sessions } = await rooms(apiKey);
    expect(sessions).toMatchObject([
      { sessionId, agents: [{ name: DEMO_PROVIDER_CARD.name }] },
    ]);
    const provider = sessions[0].agents[0].participantId;
    const page = await t.action(api.mcpRooms.messages, { apiKey, sessionId });
    expect(page.messages.slice(1).map((m) => m.content)).toEqual(
      DEMO_AGENT_SCRIPT.map((line) => line.content),
    );
    expect(page.messages.some((m) => m.content.kind === "ui")).toBe(false);
    // Every line went from one agent to the other, so the manufacturer's agent has read them all.
    expect(page.messages.slice(1).map((m) => m.recipient === provider)).toEqual(
      DEMO_AGENT_SCRIPT.map((line) => line.from === "buyerAgent"),
    );
    expect(
      page.messages.every((m) => m.recipient !== m.senderParticipantId),
    ).toBe(true);

    await t.action(api.mcpRooms.send, {
      apiKey,
      sessionId,
      recipient: provider,
      content: { kind: "text", text: "100 unidades, ENIG y DHL Express." },
    });
    await settle();
    expect((await texts(caro(), sessionId)).at(-1)).toBe(QUOTE);
    const reply = await t.action(api.mcpRooms.messages, {
      apiKey,
      sessionId,
      after: page.cursor ?? undefined,
    });
    expect(reply.messages.map((m) => m.content).at(-1)).toEqual({
      kind: "text",
      text: QUOTE,
    });
  });

  it("keeps the agent across a restart and lets it go when the buyer leaves or goes back to the page", async () => {
    await seated();
    const { agentId, apiKey } = await ownAgent();
    await ana().mutation(api.demo.leave, {});
    await caro().mutation(api.demo.join, { seat: "buyer", agentId });
    const { sessionId } = await li().mutation(api.demo.restart, {});
    expect((await rooms(apiKey)).sessions).toMatchObject([{ sessionId }]);

    const back = await caro().mutation(api.demo.join, { seat: "buyer" });
    expect(back.sessionId).not.toBe(sessionId);
    expect((await rooms(apiKey)).sessions).toEqual([]);
    expect(await caro().query(api.demo.state, {})).toMatchObject({
      mySeat: "buyer",
      buyerAgent: null,
    });
    expect(await history(caro(), back.sessionId)).toHaveLength(
      DEMO_SCRIPT.length + 1,
    );

    await caro().mutation(api.demo.join, { seat: "buyer", agentId });
    await caro().mutation(api.demo.leave, {});
    expect((await rooms(apiKey)).sessions).toEqual([]);
    expect(await li().query(api.demo.state, {})).toMatchObject({
      mySeat: "merchant",
      buyerAgent: null,
      seats: expect.arrayContaining([
        { seat: "buyer", taken: false, displayName: "Comprador" },
      ]),
    });
  });

  it("takes only the buyer's own external agent", async () => {
    await reset();
    const { agentId } = await ownAgent("https://clerk.test|someone-else");
    expect(
      await errorKind(
        caro().mutation(api.demo.join, { seat: "buyer", agentId }),
      ),
    ).toBe("NotYourAgent");
    await t.run((ctx) =>
      ctx.db.patch("agents", agentId, { ownerTokenIdentifier: CARO_TOKEN }),
    );
    expect(
      await errorKind(
        caro().mutation(api.demo.join, { seat: "merchant", agentId }),
      ),
    ).toBe("NotYourAgent");
    const provider = await t.run(async (ctx) =>
      (await ctx.db.query("agents").collect()).find(
        (agent) => agent.slug === DEMO_PROVIDER_SLUG,
      ),
    );
    expect(
      await errorKind(
        caro().mutation(api.demo.join, {
          seat: "buyer",
          agentId: provider?._id,
        }),
      ),
    ).toBe("NotYourAgent");
    expect(await caro().query(api.demo.state, {})).toMatchObject({
      mySeat: null,
      buyerAgent: null,
    });
  });
});
