import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, convexToJson, type ObjectType, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { effectiveAllowedIntents } from "../shared/agent";
import { CONSUMER_AGENT_SLUG } from "../shared/seed-data";
import {
  DEFAULT_MAX_TURNS,
  type Participant,
  Session,
  SessionContract,
  SessionStatus,
} from "../shared/session";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireLiveCredential } from "./agentKeys";
import { listedCard } from "./directory";
import { eventValidator, publishNotice } from "./gate";
import { moderate } from "./moderator";
import {
  loadSession,
  requireRoomHuman,
  requireRoomIdentity,
} from "./roomState";

const MAX_VIOLATIONS = 3;

export const openFromCard = action({
  args: {
    providerSlug: v.string(),
    intent: v.string(),
    description: v.string(),
  },
  returns: v.object({ sessionId: v.id("sessions") }),
  handler: async (
    ctx,
    { providerSlug, intent, description },
  ): Promise<{ sessionId: Id<"sessions"> }> => {
    const identity = await requireRoomIdentity(ctx);
    const consumer = await ctx.runQuery(api.directory.get, {
      slug: CONSUMER_AGENT_SLUG,
    });
    const provider = await ctx.runQuery(api.directory.get, {
      slug: providerSlug,
    });
    if (!consumer || !provider) {
      throw new ConvexError({
        kind: "NotFound",
        message: "missing consumer or provider card",
      });
    }
    const room = await openRoom(ctx, {
      initiatorAgentId: consumer.agentId as Id<"agents">,
      providerAgentId: provider.agentId as Id<"agents">,
      request: description,
      intent,
      human: { displayName: identity.name ?? identity.givenName ?? "Tú" },
    });
    return { sessionId: room.sessionId as Id<"sessions"> };
  },
});

const roomSummary = v.object({
  sessionId: v.id("sessions"),
  status: zodToConvex(SessionStatus),
  intent: v.string(),
  provider: v.object({ name: v.string(), slug: v.string() }),
  lastActivityTime: v.number(),
});

function myMemberships(ctx: QueryCtx, tokenIdentifier: string) {
  return ctx.db
    .query("participants")
    .withIndex("by_tokenIdentifier_and_leftAt", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier).eq("leftAt", undefined),
    )
    .order("desc");
}

async function summarize(ctx: QueryCtx, memberships: Doc<"participants">[]) {
  const rooms = await Promise.all(
    memberships.map(async (membership) => {
      if (membership.kind !== "human" || membership.leftAt !== undefined)
        return null;
      const session = await ctx.db.get(membership.sessionId);
      if (!session) return null;
      const participants = await ctx.db
        .query("participants")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .take(10);
      const recipient = participants.find(
        (p) => p.kind === "agent" && p.role === "recipient",
      );
      if (recipient?.kind !== "agent") return null;
      const provider = await ctx.db.get(recipient.agentId);
      if (!provider) return null;
      const lastMessage = await ctx.db
        .query("messages")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .order("desc")
        .first();
      return {
        sessionId: session._id,
        status: session.status,
        intent: session.intent.name,
        provider: { name: provider.name, slug: provider.slug },
        lastActivityTime: lastMessage?._creationTime ?? session._creationTime,
      };
    }),
  );
  return rooms.filter((room) => room !== null);
}

export const mine = query({
  args: {},
  returns: v.array(roomSummary),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const memberships = await myMemberships(ctx, identity.tokenIdentifier).take(
      100,
    );
    return (await summarize(ctx, memberships))
      .sort((a, b) => b.lastActivityTime - a.lastActivityTime)
      .slice(0, 20);
  },
});

// Every room of the caller, newest membership first, for the rooms page.
export const minePage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(roomSummary),
  handler: async (ctx, { paginationOpts }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { page: [], isDone: true, continueCursor: "" };
    const result = await myMemberships(ctx, identity.tokenIdentifier).paginate(
      paginationOpts,
    );
    return { ...result, page: await summarize(ctx, result.page) };
  },
});

export const view = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      session: zodToConvex(Session),
      violationCount: v.number(),
      participantNames: v.array(
        v.object({
          participantId: v.string(),
          name: v.string(),
          slug: v.optional(v.string()),
          verified: v.optional(v.boolean()),
        }),
      ),
      humanParticipantId: v.id("participants"),
    }),
  ),
  handler: async (ctx, { sessionId }) => {
    const human = await requireRoomHuman(ctx, sessionId);
    const session = await loadSession(ctx, sessionId);
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
          ...(agent ? { slug: agent.slug } : {}),
        };
      }),
    );
    const stored = await ctx.db.get("sessions", sessionId);
    return {
      session,
      violationCount: stored?.violationCount ?? 0,
      participantNames,
      humanParticipantId: human._id,
    };
  },
});

