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
import { moderate } from "./moderator";
import { roomAgentFor } from "./roomAgent";
import { loadSession, toMessage } from "./roomState";
import { visibleTo } from "./visibility";

const HISTORY_LIMIT = 500;
const HISTORY_BYTE_BUDGET = 4 * 1024 * 1024;
const encoder = new TextEncoder();

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
    hostedReply?: true;
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
    hostedReply: args.hostedReply,
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
    hostedReply: v.optional(v.literal(true)),
  },
  handler: async (ctx, args): Promise<Message> => {
    const { session, sender } = await checkSend(ctx, args);
    const { content } = args;
    if (
      args.hostedReply &&
      sender.kind === "agent" &&
      content.kind === "ui" &&
      content.spec.type === "confirmation"
    ) {
      const confirmationId = content.spec.id;
      const previous = await ctx.db
        .query("messages")
        .withIndex("by_sessionId_and_moderation_status", (q) =>
          q.eq("sessionId", args.sessionId).eq("moderation.status", "allowed"),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("senderParticipantId"), args.senderParticipantId),
            q.eq(q.field("recipient"), args.recipient),
            q.eq(q.field("content.kind"), "ui"),
            q.eq(q.field("content.spec.type"), "confirmation"),
            q.eq(q.field("content.spec.id"), confirmationId),
          ),
        )
        .first();
      if (previous) return toMessage(previous);
    }
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
    if (!exhausted && verdict.decision === "allow") {
      for (const responder of responders(session.participants, sender, args)) {
        await ctx.scheduler.runAfter(0, internal.gate.reply, {
          messageId,
          participantId: responder.participantId as Id<"participants">,
        });
      }
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

// The agents that get a turn for an allowed message: the agent it is addressed to, or, for a
// human's message to everyone, every agent in the room. An agent's message to everyone gets no
// turn, so two agents can never keep each other talking through broadcasts.
function responders(
  participants: Participant[],
  sender: Participant,
  { recipient }: { recipient: Doc<"messages">["recipient"] },
) {
  return participants.filter(
    (p) =>
      p.kind === "agent" &&
      p.participantId !== sender.participantId &&
      (p.participantId === recipient ||
        (recipient === "all" && sender.kind === "human")),
  );
}

export const replyContext = internalQuery({
  args: { messageId: v.id("messages"), participantId: v.id("participants") },
  handler: async (
    ctx,
    { messageId, participantId },
  ): Promise<ReplyContext | null> => {
    const source = await ctx.db.get("messages", messageId);
    if (
      !source?.senderParticipantId ||
      source.moderation.status !== "allowed" ||
      (source.recipient !== participantId && source.recipient !== "all")
    ) {
      return null;
    }
    const recipient = await ctx.db.get("participants", participantId);
    if (
      recipient?.kind !== "agent" ||
      recipient.sessionId !== source.sessionId ||
      recipient.leftAt !== undefined
    )
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
  args: { messageId: v.id("messages"), participantId: v.id("participants") },
  handler: async (ctx, args): Promise<null> => {
    const input = await ctx.runQuery(internal.gate.replyContext, args);
    if (!input) return null;
    const { agent, self, sessionId, ...room } = input;
    const { agent: roomAgent, llm } = roomAgentFor(agent, ctx);
    const actions = await roomAgent.reply({ self, ...room, llm });
    const strangers = actions.filter(
      (action) =>
        action.kind === "send" &&
        action.recipient !== "all" &&
        !room.participants.some((p) => p.participantId === action.recipient),
    );
    if (strangers.length > 0) {
      console.error(
        `gate.reply: dropped the reply of ${self}, which addressed someone outside the room`,
      );
      return null;
    }
    for (const action of actions) {
      try {
        if (action.kind === "close") {
          await ctx.runMutation(api.rooms.close, {
            sessionId,
            participantId: self,
          });
        } else {
          const sent = await sendThroughGate(ctx, {
            sessionId,
            senderParticipantId: self,
            recipient: action.recipient as Doc<"messages">["recipient"],
            content: action.content,
            hostedReply: true,
          });
          if (sent.status !== "allowed") return null;
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
  const recent: Message[] = [];
  let bytes = 0;
  for await (const doc of ctx.db
    .query("messages")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .order("desc")) {
    bytes += encoder.encode(JSON.stringify(doc)).length;
    if (bytes > HISTORY_BYTE_BUDGET && recent.length > 0) break;
    recent.push(toMessage(doc));
    if (recent.length === HISTORY_LIMIT) break;
  }
  return recent.reverse();
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
      .paginate({
        ...paginationOpts,
        maximumBytesRead: Math.min(
          paginationOpts.maximumBytesRead ?? HISTORY_BYTE_BUDGET,
          HISTORY_BYTE_BUDGET,
        ),
      });
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
