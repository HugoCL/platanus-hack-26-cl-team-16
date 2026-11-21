import { ConvexError, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { type Message, SendableContent } from "../shared/messages";
import type { Session, SessionStatus } from "../shared/session";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { agentForApiKey } from "./agentKeys";
import { sendThroughGate } from "./gate";
import { loadSession, toMessage } from "./roomState";
import { closeRoom, openRoom } from "./rooms";
import { visibleTo } from "./visibility";

// Room operations for external agents, called by the MCP server in lib/mcp.ts. Each one takes the
// caller's API key and resolves the agent from it; the room itself is E2's (rooms.ts, gate.ts), so
// an external agent's messages pass the same moderation gate as an internal agent's.

const READ_LIMIT = 100;

function fail(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

async function callerAgent(ctx: QueryCtx, apiKey: string) {
  const agent = await agentForApiKey(ctx, apiKey);
  if (!agent) fail("Unauthorized", "the API key is not valid");
  return agent;
}

// A room the caller is not in and a room that does not exist answer the same way, so a key cannot
// probe other rooms.
async function callerParticipant(
  ctx: QueryCtx,
  apiKey: string,
  sessionId: string,
) {
  const agent = await callerAgent(ctx, apiKey);
  const id = ctx.db.normalizeId("sessions", sessionId);
  const participant =
    id &&
    (await ctx.db
      .query("participants")
      .withIndex("by_agentId_and_sessionId", (q) =>
        q.eq("agentId", agent._id).eq("sessionId", id),
      )
      .first());
  if (!participant || participant.leftAt !== undefined) {
    fail("NotParticipant", "you are not a participant in this room");
  }
  return participant;
}

export const opener = internalQuery({
  args: { apiKey: v.string(), targetAgentId: v.string() },
  handler: async (ctx, { apiKey, targetAgentId }) => {
    const agent = await callerAgent(ctx, apiKey);
    const providerAgentId = ctx.db.normalizeId("agents", targetAgentId);
    if (!providerAgentId) {
      fail(
        "InvalidArgument",
        "the provider card does not exist or is not listed",
      );
    }
    return { initiatorAgentId: agent._id, providerAgentId };
  },
});

export const open = action({
  args: {
    apiKey: v.string(),
    targetAgentId: v.string(),
    intent: v.string(),
    request: v.string(),
  },
  handler: async (
    ctx,
    { apiKey, targetAgentId, intent, request },
  ): Promise<Session> => {
    const agents: {
      initiatorAgentId: Id<"agents">;
      providerAgentId: Id<"agents">;
    } = await ctx.runQuery(internal.mcpRooms.opener, { apiKey, targetAgentId });
    return openRoom(ctx, { ...agents, request, intent });
  },
});

export const sender = internalQuery({
  args: { apiKey: v.string(), sessionId: v.string(), recipient: v.string() },
  handler: async (ctx, { apiKey, sessionId, recipient }) => {
    const participant = await callerParticipant(ctx, apiKey, sessionId);
    const to =
      recipient === "all"
        ? ("all" as const)
        : ctx.db.normalizeId("participants", recipient);
    if (!to) fail("InvalidArgument", "the recipient is not in this room");
    return {
      sessionId: participant.sessionId,
      senderParticipantId: participant._id,
      recipient: to,
    };
  },
});

export const send = action({
  args: {
    apiKey: v.string(),
    sessionId: v.string(),
    recipient: v.string(),
    content: zodToConvex(SendableContent),
  },
  handler: async (ctx, { content, ...args }): Promise<Message> => {
    const route: {
      sessionId: Id<"sessions">;
      senderParticipantId: Id<"participants">;
      recipient: Id<"participants"> | "all";
    } = await ctx.runQuery(internal.mcpRooms.sender, args);
    return sendThroughGate(ctx, { ...route, content });
  },
});

// Messages the caller can see after `after`, oldest first. The cursor is the creation time of the
// last message read, visible or not, so the next read starts after it.
export const messages = query({
  args: {
    apiKey: v.string(),
    sessionId: v.string(),
    after: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { apiKey, sessionId, after = 0 },
  ): Promise<{
    messages: Message[];
    cursor: number;
    sessionStatus: SessionStatus;
  }> => {
    const participant = await callerParticipant(ctx, apiKey, sessionId);
    const room = await loadSession(ctx, participant.sessionId);
    const viewer = room?.participants.find(
      (p) => p.participantId === participant._id,
    );
    if (!room || !viewer) {
      fail("NotParticipant", "you are not a participant in this room");
    }
    const docs = await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) =>
        q.eq("sessionId", participant.sessionId).gt("_creationTime", after),
      )
      .take(READ_LIMIT);
    return {
      messages: docs.map(toMessage).filter((m) => visibleTo(m, viewer)),
      cursor: docs.at(-1)?._creationTime ?? after,
      sessionStatus: room.status,
    };
  },
});

export const close = mutation({
  args: { apiKey: v.string(), sessionId: v.string() },
  handler: async (ctx, { apiKey, sessionId }) => {
    const participant = await callerParticipant(ctx, apiKey, sessionId);
    return closeRoom(ctx, {
      sessionId: participant.sessionId,
      participantId: participant._id,
    });
  },
});