function invalidArgument(message: string): never {
  throw new ConvexError({ kind: "InvalidArgument", message });
}

const openArgs = {
  initiatorAgentId: v.id("agents"),
  providerAgentId: v.id("agents"),
  request: v.string(),
  intent: v.optional(v.string()),
  maxTurns: v.optional(v.number()),
  human: v.optional(v.object({ displayName: v.string() })),
  credentialId: v.optional(v.id("agentApiKeys")),
};

export const open = internalAction({
  args: openArgs,
  handler: openRoom,
});

export async function openRoom(
  ctx: ActionCtx,
  args: ObjectType<typeof openArgs>,
  { openerTokenTaken = false }: { openerTokenTaken?: boolean } = {},
): Promise<Session> {
  const identity = args.human ? await requireRoomIdentity(ctx) : null;
  const opener = identity
    ? `user:${identity.tokenIdentifier}`
    : `agent:${args.initiatorAgentId}`;
  const { contract, participants, ownerTokenIdentifier } = await ctx.runQuery(
    internal.rooms.plan,
    args,
  );
  const [initiator] = participants;
  const { verdict, events } = await moderate(
    ctx,
    {
      content: { kind: "text", text: contract.intent.description },
      sender: initiator,
      recipient: "all",
      participants,
      contract,
      history: [],
    },
    {
      sender: openerTokenTaken ? undefined : opener,
      room: `open:${opener}:${args.providerAgentId}`,
    },
  );
  if (verdict.decision === "block") {
    throw new ConvexError({
      kind: "RequestBlocked",
      message: verdict.reason,
      rule: verdict.rule,
    });
  }
  return ctx.runMutation(internal.rooms.create, {
    ...args,
    contract,
    events,
    ownerTokenIdentifier,
  });
}

export const plan = internalQuery({
  args: openArgs,
  handler: async (
    ctx,
    args,
  ): Promise<{
    contract: SessionContract;
    participants: Participant[];
    ownerTokenIdentifier?: string;
  }> => {
    const { contract, human } = await planRoom(ctx, args);
    const participants: Participant[] = [
      {
        participantId: "initiator",
        kind: "agent",
        agentId: args.initiatorAgentId,
        role: "initiator",
      },
      {
        participantId: "recipient",
        kind: "agent",
        agentId: args.providerAgentId,
        role: "recipient",
      },
    ];
    if (human) {
      participants.push({
        participantId: "owner",
        kind: "human",
        displayName: human.displayName,
        role: "owner",
        onBehalfOfAgentId: args.initiatorAgentId,
      });
    }
    return {
      contract,
      participants,
      ownerTokenIdentifier: human?.tokenIdentifier,
    };
  },
});

export const create = internalMutation({
  args: {
    ...openArgs,
    contract: zodToConvex(SessionContract),
    events: v.array(eventValidator),
    ownerTokenIdentifier: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { contract, events, ownerTokenIdentifier, ...args },
  ): Promise<Session> => {
    if (args.credentialId) {
      await requireLiveCredential(
        ctx,
        args.credentialId,
        args.initiatorAgentId,
      );
    }
    const { contract: currentContract, human } = await planRoom(ctx, args);
    if (human?.tokenIdentifier !== ownerTokenIdentifier) {
      throw new ConvexError({
        kind: "RoomOwnerChanged",
        message:
          "the room owner changed during moderation; retry opening the room",
      });
    }
    if (
      JSON.stringify(convexToJson(contract)) !==
      JSON.stringify(convexToJson(currentContract))
    ) {
      throw new ConvexError({
        kind: "RoomContractChanged",
        message:
          "the provider's card changed during moderation; retry opening the room",
      });
    }
    const sessionId = await ctx.db.insert("sessions", {
      initiatorAgentId: args.initiatorAgentId,
      intent: contract.intent,
      contract,
      mode: "moderated",
      status: "active",
      turnCount: 0,
      violationCount: 0,
    });
    await ctx.db.insert("participants", {
      sessionId,
      kind: "agent",
      agentId: args.initiatorAgentId,
      role: "initiator",
    });
    await ctx.db.insert("participants", {
      sessionId,
      kind: "agent",
      agentId: args.providerAgentId,
      role: "recipient",
    });
    if (human) {
      await ctx.db.insert("participants", {
        sessionId,
        kind: "human",
        ...human,
        role: "owner",
        onBehalfOfAgentId: args.initiatorAgentId,
      });
    }
    const noticeId = await publishNotice(
      ctx,
      sessionId,
      "session_opened",
      `Sala abierta. Petición: ${contract.intent.description}`.slice(0, 4000),
    );
    for (const event of events) {
      await ctx.db.insert("moderationEvents", {
        sessionId,
        messageId: noticeId,
        ...event,
      });
    }
    const session = await loadSession(ctx, sessionId);
    if (!session) throw new Error("room vanished right after it was opened");
    return session;
  },
});

