import { isRateLimitError } from "@convex-dev/rate-limiter";
import { type PaginationOptions, paginationOptsValidator } from "convex/server";
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
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireLiveCredential } from "./agentKeys";
import { type JudgeBuckets, judgeRetryAfter, moderate } from "./moderator";
import { roomAgentFor } from "./roomAgent";
import {
  HISTORY_BYTE_BUDGET,
  insertMessage,
  messageBytes,
} from "./roomMessages";
import {
  loadSession,
  MAX_PARTICIPANTS,
  requireRoomHuman,
  toMessage,
  toParticipant,
} from "./roomState";
import { visibleTo } from "./visibility";

const HISTORY_LIMIT = 500;

const recipientValidator = v.union(v.literal("all"), v.id("participants"));

function gateError(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

const sendArgs = {
  sessionId: v.id("sessions"),
  recipient: recipientValidator,
  content: zodToConvex(SendableContent),
};

export const send = action({
  args: sendArgs,
  handler: async (ctx, args): Promise<Message> => {
    const senderParticipantId: Id<"participants"> = await ctx.runQuery(
      internal.gate.humanSender,
      { sessionId: args.sessionId },
    );
    return sendThroughGate(ctx, { ...args, senderParticipantId });
  },
});

export const humanSender = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    (await requireRoomHuman(ctx, sessionId))._id,
});

export const sendAsParticipant = internalAction({
  args: { ...sendArgs, senderParticipantId: v.id("participants") },
  handler: (ctx, args): Promise<Message> => sendThroughGate(ctx, args),
});

function judgeBuckets(
  sessionId: Id<"sessions">,
  senderParticipantId: Id<"participants">,
): JudgeBuckets {
  return {
    sender: `participant:${senderParticipantId}`,
    room: `session:${sessionId}`,
  };
}

export async function sendThroughGate(
  ctx: ActionCtx,
  args: {
    sessionId: Id<"sessions">;
    senderParticipantId: Id<"participants">;
    recipient: Doc<"messages">["recipient"];
    content: unknown;
    hostedReply?: true;
    credentialId?: Id<"agentApiKeys">;
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
    inReplyTo: content.kind === "ui_response" ? content.inReplyTo : undefined,
  });

  const outcome = await moderate(
    ctx,
    {
      content,
      sender: room.sender,
      recipient: args.recipient,
      participants: room.participants,
      contract: room.contract,
      history: room.history,
    },
    judgeBuckets(args.sessionId, args.senderParticipantId),
  );

  return ctx.runMutation(internal.gate.commit, {
    sessionId: args.sessionId,
    senderParticipantId: args.senderParticipantId,
    recipient: args.recipient,
    content,
    verdict: outcome.verdict,
    events: outcome.events,
    hostedReply: args.hostedReply,
    credentialId: args.credentialId,
  });
}

