import { ConvexError, convexToJson, type ObjectType, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { effectiveAllowedIntents } from "../shared/agent";
import {
  DEFAULT_MAX_TURNS,
  type Participant,
  type Session,
  SessionContract,
} from "../shared/session";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
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
): Promise<Session> {
  if (args.human) await requireRoomIdentity(ctx);
  const { contract, participants } = await ctx.runQuery(
    internal.rooms.plan,
    args,
  );
  const [initiator] = participants;
  const { verdict, events } = await moderate({
    content: { kind: "text", text: contract.intent.description },
    sender: initiator,
    recipient: "all",
    participants,
    contract,
    history: [],
  });
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
  });
}

export const plan = internalQuery({
  args: openArgs,
  handler: async (
    ctx,
    args,
  ): Promise<{ contract: SessionContract; participants: Participant[] }> => {
    const { contract, humanName } = await planRoom(ctx, args);
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
    if (humanName) {
      participants.push({
        participantId: "owner",
        kind: "human",
        displayName: humanName,
        role: "owner",
        onBehalfOfAgentId: args.initiatorAgentId,
      });
    }
    return { contract, participants };
  },
});

export const create = internalMutation({
  args: {
    ...openArgs,
    contract: zodToConvex(SessionContract),
    events: v.array(eventValidator),
  },
  handler: async (
    ctx,
    { contract, events, credentialId, ...args },
  ): Promise<Session> => {
    if (credentialId) {
      await requireLiveCredential(ctx, credentialId, args.initiatorAgentId);
    }
    const { contract: currentContract, humanName } = await planRoom(ctx, args);
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
    if (humanName) {
      const { tokenIdentifier } = await requireRoomIdentity(ctx);
      await ctx.db.insert("participants", {
        sessionId,
        kind: "human",
        tokenIdentifier,
        displayName: humanName,
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
  if (!initiator || !listedCard(initiator)) {
    invalidArgument("the initiator agent does not exist or is not listed");
  }
  if (args.human && initiator.ownerTokenIdentifier !== undefined) {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    if (initiator.ownerTokenIdentifier !== tokenIdentifier) {
      throw new ConvexError({
        kind: "NotOwner",
        message: "you can only open a room on behalf of an agent you own",
      });
    }
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
  const humanName = args.human?.displayName.trim();
  if (
    humanName !== undefined &&
    (humanName.length < 1 || humanName.length > 120)
  ) {
    invalidArgument("the human's display name must have 1 to 120 characters");
  }
  return { contract: parsed.data, humanName };
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
  } else if (session.status !== "closed") {
    throw new ConvexError({
      kind: "RoomClosed",
      message: "the room is not open",
    });
  }
  return { sessionId, status: "closed" as const };
}
