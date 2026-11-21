import { ConvexError, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import {
  type Message,
  type MessageContent,
  SendableContent,
} from "../shared/messages";
import {
  ModerationAction,
  ModerationReason,
  ModerationStage,
  Verdict,
} from "../shared/moderation";
import type { Participant, SessionContract } from "../shared/session";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import { moderate } from "./moderator";
import { loadSession, toMessage } from "./roomState";

const HISTORY_LIMIT = 500;

const recipientValidator = v.union(v.literal("all"), v.id("participants"));

function gateError(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

export const send = action({
  args: {
    sessionId: v.id("sessions"),
    senderParticipantId: v.id("participants"),
    recipient: recipientValidator,
    content: zodToConvex(SendableContent),
  },
  handler: (ctx, args): Promise<Message> => sendThroughGate(ctx, args),
});

export async function sendThroughGate(
  ctx: ActionCtx,
  args: {
    sessionId: Id<"sessions">;
    senderParticipantId: Id<"participants">;
    recipient: Doc<"messages">["recipient"];
    content: unknown;
  },
): Promise<Message> {
  const parsed = SendableContent.safeParse(args.content);
  if (!parsed.success) {
    gateError(
      "InvalidArgument",
      `content is not sendable: ${parsed.error.message}`,
    );
  }
  const content = parsed.data;
  const room = await ctx.runQuery(internal.gate.moderationContext, {
    sessionId: args.sessionId,
    senderParticipantId: args.senderParticipantId,
    recipient: args.recipient,
  });

  const outcome = await moderate({
    content,
    sender: room.sender,
    recipient: args.recipient,
    participants: room.participants,
    contract: room.contract,
    history: room.history,
  });

  return ctx.runMutation(internal.gate.commit, {
    sessionId: args.sessionId,
    senderParticipantId: args.senderParticipantId,
    recipient: args.recipient,
    content,
    verdict: outcome.verdict,
    events: outcome.events,
  });
}

export const moderationContext = internalQuery({
  args: {
    sessionId: v.id("sessions"),
    senderParticipantId: v.id("participants"),
    recipient: recipientValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    contract: SessionContract;
    sender: Participant;
    participants: Participant[];
    history: Message[];
  }> => {
    const { session, sender } = await checkSend(ctx, args);
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(HISTORY_LIMIT);
    return {
      contract: session.contract,
      sender,
      participants: session.participants,
      history: recent.reverse().map(toMessage),
    };
  },
});

export const eventValidator = v.object({
  stage: zodToConvex(ModerationStage),
  action: zodToConvex(ModerationAction),
  reasons: v.array(zodToConvex(ModerationReason)),
  model: v.optional(v.string()),
  latencyMs: v.optional(v.number()),
});

export const commit = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    senderParticipantId: v.id("participants"),
    recipient: recipientValidator,
    content: zodToConvex(SendableContent),
    verdict: zodToConvex(Verdict),
    events: v.array(eventValidator),
  },
  handler: async (ctx, args): Promise<Message> => {
    await checkSend(ctx, args);
    const { verdict } = args;
    const messageId = await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      senderParticipantId: args.senderParticipantId,
      recipient: args.recipient,
      content: args.content,
      moderation: {
        status: verdict.decision === "block" ? "blocked" : "allowed",
        verdict,
        reasons: args.events.flatMap((event) => event.reasons),
        decidedAt: Date.now(),
      },
    });
    for (const event of args.events) {
      await ctx.db.insert("moderationEvents", {
        sessionId: args.sessionId,
        messageId,
        ...event,
      });
    }
    if (verdict.decision === "block") {
      await insertPlatformMessage(
        ctx,
        args.sessionId,
        args.senderParticipantId,
        {
          kind: "ui",
          spec: {
            type: "moderator_alert",
            id: `alerta-${messageId}`.slice(0, 64),
            title: "Mensaje bloqueado",
            rule: verdict.rule,
            reason: verdict.reason,
            blockedMessageId: messageId,
          },
        },
      );
    }
    const stored = await ctx.db.get(messageId);
    if (!stored) throw new Error("message vanished right after it was stored");
    return toMessage(stored);
  },
});

export const history = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }): Promise<Message[]> => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(HISTORY_LIMIT);
    return messages.map(toMessage);
  },
});

export async function publishNotice(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  code: Extract<MessageContent, { kind: "system" }>["code"],
  text: string,
) {
  return insertPlatformMessage(ctx, sessionId, "all", {
    kind: "system",
    code,
    text,
  });
}

async function insertPlatformMessage(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  recipient: Doc<"messages">["recipient"],
  content: MessageContent,
) {
  return ctx.db.insert("messages", {
    sessionId,
    recipient,
    content,
    moderation: {
      status: "allowed",
      verdict: { decision: "allow", reason: "Aviso de la plataforma." },
      reasons: [],
      decidedAt: Date.now(),
    },
  });
}

async function checkSend(
  ctx: QueryCtx,
  args: {
    sessionId: Id<"sessions">;
    senderParticipantId: Id<"participants">;
    recipient: Doc<"messages">["recipient"];
  },
) {
  const session = await loadSession(ctx, args.sessionId);
  if (!session) gateError("NotFound", "the room does not exist");
  if (session.status !== "active" || !session.contract) {
    gateError("RoomClosed", "the room is closed and accepts no new messages");
  }
  const sender = session.participants.find(
    (p) => p.participantId === args.senderParticipantId,
  );
  if (!sender) gateError("NotParticipant", "the sender is not in this room");
  if (
    args.recipient !== "all" &&
    !session.participants.some((p) => p.participantId === args.recipient)
  ) {
    gateError("InvalidArgument", "the recipient is not in this room");
  }
  return { session: { ...session, contract: session.contract }, sender };
}
