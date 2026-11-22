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
import { PERSONAL_AGENT_SLUG_PREFIX } from "../shared/mcp";
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
import { retireAgent } from "./agentRegistration";
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
// The manufacturer's hosted agent is an unlisted draft, so nobody opens another room with it from
// the directory. Either seat can bring an external agent of its holder's instead of the hosted
// one: the room then starts over with that agent as the one that has been talking.

const seat = v.union(v.literal("buyer"), v.literal("merchant"));
const broughtAgent = v.union(
  v.null(),
  v.object({ agentId: v.id("agents"), name: v.string() }),
);
const SEATS = Object.keys(DEMO_SEATS) as DemoSeat[];
const MAX_DEMO_ROOMS = 20;
const MAX_ROOM_ROWS = 500;
const MAX_OWN_AGENTS = 100;

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

// The buyer's hosted agent is the platform's consumer agent. A deployment that was never seeded
// gets it here.
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

// The demo rooms, newest first: the marked ones, and the ones the manufacturer's hosted agent is
// in, which is how a room was told apart before the mark existed.
async function demoRooms(ctx: QueryCtx) {
  const ids = new Set<Id<"sessions">>();
  const marked = await ctx.db
    .query("sessions")
    .withIndex("by_demo", (q) => q.eq("demo", true))
    .order("desc")
    .take(MAX_DEMO_ROOMS);
  for (const session of marked) ids.add(session._id);
  const provider = await agentBySlug(ctx, DEMO_PROVIDER_SLUG);
  if (provider) {
    const rows = await ctx.db
      .query("participants")
      .withIndex("by_agentId_and_sessionId", (q) =>
        q.eq("agentId", provider._id),
      )
      .take(MAX_DEMO_ROOMS);
    for (const row of rows) ids.add(row.sessionId);
  }
  const sessions: Doc<"sessions">[] = [];
  for (const id of ids) {
    const session = await ctx.db.get("sessions", id);
    if (session) sessions.push(session);
  }
  return sessions.sort((a, b) => b._creationTime - a._creationTime);
}

function members(ctx: QueryCtx, sessionId: Id<"sessions">) {
  return ctx.db
    .query("participants")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_ROOM_ROWS);
}

type SeatAgents = Record<DemoSeat, Id<"agents">>;

// The agent on each side of a room: the one that opened it and the one it was opened with.
function seatAgents(
  session: Doc<"sessions">,
  rows: Doc<"participants">[],
): SeatAgents | null {
  const recipient = rows.find(
    (row) => row.kind === "agent" && row.role === "recipient",
  );
  return recipient?.kind === "agent"
    ? { buyer: session.initiatorAgentId, merchant: recipient.agentId }
    : null;
}

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

// The external agent a person may bring to a seat: one of their own.
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

async function newestOwnAgent(ctx: QueryCtx, tokenIdentifier: string) {
  const agents = await ctx.db
    .query("agents")
    .withIndex("by_ownerTokenIdentifier", (q) =>
      q.eq("ownerTokenIdentifier", tokenIdentifier),
    )
    .order("desc")
    .take(MAX_OWN_AGENTS);
  return agents.find((agent) => agent.kind === "external")?._id ?? null;
}

