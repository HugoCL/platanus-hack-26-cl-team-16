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
import { moderate } from "./moderator";
import { fakeRoomLlm, testRoomAgent } from "./roomAgent";
import {
  loadSession,
  requireRoomHuman,
  toMessage,
  toParticipant,
} from "./roomState";
import { visibleTo } from "./visibility";

const HISTORY_LIMIT = 500;
const HISTORY_BYTE_BUDGET = 4 * 1024 * 1024;
const encoder = new TextEncoder();

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
    {
      sender:
        room.sender.kind === "agent"
          ? `agent:${room.sender.agentId}`
          : `participant:${args.senderParticipantId}`,
      room: `session:${args.sessionId}`,
    },
  );

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
    const { session, sender } = await checkSend(ctx, {
      ...args,
      inReplyTo:
        args.content.kind === "ui_response"
          ? args.content.inReplyTo
          : undefined,
    });
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
    if (
      verdict.decision === "block" &&
      !args.events.some((event) =>
        event.reasons.some((reason) => reason.code === "moderator_error"),
      )
    ) {
      const stored = await ctx.db.get("sessions", args.sessionId);
      const violationCount = (stored?.violationCount ?? 0) + 1;
      const terminated = violationCount >= session.contract.maxViolations;
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
  message: Message;
  contract: SessionContract;
  history: Message[];
  senderParticipantId: Id<"participants">;
  recipientParticipantId: Id<"participants">;
  sessionId: Id<"sessions">;
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
      message: toMessage(source),
      contract: room.contract,
      history: recent.filter((message) => visibleTo(message, viewer)),
      senderParticipantId: recipient._id,
      recipientParticipantId: source.senderParticipantId,
      sessionId: source.sessionId,
    };
  },
});

export const reply = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }): Promise<null> => {
    const input = await ctx.runQuery(internal.gate.replyContext, { messageId });
    if (!input) return null;
    const {
      message,
      contract,
      history,
      senderParticipantId,
      recipientParticipantId,
      sessionId,
    } = input;
    const content = await testRoomAgent.reply({
      message,
      contract,
      history,
      llm: fakeRoomLlm,
    });
    if (content) {
      try {
        await sendThroughGate(ctx, {
          sessionId,
          senderParticipantId,
          recipient: recipientParticipantId,
          content,
        });
      } catch (error) {
        if (isRateLimitError(error)) {
          await ctx.scheduler.runAfter(
            error.data.retryAfter,
            internal.gate.reply,
            {
              messageId,
            },
          );
          return null;
        }
        if (
          !(error instanceof ConvexError) ||
          (error.data?.kind !== "RoomClosed" &&
            error.data?.kind !== "TurnLimitReached")
        ) {
          throw error;
        }
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
  const messages = await recentMessages(ctx, sessionId);
  return messages.filter((message) => visibleTo(message, viewer));
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
  return {
    ...result,
    page: result.page
      .map(toMessage)
      .filter((message) => visibleTo(message, viewer)),
  };
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