async function planRoom(ctx: QueryCtx, args: ObjectType<typeof openArgs>) {
  if (args.initiatorAgentId === args.providerAgentId) {
    invalidArgument("an agent cannot open a room with itself");
  }
  const initiator = await ctx.db.get(args.initiatorAgentId);
  if (
    !initiator ||
    (!listedCard(initiator) &&
      !(initiator.kind === "external" && initiator.status === "draft"))
  ) {
    invalidArgument("the initiator agent does not exist or is not listed");
  }
  const provider = await ctx.db.get(args.providerAgentId);
  const listed = provider && listedCard(provider);
  if (!listed) {
    invalidArgument("the provider card does not exist or is not listed");
  }
  const { card } = listed;

  const allowedIntents = effectiveAllowedIntents(card);
  const intentName = args.intent ?? allowedIntents[0];
  if (!intentName || !allowedIntents.includes(intentName)) {
    invalidArgument(
      `intent "${intentName ?? ""}" is not one the card allows: ${allowedIntents.join(", ")}`,
    );
  }
  const parsed = SessionContract.safeParse({
    intent: { name: intentName, description: args.request.trim() },
    purpose: card.purpose,
    capabilities: card.capabilities,
    allowedIntents,
    forbiddenTopics: card.scope.forbiddenTopics,
    recipientShares: card.scope.dataItShares,
    recipientRequests: card.scope.dataItRequests,
    maxTurns: args.maxTurns ?? DEFAULT_MAX_TURNS,
    maxViolations: MAX_VIOLATIONS,
  });
  if (!parsed.success) {
    invalidArgument(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  }
  if (args.human) {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    if (
      initiator.ownerTokenIdentifier !== undefined &&
      initiator.ownerTokenIdentifier !== tokenIdentifier
    ) {
      throw new ConvexError({
        kind: "NotOwner",
        message: "you can only open a room on behalf of an agent you own",
      });
    }
    const displayName = args.human.displayName.trim();
    if (displayName.length < 1 || displayName.length > 120) {
      invalidArgument("the human's display name must have 1 to 120 characters");
    }
    return { contract: parsed.data, human: { tokenIdentifier, displayName } };
  }
  const tokenIdentifier = args.credentialId && initiator.ownerTokenIdentifier;
  return {
    contract: parsed.data,
    human: tokenIdentifier ? { tokenIdentifier, displayName: "Tú" } : undefined,
  };
}

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }): Promise<Session | null> => {
    await requireRoomHuman(ctx, sessionId);
    return loadSession(ctx, sessionId);
  },
});

export const close = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const participant = await requireRoomHuman(ctx, sessionId);
    return closeRoom(ctx, { sessionId, participantId: participant._id });
  },
});

export const closeAsParticipant = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
  },
  handler: closeRoom,
});

export async function closeRoom(
  ctx: MutationCtx,
  {
    sessionId,
    participantId,
  }: {
    sessionId: Id<"sessions">;
    participantId: Id<"participants">;
  },
) {
  const session = await ctx.db.get(sessionId);
  if (!session) {
    throw new ConvexError({
      kind: "NotFound",
      message: "the room does not exist",
    });
  }
  const participant = await ctx.db.get(participantId);
  if (
    participant?.sessionId !== sessionId ||
    participant.leftAt !== undefined
  ) {
    throw new ConvexError({
      kind: "NotParticipant",
      message: "only a participant can close the room",
    });
  }
  if (session.status === "active") {
    await ctx.db.patch("sessions", sessionId, {
      status: "closed",
      closedReason: `closed_by_${participant.role}`,
    });
    await publishNotice(ctx, sessionId, "session_closed", "Sala cerrada.");
  } else if (session.status === "terminated") {
    return { sessionId, status: "terminated" as const };
  } else if (session.status !== "closed") {
    throw new ConvexError({
      kind: "RoomClosed",
      message: "the room is not open",
    });
  }
  return { sessionId, status: "closed" as const };
}
