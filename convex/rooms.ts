import { ConvexError, type ObjectType, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { effectiveAllowedIntents } from "../shared/agent";
import {
  DEFAULT_MAX_TURNS,
  type Participant,
  type Session,
  SessionContract,
} from "../shared/session";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  type QueryCtx,
  query,
} from "./_generated/server";
import { listedCard } from "./directory";
import { eventValidator, publishNotice } from "./gate";
import { moderate } from "./moderator";
import { loadSession } from "./roomState";

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
};

export const open = action({
  args: openArgs,
  handler: async (ctx, args): Promise<Session> => {
    const { contract, participants } = await ctx.runQuery(
      internal.rooms.plan,
      args,
    );
    const [initiator, provider] = participants;
    const { verdict, events } = await moderate({
      content: { kind: "text", text: contract.intent.description },
      sender: initiator,
      recipient: provider.participantId,
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
  },
});

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
  handler: async (ctx, { contract, events, ...args }): Promise<Session> => {
    const { cardName, humanName } = await planRoom(ctx, args);
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
      const identity = await ctx.auth.getUserIdentity();
      await ctx.db.insert("participants", {
        sessionId,
        kind: "human",
        tokenIdentifier: identity?.tokenIdentifier ?? "anonymous",
        displayName: humanName,
        role: "owner",
        onBehalfOfAgentId: args.initiatorAgentId,
      });
    }
    const noticeId = await publishNotice(
      ctx,
      sessionId,
      "session_opened",
      `Sala abierta con ${cardName}. Petición: ${contract.intent.description}`.slice(
        0,
        4000,
      ),
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
  return { cardName: card.name, contract: parsed.data, humanName };
}

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: (ctx, { sessionId }): Promise<Session | null> =>
    loadSession(ctx, sessionId),
});
