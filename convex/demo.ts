import { ConvexError, v } from "convex/values";
import { effectiveAllowedIntents } from "../shared/agent";
import {
  DEMO_CATEGORY,
  DEMO_INTENT,
  DEMO_KNOWLEDGE,
  DEMO_MAX_TURNS,
  DEMO_OFFERINGS,
  DEMO_PROVIDER_CARD,
  DEMO_PROVIDER_INSTRUCTIONS,
  DEMO_PROVIDER_SLUG,
  DEMO_SCRIPT,
  DEMO_SEATS,
  type DemoSeat,
} from "../shared/demo-pcb";
import { CONSUMER_AGENT_SLUG, SEED_AGENTS } from "../shared/seed-data";
import type { SessionContract } from "../shared/session";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { insertMessage } from "./roomMessages";
import { requireRoomIdentity } from "./roomState";

// The resettable live demo room (docs/demo.md): a buyer and a PCB manufacturer in Shenzhen, in
// a room that opens mid-conversation with the manufacturer's order form still unanswered.
//
// A human turns the demo on by running `demo:reset` once (`pnpm demo:reset`; on production,
// `npx convex run --prod demo:reset`). Until then the public functions below find nothing. After
// that, two signed-in people take the seats on /demo and either of them can restart the room.
//
// The demo room is the room the demo provider is in. That agent is an unlisted draft, so nobody
// opens another room with it from the directory.

const seat = v.union(v.literal("buyer"), v.literal("merchant"));
const SEATS = Object.keys(DEMO_SEATS) as DemoSeat[];
const MAX_DEMO_ROOMS = 20;
const MAX_ROOM_ROWS = 500;

type Seats = Record<DemoSeat, { tokenIdentifier: string; displayName: string }>;

const emptySeats = (): Seats => ({
  buyer: {
    tokenIdentifier: DEMO_SEATS.buyer.placeholder,
    displayName: DEMO_SEATS.buyer.displayName,
  },
  merchant: {
    tokenIdentifier: DEMO_SEATS.merchant.placeholder,
    displayName: DEMO_SEATS.merchant.displayName,
  },
});

