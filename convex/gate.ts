import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import {
  type Message,
  type MessageContent,
  SendableContent,
} from "../shared/messages";
import {
  ModerationAction,
  type ModerationOutcome,
  ModerationReason,
  ModerationStage,
  Verdict,
} from "../shared/moderation";
import type { Participant, SessionContract } from "../shared/session";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import { currentModerator } from "./moderator";
import { roomAgentFor } from "./roomAgent";
import { loadSession, toMessage } from "./roomState";
import { visibleTo } from "./visibility";

const HISTORY_LIMIT = 500;

const recipientValidator = v.union(v.literal("all"), v.id("participants"));

const MODERATOR_FAILED: Verdict = {
  decision: "block",
  rule: "purpose",
  reason: "El moderador no respondió; el mensaje se bloqueó.",
};

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

  let outcome: ModerationOutcome;
  try {
    outcome = await currentModerator().moderate({
      content,
      sender: room.sender,
      recipient: args.recipient,
      participants: room.participants,
      contract: room.contract,
      history: room.history,
    });
  } catch {
    outcome = {
      verdict: MODERATOR_FAILED,
      events: [
        {
          stage: "purpose",
          action: "block",
          reasons: [
            {
              code: "moderator_error",
              stage: "purpose",
              detail: "the moderator threw instead of returning a verdict",
            },
          ],
        },
      ],
    };
  }

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
    return {
      contract: session.contract,
      sender,
      participants: session.participants,
      history: await recentMessages(ctx, args.sessionId),
    };
  },
});

const eventValidator = v.object({
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
    const { session, sender } = await checkSend(ctx, args);
    const agentTurn = sender.kind === "agent";
    const turnCount = session.turnCount + (agentTurn ? 1 : 0);
    const exhausted = turnCount >= session.contract.maxTurns;
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
    if (agentTurn) {
      await ctx.db.patch("sessions", args.sessionId, { turnCount });
      if (exhausted) {
        await publishNotice(
          ctx,
          args.sessionId,
          "turn_limit_reached",
          `La sala llegó a su límite de ${turnCount} turnos de agente.`,
        );
      }
    }
    if (
      !exhausted &&
      verdict.decision === "allow" &&
      args.recipient !== args.senderParticipantId &&
      session.participants.some(
        (p) => p.kind === "agent" && p.participantId === args.recipient,
      )
    ) {
      await ctx.scheduler.runAfter(0, internal.gate.reply, { messageId });
    }
    const stored = await ctx.db.get(messageId);
    if (!stored) throw new Error("message vanished right after it was stored");
    return toMessage(stored);
  },
});

type ReplyContext = {
  agent: Doc<"agents">;
  self: Id<"participants">;
  sessionId: Id<"sessions">;
  message: Message;
  contract: SessionContract;
  participants: Participant[];
  history: Message[];
};

export const replyContext = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }): Promise<ReplyContext | null> => {
    const source = await ctx.db.get("messages", messageId);
    if (
      !source?.senderParticipantId ||
      source.moderation.status !== "allowed" ||
      source.recipient === "all"
    ) {
      return null;
    }
    const recipient = await ctx.db.get("participants", source.recipient);
    if (recipient?.kind !== "agent" || recipient.leftAt !== undefined)
      return null;
    const agent = await ctx.db.get("agents", recipient.agentId);
    if (agent?.kind !== "hosted") return null;
    const room = await loadSession(ctx, source.sessionId);
    if (
      room?.status !== "active" ||
      !room.contract ||
      room.turnCount >= room.contract.maxTurns
    ) {
      return null;
    }
    const viewer = room.participants.find(
      (p) => p.participantId === recipient._id,
    );
    if (!viewer) return null;
    const recent = await recentMessages(ctx, source.sessionId);
    return {
      agent,
      self: recipient._id,
      sessionId: source.sessionId,
      message: toMessage(source),
      contract: room.contract,
      participants: room.participants,
      history: recent.filter((message) => visibleTo(message, viewer)),
    };
  },
});

export const reply = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }): Promise<null> => {
    const input = await ctx.runQuery(internal.gate.replyContext, { messageId });
    if (!input) return null;
    const { agent, self, sessionId, ...room } = input;
    const { agent: roomAgent, llm } = roomAgentFor(agent);
    const actions = await roomAgent.reply({ ctx, self, ...room, llm });
    for (const action of actions) {
      try {
        if (action.kind === "close") {
          await ctx.runMutation(api.rooms.close, {
            sessionId,
            participantId: self,
          });
        } else {
          await sendThroughGate(ctx, {
            sessionId,
            senderParticipantId: self,
            recipient: action.recipient as Doc<"messages">["recipient"],
            content: action.content,
          });
        }
      } catch (error) {
        if (
          !(error instanceof ConvexError) ||
          (error.data?.kind !== "RoomClosed" &&
            error.data?.kind !== "TurnLimitReached")
        ) {
          throw error;
        }
        return null;
      }
    }
    return null;
  },
});

async function recentMessages(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .order("desc")
    .take(HISTORY_LIMIT);
  return messages.reverse().map(toMessage);
}

const historyArgs = {
  sessionId: v.id("sessions"),
  viewerParticipantId: v.id("participants"),
};

export const history = query({
  args: historyArgs,
  handler: async (
    ctx,
    { sessionId, viewerParticipantId },
  ): Promise<Message[]> => {
    const viewer = await roomViewer(ctx, sessionId, viewerParticipantId);
    const messages = await recentMessages(ctx, sessionId);
    return messages.filter((message) => visibleTo(message, viewer));
  },
});

export const historyPage = query({
  args: { ...historyArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { sessionId, viewerParticipantId, paginationOpts }) => {
    const viewer = await roomViewer(ctx, sessionId, viewerParticipantId);
    const result = await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page
        .map(toMessage)
        .filter((message) => visibleTo(message, viewer)),
    };
  },
});

async function roomViewer(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  viewerParticipantId: Id<"participants">,
) {
  const room = await loadSession(ctx, sessionId);
  if (!room) gateError("NotFound", "the room does not exist");
  const viewer = room.participants.find(
    (p) => p.participantId === viewerParticipantId,
  );
  if (!viewer) gateError("NotParticipant", "the viewer is not in this room");
  return viewer;
}

export async function publishNotice(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  code: Extract<MessageContent, { kind: "system" }>["code"],
  text: string,
) {
  await insertPlatformMessage(ctx, sessionId, "all", {
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
  await ctx.db.insert("messages", {
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
    sender.kind === "agent" &&
    session.turnCount >= session.contract.maxTurns
  ) {
    gateError("TurnLimitReached", "the room has reached its agent turn limit");
  }
  if (
    args.recipient !== "all" &&
    !session.participants.some((p) => p.participantId === args.recipient)
  ) {
    gateError("InvalidArgument", "the recipient is not in this room");
  }
  return { session: { ...session, contract: session.contract }, sender };
}
