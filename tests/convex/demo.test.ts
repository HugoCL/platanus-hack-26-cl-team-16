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
import { PERSONAL_AGENT_SLUG_PREFIX } from "../../shared/mcp";
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

describe("demo room, a seat through its holder's own agent", () => {
  const SLUG = "grok-de-caro";
  // Caro's own assistant, registered and linked to her account, with a key for MCP.
  async function ownAgent(
    ownerTokenIdentifier = CARO_TOKEN,
    slug = SLUG,
    name = "Grok de Caro",
  ) {
    const agentId = await t.run((ctx) =>
      ctx.db.insert("agents", {
        slug,
        name,
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
      slug,
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
      agents: { buyer: { agentId, name: "Grok de Caro" }, merchant: null },
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
      agents: { buyer: null, merchant: null },
    });
    expect(await history(caro(), back.sessionId)).toHaveLength(
      DEMO_SCRIPT.length + 1,
    );

    await caro().mutation(api.demo.join, { seat: "buyer", agentId });
    await caro().mutation(api.demo.leave, {});
    expect((await rooms(apiKey)).sessions).toEqual([]);
    expect(await li().query(api.demo.state, {})).toMatchObject({
      mySeat: "merchant",
      agents: { buyer: null, merchant: null },
      seats: expect.arrayContaining([
        { seat: "buyer", taken: false, displayName: "Comprador" },
      ]),
    });
  });

  const LI_TOKEN = "https://clerk.test|li-wei";
  const liWei = () =>
    t.withIdentity({
      subject: "li-wei",
      name: "Li Wei",
      tokenIdentifier: LI_TOKEN,
    });
  const merchantAgent = () => ownAgent(LI_TOKEN, "bot-de-li", "Bot de Li");

  it("replaces the manufacturer's hosted agent with the merchant's own, which has to quote by itself", async () => {
    const { sessionId: first } = await reset();
    await ana().mutation(api.demo.join, { seat: "buyer" });
    const { agentId, apiKey } = await merchantAgent();
    expect((await rooms(apiKey)).sessions).toEqual([]);
    const { sessionId } = await liWei().mutation(api.demo.join, {
      seat: "merchant",
      agentId,
    });
    expect(sessionId).not.toBe(first);
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      sessionId,
      mySeat: "buyer",
      agents: { buyer: null, merchant: { agentId, name: "Bot de Li" } },
    });
    const view = await ana().query(api.rooms.view, { sessionId });
    const names = view?.participantNames.map((p) => p.name);
    expect(names).toContain("Bot de Li");
    expect(names).not.toContain(DEMO_PROVIDER_CARD.name);

    // The merchant's agent finds the room it did not open, and reads what its side said.
    expect((await rooms(apiKey)).sessions).toMatchObject([{ sessionId }]);
    const page = await t.action(api.mcpRooms.messages, { apiKey, sessionId });
    const form = page.messages.at(-1);
    expect(form?.content).toMatchObject({ kind: "ui", spec: { type: "form" } });

    // Nobody answers the buyer's form for it.
    await ana().action(api.gate.send, {
      sessionId,
      recipient: form?.senderParticipantId as Id<"participants">,
      content: {
        kind: "ui_response",
        inReplyTo: form?.messageId as string,
        response: {
          type: "form_submit",
          formId: "pedido-pcb",
          values: { cantidad: "100", acabado: "enig", envio: "dhl" },
        },
      },
    });
    await settle();
    expect(await texts(ana(), sessionId)).not.toContain(QUOTE);
    const order = await t.action(api.mcpRooms.messages, {
      apiKey,
      sessionId,
      after: page.cursor ?? undefined,
    });
    expect(order.messages.map((m) => m.content.kind)).toEqual(["ui_response"]);

    await t.action(api.mcpRooms.send, {
      apiKey,
      sessionId,
      recipient: "all",
      content: { kind: "text", text: "Total: USD 468." },
    });
    await settle();
    expect((await texts(ana(), sessionId)).at(-1)).toBe("Total: USD 468.");

    // A restart keeps the agent; leaving the seat brings the hosted one back.
    const again = await ana().mutation(api.demo.restart, {});
    expect((await rooms(apiKey)).sessions).toMatchObject([
      { sessionId: again.sessionId },
    ]);
    await liWei().mutation(api.demo.leave, {});
    expect((await rooms(apiKey)).sessions).toEqual([]);
    const state = await ana().query(api.demo.state, {});
    expect(state).toMatchObject({
      mySeat: "buyer",
      agents: { buyer: null, merchant: null },
    });
    const back = await ana().query(api.rooms.view, {
      sessionId: state?.sessionId as Id<"sessions">,
    });
    expect(back?.participantNames.map((p) => p.name)).toContain(
      DEMO_PROVIDER_CARD.name,
    );
  });

  it("lets both seats talk through their own agents, with no hosted agent answering", async () => {
    await reset();
    const buyer = await ownAgent();
    const merchant = await merchantAgent();
    await caro().mutation(api.demo.join, {
      seat: "buyer",
      agentId: buyer.agentId,
    });
    const { sessionId } = await liWei().mutation(api.demo.join, {
      seat: "merchant",
      agentId: merchant.agentId,
    });
    expect(await caro().query(api.demo.state, {})).toMatchObject({
      sessionId,
      agents: {
        buyer: { agentId: buyer.agentId },
        merchant: { agentId: merchant.agentId },
      },
    });
    const mine = await rooms(buyer.apiKey);
    expect(mine.sessions).toMatchObject([
      { sessionId, agents: [{ name: "Bot de Li" }] },
    ]);
    expect((await rooms(merchant.apiKey)).sessions).toMatchObject([
      { sessionId, agents: [{ name: "Grok de Caro" }] },
    ]);
    const seen = await t.action(api.mcpRooms.messages, {
      apiKey: merchant.apiKey,
      sessionId,
    });
    expect(seen.messages.slice(1).map((m) => m.content)).toEqual(
      DEMO_AGENT_SCRIPT.map((line) => line.content),
    );

    await t.action(api.mcpRooms.send, {
      apiKey: buyer.apiKey,
      sessionId,
      recipient: mine.sessions[0].agents[0].participantId,
      content: { kind: "text", text: "100 unidades, ENIG y DHL Express." },
    });
    await settle();
    expect(await texts(caro(), sessionId)).not.toContain(QUOTE);
    const order = await t.action(api.mcpRooms.messages, {
      apiKey: merchant.apiKey,
      sessionId,
      after: seen.cursor ?? undefined,
    });
    expect(order.messages.map((m) => m.content)).toEqual([
      { kind: "text", text: "100 unidades, ENIG y DHL Express." },
    ]);
    await t.action(api.mcpRooms.send, {
      apiKey: merchant.apiKey,
      sessionId,
      recipient: "all",
      content: { kind: "text", text: "Total: USD 468." },
    });
    const reply = await t.action(api.mcpRooms.messages, {
      apiKey: buyer.apiKey,
      sessionId,
    });
    expect(reply.messages.at(-1)?.content).toEqual({
      kind: "text",
      text: "Total: USD 468.",
    });
  });

  it("still finds, and replaces, a room made before demo rooms were marked", async () => {
    const sessionId = await seated();
    await t.run((ctx) =>
      ctx.db.patch("sessions", sessionId, { demo: undefined }),
    );
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      sessionId,
      mySeat: "buyer",
    });
    const next = await li().mutation(api.demo.restart, {});
    expect(await t.run((ctx) => ctx.db.get("sessions", sessionId))).toBeNull();
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      sessionId: next.sessionId,
      mySeat: "buyer",
    });
  });

  it("takes only the seat holder's own external agent", async () => {
    await reset();
    const { agentId } = await ownAgent("https://clerk.test|someone-else");
    expect(
      await errorKind(
        caro().mutation(api.demo.join, { seat: "buyer", agentId }),
      ),
    ).toBe("NotYourAgent");
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
      agents: { buyer: null, merchant: null },
    });
  });

  it("removes an old agent for good and moves its seat to the newest one left", async () => {
    await seated();
    await ana().mutation(api.demo.leave, {});
    const old = await ownAgent(CARO_TOKEN, "grok-viejo", "Grok viejo");
    vi.advanceTimersByTime(1000);
    const fresh = await ownAgent(CARO_TOKEN, "grok-nuevo", "Grok nuevo");
    const demo = await caro().mutation(api.demo.join, {
      seat: "buyer",
      agentId: old.agentId,
    });
    // More keys than one batch of rows, the last of them the one to check.
    let spare = "";
    for (let i = 0; i < 101; i++) {
      spare = (
        await t.action(internal.agentKeys.issue, {
          slug: "grok-viejo",
          label: `extra ${i}`,
        })
      ).apiKey;
    }
    // What else the old agent left behind: a room it opened and an invitation nobody answered.
    const left = await t.run(async (ctx) => {
      const session = await ctx.db.get("sessions", demo.sessionId);
      if (!session) throw new Error("no demo room");
      const { _id, _creationTime, demo: _demo, ...room } = session;
      const sessionId = await ctx.db.insert("sessions", room);
      const invitationId = await ctx.db.insert("roomInvitations", {
        sessionId,
        agentId: old.agentId,
        inviterTokenIdentifier: "https://clerk.test|friend",
        inviterName: "Amiga",
        ownerTokenIdentifier: CARO_TOKEN,
        status: "pending",
        autoApproved: false,
      });
      return { sessionId, invitationId };
    });

    await caro().mutation(api.demo.forgetAgents, { agentIds: [old.agentId] });

    const state = await caro().query(api.demo.state, {});
    expect(state).toMatchObject({
      mySeat: "buyer",
      agents: {
        buyer: { agentId: fresh.agentId, name: "Grok nuevo" },
        merchant: null,
      },
    });
    expect(state?.sessionId).not.toBe(demo.sessionId);
    expect((await rooms(fresh.apiKey)).sessions).toMatchObject([
      { sessionId: state?.sessionId },
    ]);
    expect(await errorKind(rooms(old.apiKey))).toBe("Unauthorized");
    expect(await errorKind(rooms(spare))).toBe("Unauthorized");
    expect(
      (await caro().query(api.agentRegistration.mine, {})).map((a) => a.slug),
    ).toEqual(["grok-nuevo"]);
    const after = await t.run(async (ctx) => ({
      agent: await ctx.db.get("agents", old.agentId),
      room: await ctx.db.get("sessions", left.sessionId),
      invitation: await ctx.db.get("roomInvitations", left.invitationId),
    }));
    expect(after.agent).toMatchObject({ status: "draft" });
    expect(after.agent?.ownerTokenIdentifier).toBeUndefined();
    expect(after.room).toMatchObject({
      status: "closed",
      closedReason: "agent_removed",
    });
    expect(after.invitation?.status).toBe("cancelled");
  });

  it("goes back to the hosted agent when the seat's holder removes their only agent", async () => {
    await seated();
    const { agentId, apiKey } = await ownAgent(
      "https://clerk.test|li",
      "bot-de-li",
      "Bot de Li",
    );
    const liWei = () =>
      t.withIdentity({
        subject: "li",
        name: "Li Wei",
        tokenIdentifier: "https://clerk.test|li",
      });
    await li().mutation(api.demo.leave, {});
    await liWei().mutation(api.demo.join, { seat: "merchant", agentId });
    expect((await rooms(apiKey)).sessions).toHaveLength(1);

    await liWei().mutation(api.demo.forgetAgents, { agentIds: [agentId] });

    expect(await liWei().query(api.demo.state, {})).toMatchObject({
      mySeat: "merchant",
      agents: { buyer: null, merchant: null },
    });
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      mySeat: "buyer",
    });
    expect(await liWei().query(api.agentRegistration.mine, {})).toEqual([]);
  });

  it("removes only the caller's own agents, never the one from signing in, and all or none", async () => {
    await reset();
    const mine = await ownAgent();
    const theirs = await ownAgent(
      "https://clerk.test|someone-else",
      "bot-ajeno",
      "Bot ajeno",
    );
    const personal = await ownAgent(
      CARO_TOKEN,
      `${PERSONAL_AGENT_SLUG_PREFIX}0123456789abcdef01234567`,
      "Mi agente personal",
    );
    for (const refused of [theirs.agentId, personal.agentId]) {
      expect(
        await errorKind(
          caro().mutation(api.demo.forgetAgents, {
            agentIds: [mine.agentId, refused],
          }),
        ),
      ).toBe("NotYourAgent");
    }
    expect(
      await errorKind(
        t.mutation(api.demo.forgetAgents, { agentIds: [mine.agentId] }),
      ),
    ).toBe("Unauthorized");
    // Nothing was removed: all three keys still work.
    for (const { apiKey } of [mine, theirs, personal]) {
      expect((await rooms(apiKey)).sessions).toEqual([]);
    }
    expect(await caro().query(api.agentRegistration.mine, {})).toHaveLength(2);
  });

  it("removes a registered agent that is only named like the one from signing in", async () => {
    await reset();
    const { agentId, apiKey } = await ownAgent(
      CARO_TOKEN,
      `${PERSONAL_AGENT_SLUG_PREFIX}8f14e45f-ceea-467f-a9f1-0c1b2d3e4f5a`,
      "Agente personal",
    );
    await caro().mutation(api.demo.forgetAgents, { agentIds: [agentId] });
    expect(await errorKind(rooms(apiKey))).toBe("Unauthorized");
    expect(await caro().query(api.agentRegistration.mine, {})).toEqual([]);
  });
});