// Deletes the demo rooms and opens a fresh one, keeping whoever holds each seat. A seat's agent
// is the one in `agents` (null for the hosted one), or the one the last room had; an external
// agent stays only while its owner holds the seat.
async function rebuild(
  ctx: MutationCtx,
  {
    clearSeats = false,
    agents: chosen = {},
  }: {
    clearSeats?: boolean;
    agents?: Partial<Record<DemoSeat, Id<"agents"> | null>>;
  } = {},
) {
  const hosted: SeatAgents = {
    buyer: await ensureBuyerAgent(ctx),
    merchant: await ensureProvider(ctx),
  };
  const provider = await ctx.db.get("agents", hosted.merchant);
  if (!provider) throw new Error("demo: the provider vanished");

  const seats = emptySeats();
  let kept = hosted;
  // Oldest first, so the newest room's seats win.
  for (const session of (await demoRooms(ctx)).reverse()) {
    const rows = await members(ctx, session._id);
    kept = seatAgents(session, rows) ?? hosted;
    for (const member of rows) {
      const held = seatOf(member, kept);
      if (held && member.kind === "human" && !clearSeats) {
        seats[held] = {
          tokenIdentifier: member.tokenIdentifier,
          displayName: member.displayName,
        };
      }
    }
    await deleteRoom(ctx, session._id);
  }
  const agents = { ...hosted };
  for (const seat of SEATS) {
    const wanted = chosen[seat] === undefined ? kept[seat] : chosen[seat];
    const own =
      wanted && (await ownAgent(ctx, wanted, seats[seat].tokenIdentifier));
    if (own) agents[seat] = own._id;
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
    initiatorAgentId: agents.buyer,
    intent: DEMO_INTENT,
    contract,
    mode: "moderated",
    status: "active",
    turnCount: 0,
    violationCount: 0,
    demo: true,
  });
  const speakers = {
    buyerAgent: await ctx.db.insert("participants", {
      sessionId,
      kind: "agent",
      agentId: agents.buyer,
      role: "initiator",
    }),
    providerAgent: await ctx.db.insert("participants", {
      sessionId,
      kind: "agent",
      agentId: agents.merchant,
      role: "recipient",
    }),
    buyer: await ctx.db.insert("participants", {
      sessionId,
      kind: "human",
      ...seats.buyer,
      role: "owner",
      onBehalfOfAgentId: agents.buyer,
    }),
    // An operator, so the room keeps a single owner: the person a provider sends its cards to.
    merchant: await ctx.db.insert("participants", {
      sessionId,
      kind: "human",
      ...seats.merchant,
      role: "operator",
      onBehalfOfAgentId: agents.merchant,
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
  const script =
    agents.buyer === hosted.buyer ? DEMO_SCRIPT : DEMO_AGENT_SCRIPT;
  for (const line of script) {
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

// The current demo room and the caller's seat in it, or null while the demo is off. `brought` is
// the external agent each seat talks through, if its holder brought one.
async function current(ctx: QueryCtx, tokenIdentifier: string) {
  const [session] = await demoRooms(ctx);
  if (!session) return null;
  const rows = await members(ctx, session._id);
  const agents = seatAgents(session, rows);
  if (!agents) return null;
  const humans = rows.flatMap((member) => {
    const held = seatOf(member, agents);
    return held && member.kind === "human" ? [{ seat: held, member }] : [];
  });
  const brought: Record<DemoSeat, Doc<"agents"> | null> = {
    buyer: null,
    merchant: null,
  };
  for (const seat of SEATS) {
    const agent = await ctx.db.get("agents", agents[seat]);
    if (agent?.kind === "external") brought[seat] = agent;
  }
  return {
    sessionId: session._id,
    brought,
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
    for (const room of await demoRooms(ctx)) await deleteRoom(ctx, room._id);
    const provider = await agentBySlug(ctx, DEMO_PROVIDER_SLUG);
    if (provider) await deleteProviderData(ctx, provider._id);
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
      // Set for a seat whose holder talks through their own agent instead of the room's page.
      agents: v.object({ buyer: broughtAgent, merchant: broughtAgent }),
      seats: v.array(
        v.object({ seat, taken: v.boolean(), displayName: v.string() }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    const demo = await current(ctx, tokenIdentifier);
    if (!demo) return null;
    const brought = (seat: DemoSeat) => {
      const agent = demo.brought[seat];
      return agent ? { agentId: agent._id, name: agent.name } : null;
    };
    return {
      sessionId: demo.sessionId,
      mySeat: demo.mine?.seat ?? null,
      agents: { buyer: brought("buyer"), merchant: brought("merchant") },
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
// `agentId` brings one of the caller's own external agents to the seat: the room then starts over
// with that agent as the one that has been talking, so its owner goes on from their assistant,
// over MCP. The manufacturer's own agent replaces the hosted one, so it has to quote by itself.
// Taking the seat without one goes back to the hosted agent and the room's page.
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
      !(await ownAgent(ctx, args.agentId, identity.tokenIdentifier))
    ) {
      fail("NotYourAgent", "you can only bring an agent of your own");
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
    const now = (s: DemoSeat) => demo.brought[s]?._id ?? null;
    const agents = { buyer: now("buyer"), merchant: now("merchant") };
    agents[args.seat] = args.agentId ?? null;
    // Whoever leaves a seat for the other one takes their agent with them.
    if (!mine && demo.mine) agents[demo.mine.seat] = null;
    if (SEATS.some((s) => agents[s] !== now(s))) {
      return { sessionId: await rebuild(ctx, { agents }) };
    }
    return { sessionId: demo.sessionId };
  },
});

// Leaving a seat takes the agent its holder brought out with them: the room starts over.
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
    if (demo.brought[demo.mine.seat]) await rebuild(ctx);
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

// Removes agents the caller no longer uses from their account, for an assistant that was deleted
// and connected again as a new agent. It cannot be undone: see `retireAgent`. The agent an
// assistant gets by signing in with OAuth stays, because that assistant comes back to it.
//
// A seat whose agent is removed gets its holder's newest remaining agent, or the hosted one.
export const forgetAgents = mutation({
  args: { agentIds: v.array(v.id("agents")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    const agentIds = new Set(args.agentIds);
    if (agentIds.size > MAX_OWN_AGENTS) {
      fail("InvalidArgument", `at most ${MAX_OWN_AGENTS} agents at a time`);
    }
    for (const agentId of agentIds) {
      const agent = await ownAgent(ctx, agentId, tokenIdentifier);
      if (!agent || agent.slug.startsWith(PERSONAL_AGENT_SLUG_PREFIX)) {
        fail("NotYourAgent", "you can only remove a linked agent of your own");
      }
      await retireAgent(ctx, agent);
    }
    const demo = await current(ctx, tokenIdentifier);
    if (!demo) return null;
    const agents: Partial<Record<DemoSeat, Id<"agents"> | null>> = {};
    for (const seat of SEATS) {
      const brought = demo.brought[seat];
      if (!brought || !agentIds.has(brought._id)) continue;
      agents[seat] =
        demo.mine?.seat === seat
          ? await newestOwnAgent(ctx, tokenIdentifier)
          : null;
    }
    if (Object.keys(agents).length > 0) await rebuild(ctx, { agents });
    return null;
  },
});