export const moderationContext = internalQuery({
  args: {
    sessionId: v.id("sessions"),
    senderParticipantId: v.id("participants"),
    recipient: recipientValidator,
    inReplyTo: v.optional(v.string()),
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
    const { session, sender, replyTarget } = await checkSend(ctx, args);
    const history = await recentMessages(ctx, args.sessionId);
    if (
      replyTarget &&
      !history.some((m) => m.messageId === replyTarget.messageId)
    ) {
      history.unshift(replyTarget);
    }
    return {
      contract: session.contract,
      sender,
      participants: session.participants,
      history,
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

const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, field) =>
    field && typeof field === "object" && !Array.isArray(field)
      ? Object.fromEntries(
          Object.entries(field).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : field,
  );

export const commit = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    senderParticipantId: v.id("participants"),
    recipient: recipientValidator,
    content: zodToConvex(SendableContent),
    verdict: zodToConvex(Verdict),
    events: v.array(eventValidator),
    hostedReply: v.optional(v.literal(true)),
    credentialId: v.optional(v.id("agentApiKeys")),
  },
  handler: async (ctx, { credentialId, ...args }): Promise<Message> => {
    const { session, sender } = await checkSend(ctx, {
      ...args,
      inReplyTo:
        args.content.kind === "ui_response"
          ? args.content.inReplyTo
          : undefined,
    });
    if (credentialId) {
      await requireLiveCredential(
        ctx,
        credentialId,
        sender.kind === "agent" ? sender.agentId : "",
      );
    }
    const { content, verdict } = args;
    if (
      args.hostedReply &&
      verdict.decision === "allow" &&
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
      if (previous && canonical(previous.content) === canonical(content)) {
        return toMessage(previous);
      }
    }
    const agentTurn = sender.kind === "agent";
    const turnCount = session.turnCount + (agentTurn ? 1 : 0);
    const exhausted = turnCount >= session.contract.maxTurns;
    const messageId = await insertMessage(ctx, {
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
    let terminated = false;
    if (
      verdict.decision === "block" &&
      args.events.some(
        (event) =>
          event.action === "block" &&
          !event.reasons.some((reason) => reason.code === "moderator_error"),
      )
    ) {
      const stored = await ctx.db.get("sessions", args.sessionId);
      const violationCount = (stored?.violationCount ?? 0) + 1;
      terminated = violationCount >= session.contract.maxViolations;
      await ctx.db.patch("sessions", args.sessionId, {
        violationCount,
        ...(terminated
          ? { status: "terminated" as const, closedReason: "max_violations" }
          : {}),
      });
      if (terminated) {
        await publishNotice(
          ctx,
          args.sessionId,
          "session_terminated",
          `La sala se cerró tras ${violationCount} mensajes bloqueados.`,
        );
      }
    }
    if (agentTurn) {
      await ctx.db.patch("sessions", args.sessionId, { turnCount });
      if (exhausted && !terminated) {
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
    const message = toMessage(source);
    if (
      !viewer ||
      !visibleTo(message, viewer, room.participants, source._creationTime)
    ) {
      return null;
    }
    const recent = await recentDocs(ctx, source.sessionId);
    return {
      agent,
      self: recipient._id,
      sessionId: source.sessionId,
      message,
      contract: room.contract,
      participants: room.participants,
      history: visibleMessages(recent, viewer, room.participants),
    };
  },
});

export const reply = internalAction({
  args: { messageId: v.id("messages"), participantId: v.id("participants") },
  handler: async (ctx, args): Promise<null> => {
    const input = await ctx.runQuery(internal.gate.replyContext, args);
    if (!input) return null;
    const { agent, self, sessionId, ...room } = input;
    const retryAfter = await judgeRetryAfter(
      ctx,
      judgeBuckets(sessionId, self),
    );
    if (retryAfter !== undefined) {
      await ctx.scheduler.runAfter(retryAfter, internal.gate.reply, args);
      return null;
    }
    const guest = room.participants.some(
      (p) =>
        p.participantId === self && p.kind === "agent" && p.role === "guest",
    );
    const { agent: roomAgent, llm } = roomAgentFor(agent, ctx, guest);
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
    for (const [index, action] of actions.entries()) {
      try {
        if (action.kind === "close") {
          await ctx.runMutation(internal.rooms.closeAsParticipant, {
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
        if (isRateLimitError(error)) {
          if (index === 0) {
            await ctx.scheduler.runAfter(
              error.data.retryAfter,
              internal.gate.reply,
              args,
            );
          } else {
            console.error(
              `gate.reply: dropped the rate-limited messages of ${self}`,
            );
            if (actions.slice(index).some((a) => a.kind === "close")) {
              await ctx.runMutation(internal.rooms.closeAsParticipant, {
                sessionId,
                participantId: self,
              });
            }
          }
          return null;
        }
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
  return (await recentDocs(ctx, sessionId)).map(toMessage);
}

function visibleMessages(
  docs: Doc<"messages">[],
  viewer: Participant,
  participants: Participant[],
) {
  return docs.flatMap((doc) => {
    const message = toMessage(doc);
    return visibleTo(message, viewer, participants, doc._creationTime)
      ? [message]
      : [];
  });
}

async function recentDocs(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const recent: Doc<"messages">[] = [];
  let bytes = 0;
  for await (const doc of ctx.db
    .query("messages")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .order("desc")) {
    bytes += messageBytes(doc);
    if (bytes > HISTORY_BYTE_BUDGET && recent.length > 0) break;
    recent.push(doc);
    if (recent.length === HISTORY_LIMIT) break;
  }
  return recent.reverse();
}

const sessionArgs = { sessionId: v.id("sessions") };
const participantHistoryArgs = {
  ...sessionArgs,
  viewerParticipantId: v.id("participants"),
};

export const history = query({
  args: sessionArgs,
  handler: async (ctx, { sessionId }): Promise<Message[]> =>
    historyForViewer(
      ctx,
      sessionId,
      toParticipant(await requireRoomHuman(ctx, sessionId)),
    ),
});

export const historyForParticipant = internalQuery({
  args: participantHistoryArgs,
  handler: async (
    ctx,
    { sessionId, viewerParticipantId },
  ): Promise<Message[]> => {
    const viewer = await roomViewer(ctx, sessionId, viewerParticipantId);
    return historyForViewer(ctx, sessionId, viewer);
  },
});

async function historyForViewer(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  viewer: Participant,
) {
  const docs = await recentDocs(ctx, sessionId);
  const participants = await roomParticipants(ctx, sessionId);
  return visibleMessages(docs, viewer, participants);
}

export const historyPage = query({
  args: { ...sessionArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { sessionId, paginationOpts }) => {
    const viewer = toParticipant(await requireRoomHuman(ctx, sessionId));
    return historyPageForViewer(ctx, sessionId, viewer, paginationOpts);
  },
});

export const historyPageForParticipant = internalQuery({
  args: { ...participantHistoryArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { sessionId, viewerParticipantId, paginationOpts }) => {
    const viewer = await roomViewer(ctx, sessionId, viewerParticipantId);
    return historyPageForViewer(ctx, sessionId, viewer, paginationOpts);
  },
});

async function historyPageForViewer(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  viewer: Participant,
  paginationOpts: PaginationOptions,
) {
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
  const participants = await roomParticipants(ctx, sessionId);
  return {
    ...result,
    page: visibleMessages(result.page, viewer, participants),
  };
}

async function roomParticipants(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const rows = await ctx.db
    .query("participants")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_PARTICIPANTS);
  return rows.map(toParticipant);
}

async function roomViewer(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  viewerParticipantId: Id<"participants">,
) {
  if (!(await ctx.db.get(sessionId))) {
    gateError("NotFound", "the room does not exist");
  }
  const viewer = await ctx.db.get(viewerParticipantId);
  if (viewer?.sessionId !== sessionId || viewer.leftAt !== undefined) {
    gateError("NotParticipant", "the viewer is not in this room");
  }
  return toParticipant(viewer);
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
  return insertMessage(ctx, {
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
    inReplyTo?: string;
  },
) {
  const session = await loadSession(ctx, args.sessionId);
  if (!session) gateError("NotFound", "the room does not exist");
  if (session.status !== "active" || !session.contract) {
    gateError("RoomClosed", "the room is closed and accepts no new messages");
  }
  const senderRow = await ctx.db.get(args.senderParticipantId);
  if (
    senderRow?.sessionId !== args.sessionId ||
    senderRow.leftAt !== undefined
  ) {
    gateError("NotParticipant", "the sender is not in this room");
  }
  const sender = toParticipant(senderRow);
  if (
    sender.kind === "agent" &&
    session.turnCount >= session.contract.maxTurns
  ) {
    gateError("TurnLimitReached", "the room has reached its agent turn limit");
  }
  if (args.recipient !== "all") {
    const recipientRow = await ctx.db.get(args.recipient);
    if (
      recipientRow?.sessionId !== args.sessionId ||
      recipientRow.leftAt !== undefined
    ) {
      gateError("InvalidArgument", "the recipient is not in this room");
    }
  }
  return {
    session: { ...session, contract: session.contract },
    sender,
    replyTarget:
      args.inReplyTo === undefined
        ? null
        : await replyTarget(ctx, args.sessionId, sender, args.inReplyTo),
  };
}

async function replyTarget(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  sender: Participant,
  inReplyTo: string,
): Promise<Message> {
  const id = ctx.db.normalizeId("messages", inReplyTo);
  const target = id ? await ctx.db.get(id) : null;
  if (
    !target ||
    target.sessionId !== sessionId ||
    target.content.kind !== "ui" ||
    target.moderation.status !== "allowed" ||
    target.recipient !== sender.participantId
  ) {
    gateError(
      "InvalidArgument",
      "inReplyTo must name a delivered UI block sent to the sender in this room",
    );
  }
  return toMessage(target);
}
