import { ConvexError, v } from "convex/values";
import { effectiveAllowedIntents } from "../shared/agent";
import {
  DEMO_AGENT_SCRIPT,
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
import { historyForViewer } from "./gate";
import { insertMessage } from "./roomMessages";
import { loadSession, requireRoomIdentity, toParticipant } from "./roomState";

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

// Unless the buyer brings their own agent, theirs is the platform's consumer agent. A deployment
// that was never seeded gets it here.
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

type SeatAgents = Record<DemoSeat, Id<"agents">>;

// The seat a human holds is the agent they are in the room for. Someone who came in with an
// invited agent holds neither seat.
function seatOf(
  member: Doc<"participants">,
  agents: SeatAgents,
): DemoSeat | null {
  if (member.kind !== "human" || member.leftAt !== undefined) return null;
  return SEATS.find((s) => agents[s] === member.onBehalfOfAgentId) ?? null;
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

// The external agent a person may bring to the buyer's seat: one of their own.
async function ownAgent(
  ctx: QueryCtx,
  agentId: Id<"agents">,
  tokenIdentifier: string,
) {
  const agent = await ctx.db.get("agents", agentId);
  return agent?.kind === "external" &&
    agent.ownerTokenIdentifier === tokenIdentifier
    ? agent
    : null;
}

// Deletes the demo rooms and opens a fresh one, keeping whoever holds each seat. The buyer's
// agent is `buyerAgentId`, or the one the last room had while the buyer's seat is still held by
// its owner, or the consumer agent.
async function rebuild(
  ctx: MutationCtx,
  {
    clearSeats = false,
    buyerAgentId: chosen,
  }: { clearSeats?: boolean; buyerAgentId?: Id<"agents"> | null } = {},
) {
  const consumerAgentId = await ensureBuyerAgent(ctx);
  const providerId = await ensureProvider(ctx);
  const provider = await ctx.db.get("agents", providerId);
  if (!provider) throw new Error("demo: the provider vanished");

  const seats = emptySeats();
  let kept: Id<"agents"> | null = null;
  const rooms = await demoRooms(ctx, providerId);
  // Oldest first, so the newest room's seats win.
  for (const room of rooms.reverse()) {
    const session = await ctx.db.get("sessions", room.sessionId);
    kept = session?.initiatorAgentId ?? null;
    for (const member of await members(ctx, room.sessionId)) {
      const held = seatOf(member, {
        buyer: kept ?? consumerAgentId,
        merchant: providerId,
      });
      if (held && member.kind === "human" && !clearSeats) {
        seats[held] = {
          tokenIdentifier: member.tokenIdentifier,
          displayName: member.displayName,
        };
      }
    }
    await deleteRoom(ctx, room.sessionId);
  }
  const wanted = chosen === undefined ? kept : chosen;
  const own =
    wanted && (await ownAgent(ctx, wanted, seats.buyer.tokenIdentifier));
  const buyerAgentId = own ? own._id : consumerAgentId;

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
  for (const line of own ? DEMO_AGENT_SCRIPT : DEMO_SCRIPT) {
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
  const session = room && (await ctx.db.get("sessions", room.sessionId));
  if (!session) return null;
  const agents = { buyer: session.initiatorAgentId, merchant: provider._id };
  const humans = (await members(ctx, room.sessionId)).flatMap((member) => {
    const held = seatOf(member, agents);
    return held && member.kind === "human" ? [{ seat: held, member }] : [];
  });
  return {
    sessionId: room.sessionId,
    buyerAgentId: agents.buyer,
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
    const sessionId = await rebuild(ctx, { clearSeats });
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
      // Set while the buyer talks through their own agent instead of the room's page.
      buyerAgent: v.union(
        v.null(),
        v.object({ agentId: v.id("agents"), name: v.string() }),
      ),
      seats: v.array(
        v.object({ seat, taken: v.boolean(), displayName: v.string() }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    const demo = await current(ctx, tokenIdentifier);
    if (!demo) return null;
    const buyerAgent = await ctx.db.get("agents", demo.buyerAgentId);
    return {
      sessionId: demo.sessionId,
      mySeat: demo.mine?.seat ?? null,
      buyerAgent:
        buyerAgent?.kind === "external"
          ? { agentId: buyerAgent._id, name: buyerAgent.name }
          : null,
      seats: demo.humans.map(({ seat, member }) => ({
        seat,
        taken: !isPlaceholder(member.tokenIdentifier),
        displayName: member.displayName,
      })),
    };
  },
});

// The demo room for someone watching: what the buyer's seat sees, read-only, so the room can be
// put on a shared screen without taking a seat. It takes no room id, so it only ever shows the
// demo room. Any signed-in user can watch, like any signed-in user can take a free seat.
export const watch = query({
  args: {},
  handler: async (ctx) => {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    const demo = await current(ctx, tokenIdentifier);
    const buyer = demo?.humans.find((h) => h.seat === "buyer")?.member;
    if (!demo || !buyer) return null;
    const session = await loadSession(ctx, demo.sessionId);
    if (!session) return null;
    const participantNames = await Promise.all(
      session.participants.map(async (participant) => {
        if (participant.kind === "human") {
          return {
            participantId: participant.participantId,
            name: participant.displayName,
          };
        }
        const agent = await ctx.db.get(participant.agentId as Id<"agents">);
        return {
          participantId: participant.participantId,
          name: agent?.name ?? "Agente",
          verified: !!agent?.verified && !agent.selfRegistered,
        };
      }),
    );
    const stored = await ctx.db.get(demo.sessionId);
    return {
      session,
      violationCount: stored?.violationCount ?? 0,
      participantNames,
      seenAsParticipantId: buyer._id,
      history: await historyForViewer(
        ctx,
        demo.sessionId,
        toParticipant(buyer),
      ),
    };
  },
});

// Takes a free seat. Someone who already holds the other seat moves, so one person can rehearse
// both sides. The name is what the room shows the other side; it is not verified.
//
// The buyer may bring one of their own external agents with `agentId`: the room then starts
// over with that agent as the one that has been talking to the manufacturer, so the buyer goes
// on from their assistant, over MCP. Taking the seat without one goes back to the room's page.
export const join = mutation({
  args: {
    seat,
    name: v.optional(v.string()),
    agentId: v.optional(v.id("agents")),
  },
  returns: v.object({ sessionId: v.id("sessions") }),
  handler: async (ctx, args) => {
    const identity = await requireRoomIdentity(ctx);
    const demo = await current(ctx, identity.tokenIdentifier);
    if (!demo) fail("NotFound", "the demo room is not set up");
    const target = demo.humans.find((h) => h.seat === args.seat);
    if (!target) fail("NotFound", "the demo room has no such seat");
    if (
      args.agentId &&
      (args.seat !== "buyer" ||
        !(await ownAgent(ctx, args.agentId, identity.tokenIdentifier)))
    ) {
      fail(
        "NotYourAgent",
        "only the buyer can bring an agent, and only their own",
      );
    }
    const mine = demo.mine?.seat === args.seat;
    if (!mine && !isPlaceholder(target.member.tokenIdentifier)) {
      fail("SeatTaken", "someone else holds that seat");
    }
    if (!mine) {
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
    }
    const consumerAgentId = await ensureBuyerAgent(ctx);
    const buyerAgentId =
      args.seat === "buyer" ? (args.agentId ?? consumerAgentId) : null;
    // Whoever leaves the buyer's seat for the other one takes their agent with them.
    const leftBuyerSeat = !mine && demo.mine?.seat === "buyer";
    if (
      (buyerAgentId && buyerAgentId !== demo.buyerAgentId) ||
      (leftBuyerSeat && demo.buyerAgentId !== consumerAgentId)
    ) {
      return { sessionId: await rebuild(ctx, { buyerAgentId }) };
    }
    return { sessionId: demo.sessionId };
  },
});

// Leaving the buyer's seat takes the buyer's own agent out with them: the room starts over.
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
    if (
      demo.mine.seat === "buyer" &&
      demo.buyerAgentId !== (await ensureBuyerAgent(ctx))
    ) {
      await rebuild(ctx);
    }
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
    return { sessionId: await rebuild(ctx) };
  },
});
