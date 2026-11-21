import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { type Message, SendableContent } from "../shared/messages";
import type { Session, SessionStatus } from "../shared/session";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { credentialForApiKey } from "./agentKeys";
import { sendThroughGate } from "./gate";
import { messagesAfter } from "./roomMessages";
import { loadSession, toMessage } from "./roomState";
import { closeRoom, openRoom } from "./rooms";
import { visibleTo } from "./visibility";

// Room operations for external agents, called by the MCP server in lib/mcp.ts. Each one takes the
// caller's API key and resolves the agent from it; the room itself is E2's (rooms.ts, gate.ts), so
// an external agent's messages pass the same moderation gate as an internal agent's.

// The key travels to the final write as `credentialId`, which re-checks it there, so a key revoked
// while moderation runs no longer opens a room or sends.

const READ_LIMIT = 100;

// Each open and send runs the moderator, an LLM call, so an external agent gets its own bucket.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  mcpModeratedWrite: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 10,
  },
});

function fail(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

async function callerCredential(ctx: QueryCtx, apiKey: string) {
  const credential = await credentialForApiKey(ctx, apiKey);
  if (!credential) fail("Unauthorized", "the API key is not valid");
  return credential;
}

const spendModeratedWrite = (ctx: ActionCtx, agentId: Id<"agents">) =>
  rateLimiter.limit(ctx, "mcpModeratedWrite", { key: agentId, throws: true });

// A room the caller is not in and a room that does not exist answer the same way, so a key cannot
// probe other rooms.
async function callerParticipant(
  ctx: QueryCtx,
  apiKey: string,
  sessionId: string,
) {
  const { key, agent } = await callerCredential(ctx, apiKey);
  const id = ctx.db.normalizeId("sessions", sessionId);
  const rows = id
    ? await ctx.db
        .query("participants")
        .withIndex("by_agentId_and_sessionId", (q) =>
          q.eq("agentId", agent._id).eq("sessionId", id),
        )
        .collect()
    : [];
  const participant = rows.find((row) => row.leftAt === undefined);
  if (!participant) {
    fail("NotParticipant", "you are not a participant in this room");
  }
  return { participant, credentialId: key._id, agentId: agent._id };
}

export const opener = internalQuery({
  args: { apiKey: v.string(), targetAgentId: v.string() },
  handler: async (ctx, { apiKey, targetAgentId }) => {
    const { key, agent } = await callerCredential(ctx, apiKey);
    const providerAgentId = ctx.db.normalizeId("agents", targetAgentId);
    if (!providerAgentId) {
      fail(
        "InvalidArgument",
        "the provider card does not exist or is not listed",
      );
    }
    return {
      initiatorAgentId: agent._id,
      providerAgentId,
      credentialId: key._id,
    };
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
    const caller: {
      initiatorAgentId: Id<"agents">;
      providerAgentId: Id<"agents">;
      credentialId: Id<"agentApiKeys">;
    } = await ctx.runQuery(internal.mcpRooms.opener, { apiKey, targetAgentId });
    await spendModeratedWrite(ctx, caller.initiatorAgentId);
    return openRoom(ctx, { ...caller, request, intent });
  },
});

export const sender = internalQuery({
  args: { apiKey: v.string(), sessionId: v.string(), recipient: v.string() },
  handler: async (ctx, { apiKey, sessionId, recipient }) => {
    const { participant, credentialId, agentId } = await callerParticipant(
      ctx,
      apiKey,
      sessionId,
    );
    const to =
      recipient === "all"
        ? ("all" as const)
        : ctx.db.normalizeId("participants", recipient);
    if (!to) fail("InvalidArgument", "the recipient is not in this room");
    return {
      sessionId: participant.sessionId,
      senderParticipantId: participant._id,
      recipient: to,
      credentialId,
      agentId,
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
    const {
      agentId,
      ...route
    }: {
      sessionId: Id<"sessions">;
      senderParticipantId: Id<"participants">;
      recipient: Id<"participants"> | "all";
      credentialId: Id<"agentApiKeys">;
      agentId: Id<"agents">;
    } = await ctx.runQuery(internal.mcpRooms.sender, args);
    await spendModeratedWrite(ctx, agentId);
    return sendThroughGate(ctx, { ...route, content });
  },
});

// Messages the caller can see after `after`, in the room's commit order (`seq`, see
// convex/roomMessages.ts). The cursor is opaque and points after the last message read, visible or
// not, so a page the caller cannot see still moves it forward. A page stops at READ_LIMIT rows or
// before the history byte budget.
export const messages = query({
  args: {
    apiKey: v.string(),
    sessionId: v.string(),
    after: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { apiKey, sessionId, after },
  ): Promise<{
    messages: Message[];
    cursor: string | null;
    sessionStatus: SessionStatus;
  }> => {
    const { participant } = await callerParticipant(ctx, apiKey, sessionId);
    const room = await loadSession(ctx, participant.sessionId);
    const viewer = room?.participants.find(
      (p) => p.participantId === participant._id,
    );
    if (!room || !viewer) {
      fail("NotParticipant", "you are not a participant in this room");
    }
    const page = await messagesAfter(
      ctx,
      participant.sessionId,
      after ?? null,
      {
        limit: READ_LIMIT,
      },
    );
    return {
      messages: page.messages
        .map(toMessage)
        .filter((m) => visibleTo(m, viewer)),
      cursor: page.cursor,
      sessionStatus: room.status,
    };
  },
});

export const close = mutation({
  args: { apiKey: v.string(), sessionId: v.string() },
  handler: async (ctx, { apiKey, sessionId }) => {
    const { participant } = await callerParticipant(ctx, apiKey, sessionId);
    return closeRoom(ctx, {
      sessionId: participant.sessionId,
      participantId: participant._id,
    });
  },
});