function fail(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

const searchText = (card: (typeof SEED_AGENTS)[number]["card"]) =>
  [card.name, card.description, card.purpose, card.categories.join(" ")].join(
    " ",
  );

function agentBySlug(ctx: QueryCtx, slug: string) {
  return ctx.db
    .query("agents")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

// The buyer's agent is the platform's consumer agent, the only one that plays the consumer.
// A deployment that was never seeded gets it here.
async function ensureBuyerAgent(ctx: MutationCtx) {
  const existing = await agentBySlug(ctx, CONSUMER_AGENT_SLUG);
  if (existing) return existing._id;
  const card = SEED_AGENTS.find(
    (seed) => seed.card.slug === CONSUMER_AGENT_SLUG,
  )?.card;
  if (!card) throw new Error("demo: the consumer agent card is missing");
  const agentId = await ctx.db.insert("agents", {
    ...card,
    primaryCategory: card.categories[0],
    searchText: searchText(card),
  });
  await ctx.db.insert("hostedAgentConfigs", {
    agentId,
    systemPrompt: `Eres ${card.name}. ${card.purpose} No compartas más datos de los necesarios.`,
    tools: ["search_agents", "open_session", "send_message"],
  });
  return agentId;
}

// Writes the manufacturer's card, prompt, offerings and price list, replacing what a previous
// reset wrote, so an edit to shared/demo-pcb.ts reaches a deployment on the next reset.
async function ensureProvider(ctx: MutationCtx) {
  const category = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", DEMO_CATEGORY.slug))
    .first();
  if (!category) await ctx.db.insert("categories", DEMO_CATEGORY);
  const card = {
    ...DEMO_PROVIDER_CARD,
    primaryCategory: DEMO_PROVIDER_CARD.categories[0],
    searchText: searchText(DEMO_PROVIDER_CARD),
  };
  const existing = await agentBySlug(ctx, DEMO_PROVIDER_SLUG);
  const agentId = existing?._id ?? (await ctx.db.insert("agents", card));
  if (existing) {
    await ctx.db.patch("agents", agentId, card);
    await deleteProviderData(ctx, agentId);
  }
  await ctx.db.insert("hostedAgentConfigs", {
    agentId,
    systemPrompt: DEMO_PROVIDER_INSTRUCTIONS,
    tools: [],
  });
  for (const offering of DEMO_OFFERINGS) {
    await ctx.db.insert("offerings", {
      agentId,
      kind: "product",
      category: DEMO_CATEGORY.slug,
      images: [],
      active: true,
      ...offering,
    });
  }
  await ctx.db.insert("agentSources", {
    agentId,
    kind: "text",
    status: "ready",
    ...DEMO_KNOWLEDGE,
  });
  return agentId;
}

async function deleteProviderData(ctx: MutationCtx, agentId: Id<"agents">) {
  const rows = [
    ...(await ctx.db
      .query("hostedAgentConfigs")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .take(MAX_ROOM_ROWS)),
    ...(await ctx.db
      .query("offerings")
      .withIndex("by_agentId_and_active", (q) => q.eq("agentId", agentId))
      .take(MAX_ROOM_ROWS)),
    ...(await ctx.db
      .query("agentSources")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .take(MAX_ROOM_ROWS)),
  ];
  for (const row of rows) await ctx.db.delete(row._id);
}

function demoRooms(ctx: QueryCtx, providerId: Id<"agents">) {
  return ctx.db
    .query("participants")
    .withIndex("by_agentId_and_sessionId", (q) => q.eq("agentId", providerId))
    .order("desc")
    .take(MAX_DEMO_ROOMS);
}

function members(ctx: QueryCtx, sessionId: Id<"sessions">) {
  return ctx.db
    .query("participants")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_ROOM_ROWS);
}

// The seat a human holds is the agent they are in the room for.
function seatOf(
  member: Doc<"participants">,
  providerId: Id<"agents">,
): DemoSeat | null {
  if (member.kind !== "human" || member.leftAt !== undefined) return null;
  return member.onBehalfOfAgentId === providerId ? "merchant" : "buyer";
}

async function deleteRoom(ctx: MutationCtx, sessionId: Id<"sessions">) {
  const rows = [
    ...(await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(MAX_ROOM_ROWS)),
    ...(await ctx.db
      .query("moderationEvents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(MAX_ROOM_ROWS)),
    ...(await ctx.db
      .query("roomInvitations")
      .withIndex("by_sessionId_and_status", (q) => q.eq("sessionId", sessionId))
      .take(MAX_ROOM_ROWS)),
    ...(await ctx.db
      .query("transactions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(MAX_ROOM_ROWS)),
    ...(await members(ctx, sessionId)),
  ];
  for (const row of rows) await ctx.db.delete(row._id);
  await ctx.db.delete(sessionId);
}

// Deletes the demo rooms and opens a fresh one, keeping whoever holds each seat.
async function rebuild(ctx: MutationCtx, clearSeats: boolean) {
  const buyerAgentId = await ensureBuyerAgent(ctx);
  const providerId = await ensureProvider(ctx);
  const provider = await ctx.db.get("agents", providerId);
  if (!provider) throw new Error("demo: the provider vanished");

  const seats = emptySeats();
  const rooms = await demoRooms(ctx, providerId);
  // Oldest first, so the newest room's seats win.
  for (const room of rooms.reverse()) {
    for (const member of await members(ctx, room.sessionId)) {
      const held = seatOf(member, providerId);
      if (held && member.kind === "human" && !clearSeats) {
        seats[held] = {
          tokenIdentifier: member.tokenIdentifier,
          displayName: member.displayName,
        };
      }
    }
    await deleteRoom(ctx, room.sessionId);
  }

  const contract: SessionContract = {
    intent: DEMO_INTENT,
    purpose: provider.purpose,
    capabilities: provider.capabilities,
    allowedIntents: effectiveAllowedIntents(provider),
    forbiddenTopics: provider.scope.forbiddenTopics,
    recipientShares: provider.scope.dataItShares,
    recipientRequests: provider.scope.dataItRequests,
    maxTurns: DEMO_MAX_TURNS,
    maxViolations: 3,
  };
  const sessionId = await ctx.db.insert("sessions", {
    initiatorAgentId: buyerAgentId,
    intent: DEMO_INTENT,
    contract,
    mode: "moderated",
    status: "active",
    turnCount: 0,
    violationCount: 0,
  });
  const speakers = {
    buyerAgent: await ctx.db.insert("participants", {
      sessionId,
      kind: "agent",
      agentId: buyerAgentId,
      role: "initiator",
    }),
    providerAgent: await ctx.db.insert("participants", {
      sessionId,
      kind: "agent",
      agentId: providerId,
      role: "recipient",
    }),
    buyer: await ctx.db.insert("participants", {
      sessionId,
      kind: "human",
      ...seats.buyer,
      role: "owner",
      onBehalfOfAgentId: buyerAgentId,
    }),
    // An operator, so the room keeps a single owner: the person a provider sends its cards to.
    merchant: await ctx.db.insert("participants", {
      sessionId,
      kind: "human",
      ...seats.merchant,
      role: "operator",
      onBehalfOfAgentId: providerId,
    }),
  };
  const allowed = (reason: string) => ({
    status: "allowed" as const,
    verdict: { decision: "allow" as const, reason },
    reasons: [],
  });
  await insertMessage(ctx, {
    sessionId,
    recipient: "all",
    content: {
      kind: "system",
      code: "session_opened",
      text: `Sala abierta. Petición: ${DEMO_INTENT.description}`,
    },
    moderation: allowed("Aviso de la plataforma."),
  });
  for (const line of DEMO_SCRIPT) {
    await insertMessage(ctx, {
      sessionId,
      senderParticipantId: speakers[line.from],
      recipient: line.to === "all" ? "all" : speakers[line.to],
      content: line.content,
      moderation: allowed("Dentro del propósito de la sala."),
    });
  }
  return sessionId;
}

// The current demo room and the caller's seat in it, or null while the demo is off.
async function current(ctx: QueryCtx, tokenIdentifier: string) {
  const provider = await agentBySlug(ctx, DEMO_PROVIDER_SLUG);
  if (!provider) return null;
  const [room] = await demoRooms(ctx, provider._id);
  if (!room) return null;
  const humans = (await members(ctx, room.sessionId)).flatMap((member) => {
    const held = seatOf(member, provider._id);
    return held && member.kind === "human" ? [{ seat: held, member }] : [];
  });
  return {
    sessionId: room.sessionId,
    humans,
    mine: humans.find((h) => h.member.tokenIdentifier === tokenIdentifier),
  };
}

const isPlaceholder = (tokenIdentifier: string) =>
  SEATS.some((s) => DEMO_SEATS[s].placeholder === tokenIdentifier);

export const reset = internalMutation({
  args: { clearSeats: v.optional(v.boolean()) },
  returns: v.object({ sessionId: v.id("sessions") }),
  handler: async (ctx, { clearSeats }) => {
    const sessionId = await rebuild(ctx, clearSeats === true);
    console.log(`demo: room ${sessionId} is ready, open /demo to take a seat`);
    return { sessionId };
  },
});

// Turns the demo off: removes the demo rooms and what the manufacturer knows. Its card stays, as
// the unlisted draft it always was.
export const remove = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const provider = await agentBySlug(ctx, DEMO_PROVIDER_SLUG);
    if (!provider) return null;
    for (const room of await demoRooms(ctx, provider._id)) {
      await deleteRoom(ctx, room.sessionId);
    }
    await deleteProviderData(ctx, provider._id);
    return null;
  },
});

export const state = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      sessionId: v.id("sessions"),
      mySeat: v.union(seat, v.null()),
      seats: v.array(
        v.object({ seat, taken: v.boolean(), displayName: v.string() }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    const demo = await current(ctx, tokenIdentifier);
    if (!demo) return null;
    return {
      sessionId: demo.sessionId,
      mySeat: demo.mine?.seat ?? null,
      seats: demo.humans.map(({ seat, member }) => ({
        seat,
        taken: !isPlaceholder(member.tokenIdentifier),
        displayName: member.displayName,
      })),
    };
  },
});

// Takes a free seat. Someone who already holds the other seat moves, so one person can rehearse
// both sides. The name is what the room shows the other side; it is not verified.
export const join = mutation({
  args: { seat, name: v.optional(v.string()) },
  returns: v.object({ sessionId: v.id("sessions") }),
  handler: async (ctx, args) => {
    const identity = await requireRoomIdentity(ctx);
    const demo = await current(ctx, identity.tokenIdentifier);
    if (!demo) fail("NotFound", "the demo room is not set up");
    const target = demo.humans.find((h) => h.seat === args.seat);
    if (!target) fail("NotFound", "the demo room has no such seat");
    if (demo.mine?.seat === args.seat) return { sessionId: demo.sessionId };
    if (!isPlaceholder(target.member.tokenIdentifier)) {
      fail("SeatTaken", "someone else holds that seat");
    }
    if (demo.mine) {
      await ctx.db.patch("participants", demo.mine.member._id, {
        tokenIdentifier: DEMO_SEATS[demo.mine.seat].placeholder,
        displayName: DEMO_SEATS[demo.mine.seat].displayName,
      });
    }
    await ctx.db.patch("participants", target.member._id, {
      tokenIdentifier: identity.tokenIdentifier,
      displayName: (
        args.name?.trim() ||
        identity.name?.trim() ||
        DEMO_SEATS[args.seat].displayName
      ).slice(0, 120),
    });
    return { sessionId: demo.sessionId };
  },
});

export const leave = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    const demo = await current(ctx, tokenIdentifier);
    if (!demo?.mine) return null;
    await ctx.db.patch("participants", demo.mine.member._id, {
      tokenIdentifier: DEMO_SEATS[demo.mine.seat].placeholder,
      displayName: DEMO_SEATS[demo.mine.seat].displayName,
    });
    return null;
  },
});

// Only someone seated in the demo room can restart it.
export const restart = mutation({
  args: {},
  returns: v.object({ sessionId: v.id("sessions") }),
  handler: async (ctx) => {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    const demo = await current(ctx, tokenIdentifier);
    if (!demo) fail("NotFound", "the demo room is not set up");
    if (!demo.mine) fail("Forbidden", "take a seat to restart the demo room");
    return { sessionId: await rebuild(ctx, false) };
  },
});
