import { ConvexError, v } from "convex/values";
import { effectiveAllowedIntents } from "../shared/agent";
import {
  DEFAULT_MAX_TURNS,
  type Participant,
  type Session,
  SessionContract,
} from "../shared/session";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { listedCard } from "./directory";

const MAX_VIOLATIONS = 3;
const MAX_PARTICIPANTS = 10;

function invalidArgument(message: string): never {
  throw new ConvexError({ kind: "InvalidArgument", message });
}

export const open = mutation({
  args: {
    initiatorAgentId: v.id("agents"),
    providerAgentId: v.id("agents"),
    request: v.string(),
    intent: v.optional(v.string()),
    maxTurns: v.optional(v.number()),
    human: v.optional(v.object({ displayName: v.string() })),
  },
  handler: async (ctx, args): Promise<Session> => {
    if (args.initiatorAgentId === args.providerAgentId) {
      invalidArgument("an agent cannot open a room with itself");
    }
    const initiator = await ctx.db.get(args.initiatorAgentId);
    if (!initiator || !listedCard(initiator)) {
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
    const contract = parsed.data;

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
    if (args.human) {
      const displayName = args.human.displayName.trim();
      if (displayName.length < 1 || displayName.length > 120) {
        invalidArgument(
          "the human's display name must have 1 to 120 characters",
        );
      }
      const identity = await ctx.auth.getUserIdentity();
      await ctx.db.insert("participants", {
        sessionId,
        kind: "human",
        tokenIdentifier: identity?.tokenIdentifier ?? "anonymous",
        displayName,
        role: "owner",
        onBehalfOfAgentId: args.initiatorAgentId,
      });
    }
    const session = await loadSession(ctx, sessionId);
    if (!session) throw new Error("room vanished right after it was opened");
    return session;
  },
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: (ctx, { sessionId }): Promise<Session | null> =>
    loadSession(ctx, sessionId),
});

export async function loadSession(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
): Promise<Session | null> {
  const session = await ctx.db.get(sessionId);
  if (!session) return null;
  const { contract } = session;
  const participants = await ctx.db
    .query("participants")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_PARTICIPANTS);
  return {
    sessionId: session._id,
    status: session.status,
    mode: session.mode,
    intent: session.intent,
    contract:
      contract?.purpose === undefined
        ? null
        : { ...contract, purpose: contract.purpose },
    participants: participants.map(toParticipant),
    turnCount: session.turnCount,
  };
}

function toParticipant(p: Doc<"participants">): Participant {
  if (p.kind === "agent") {
    return {
      participantId: p._id,
      kind: "agent",
      agentId: p.agentId,
      role: p.role,
    };
  }
  return {
    participantId: p._id,
    kind: "human",
    displayName: p.displayName,
    role: p.role,
    onBehalfOfAgentId: p.onBehalfOfAgentId,
  };
}
