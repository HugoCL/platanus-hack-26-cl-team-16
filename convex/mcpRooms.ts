import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { type Message, SendableContent } from "../shared/messages";
import type { Session, SessionStatus } from "../shared/session";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { credentialForApiKey } from "./agentKeys";
import { friendsOf } from "./friends";
import { sendThroughGate } from "./gate";
import { requestInvitation } from "./roomInvitations";
import { messagesAfter } from "./roomMessages";
import { loadSession, toMessage } from "./roomState";
import { closeRoom, openRoom } from "./rooms";
import { visibleTo } from "./visibility";

// Room operations for external agents, called by the MCP server in lib/mcp.ts. Each one takes the
// caller's API key, resolves the agent from it and spends a token of the key's `mcpRequest`
// bucket before touching a room, even when the operation fails. The room itself is E2's, so
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

async function chargeRequest(ctx: ActionCtx, apiKey: string) {
  const result = await ctx.runMutation(api.agentKeys.authenticate, { apiKey });
  if (!result) fail("Unauthorized", "the API key is not valid");
  if (!result.ok) {
    throw new ConvexError({
      kind: "RateLimited",
      message: "the API key request quota is exhausted",
      retryAfter: result.retryAfterMs,
    });
  }
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
  if (id) {
    for await (const participant of ctx.db
      .query("participants")
      .withIndex("by_agentId_and_sessionId", (q) =>
        q.eq("agentId", agent._id).eq("sessionId", id),
      )) {
      if (participant.leftAt === undefined) {
        return {
          participant,
          credentialId: key._id,
          agentId: agent._id,
          ownerTokenIdentifier: agent.ownerTokenIdentifier,
        };
      }
    }
  }
  fail("NotParticipant", "you are not a participant in this room");
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
    await chargeRequest(ctx, apiKey);
    const caller: {
      initiatorAgentId: Id<"agents">;
      providerAgentId: Id<"agents">;
      credentialId: Id<"agentApiKeys">;
    } = await ctx.runQuery(internal.mcpRooms.opener, {
      apiKey,
      targetAgentId,
    });
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
    await chargeRequest(ctx, args.apiKey);
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
const messageArgs = {
  apiKey: v.string(),
  sessionId: v.string(),
  after: v.optional(v.string()),
};

type MessagePage = {
  messages: Message[];
  cursor: string | null;
  sessionStatus: SessionStatus;
  participants: Session["participants"];
};

export const messages = action({
  args: messageArgs,
  handler: async (ctx, args): Promise<MessagePage> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runQuery(internal.mcpRooms.readMessages, args);
  },
});

export const readMessages = internalQuery({
  args: messageArgs,
  handler: async (ctx, { apiKey, sessionId, after }): Promise<MessagePage> => {
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
      messages: page.messages.flatMap((doc) => {
        const m = toMessage(doc);
        return (m.recipient === "all" ||
          m.recipient === viewer.participantId ||
          m.senderParticipantId === viewer.participantId) &&
          visibleTo(m, viewer, room.participants, doc._creationTime)
          ? [m]
          : [];
      }),
      cursor: page.cursor,
      sessionStatus: room.status,
      // The agents in the room now: one that joins later is addressed by the id listed here.
      participants: room.participants.filter((p) => p.kind === "agent"),
    };
  },
});

const closeArgs = { apiKey: v.string(), sessionId: v.string() };

export const close = action({
  args: closeArgs,
  handler: async (
    ctx,
    args,
  ): Promise<Awaited<ReturnType<typeof closeRoom>>> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runMutation(internal.mcpRooms.closeAsCaller, args);
  },
});

export const closeAsCaller = internalMutation({
  args: closeArgs,
  handler: async (ctx, { apiKey, sessionId }) => {
    const { participant } = await callerParticipant(ctx, apiKey, sessionId);
    return closeRoom(ctx, {
      sessionId: participant.sessionId,
      participantId: participant._id,
    });
  },
});

// Friends and invitations belong to the human who owns the calling agent. A key never answers an
// invitation: approving stays with that human, on the site, or with their auto-approve switch.
const INVITATION_LIMIT = 50;
const INVITATION_SCAN_LIMIT = 1000;

type FriendAgent = {
  agentId: Id<"agents">;
  name: string;
  description: string;
  friendName: string;
};

export const friendAgents = action({
  args: { apiKey: v.string() },
  handler: async (ctx, args): Promise<{ agents: FriendAgent[] }> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runQuery(internal.mcpRooms.readFriendAgents, args);
  },
});

export const readFriendAgents = internalQuery({
  args: { apiKey: v.string() },
  handler: async (ctx, { apiKey }): Promise<{ agents: FriendAgent[] }> => {
    const { agent } = await callerCredential(ctx, apiKey);
    const friends = agent.ownerTokenIdentifier
      ? await friendsOf(ctx, agent.ownerTokenIdentifier)
      : [];
    return {
      agents: friends.flatMap((friend) =>
        friend.agents.map((a) => ({ ...a, friendName: friend.name })),
      ),
    };
  },
});

const inviteArgs = {
  apiKey: v.string(),
  sessionId: v.string(),
  agentId: v.string(),
};
type InviteResult = { status: "pending" | "approved" };

export const invite = action({
  args: inviteArgs,
  handler: async (ctx, args): Promise<InviteResult> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runMutation(internal.mcpRooms.inviteAsCaller, args);
  },
});

// The agent that opened the room invites for its owner, whose friendships decide the answer. A
// provider or a guest in the room cannot bring others in.
export const inviteAsCaller = internalMutation({
  args: inviteArgs,
  handler: async (
    ctx,
    { apiKey, sessionId, agentId },
  ): Promise<InviteResult> => {
    const { participant, ownerTokenIdentifier } = await callerParticipant(
      ctx,
      apiKey,
      sessionId,
    );
    if (participant.role !== "initiator") {
      fail("Forbidden", "only the agent that opened the room can invite");
    }
    const target = ctx.db.normalizeId("agents", agentId);
    if (!ownerTokenIdentifier || !target) {
      fail("NotFriend", "you can only invite an agent that a friend owns");
    }
    return requestInvitation(ctx, {
      sessionId: participant.sessionId,
      agentId: target,
      inviterTokenIdentifier: ownerTokenIdentifier,
    });
  },
});

type AgentInvitation = {
  sessionId: Id<"sessions">;
  status: "pending" | "approved";
  inviterName: string;
  request?: string;
};

export const invitations = action({
  args: { apiKey: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ invitations: AgentInvitation[]; truncated: boolean }> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runQuery(internal.mcpRooms.readInvitations, args);
  },
});

// What the calling agent was asked into: requests its owner has not answered yet, and the active
// rooms it already joined as a guest. What a room is for is shown only once the agent is in it.
export const readInvitations = internalQuery({
  args: { apiKey: v.string() },
  handler: async (
    ctx,
    { apiKey },
  ): Promise<{ invitations: AgentInvitation[]; truncated: boolean }> => {
    const { agent } = await callerCredential(ctx, apiKey);
    const invitations: AgentInvitation[] = [];
    let truncated = false;
    // Rooms the agent is already in come first, so a backlog of unanswered requests cannot
    // crowd out the ones it has to act in.
    for (const status of ["approved", "pending"] as const) {
      let scanned = 0;
      const rows = ctx.db
        .query("roomInvitations")
        .withIndex("by_agentId_and_status", (q) =>
          q.eq("agentId", agent._id).eq("status", status),
        )
        .order("desc");
      // Invitations outlive their room, so closed rooms are skipped here instead of counting
      // against what is returned.
      for await (const row of rows) {
        if (
          invitations.length === INVITATION_LIMIT ||
          scanned++ === INVITATION_SCAN_LIMIT
        ) {
          truncated = true;
          break;
        }
        const session = await ctx.db.get("sessions", row.sessionId);
        if (session?.status !== "active") continue;
        invitations.push({
          sessionId: row.sessionId,
          status,
          inviterName: row.inviterName,
          ...(status === "approved" && { request: session.intent.description }),
        });
      }
    }
    return { invitations, truncated };
  },
});

const SESSION_LIMIT = 20;
const RECIPIENT_SCAN = 100;

type AgentSession = {
  sessionId: Id<"sessions">;
  request: string;
  agents: { participantId: Id<"participants">; name: string }[];
};
type AgentSessions = { sessions: AgentSession[]; truncated: boolean };

export const sessions = action({
  args: { apiKey: v.string() },
  handler: async (ctx, args): Promise<AgentSessions> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runQuery(internal.mcpRooms.readSessions, args);
  },
});

// The active rooms the calling agent started or was opened with, newest first, so an agent in a
// new conversation finds a room it opened earlier, one opened with it, or one its owner set up
// for it, without being handed its id. Rooms it joined as a guest are in `readInvitations`.
export const readSessions = internalQuery({
  args: { apiKey: v.string() },
  handler: async (ctx, { apiKey }): Promise<AgentSessions> => {
    const { agent } = await callerCredential(ctx, apiKey);
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_initiatorAgentId_and_status", (q) =>
        q.eq("initiatorAgentId", agent._id).eq("status", "active"),
      )
      .order("desc")
      .take(SESSION_LIMIT + 1);
    // No index says which rooms opened with an agent are still active, so this reads the latest
    // rooms it entered, up to a bound, and reports `truncated` when there were more.
    const seats = await ctx.db
      .query("participants")
      .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .take(RECIPIENT_SCAN + 1);
    for (const seat of seats.slice(0, RECIPIENT_SCAN)) {
      if (seat.role !== "recipient" || seat.leftAt !== undefined) continue;
      const session = await ctx.db.get("sessions", seat.sessionId);
      if (
        session?.status === "active" &&
        session.initiatorAgentId !== agent._id
      ) {
        rows.push(session);
      }
    }
    rows.sort((a, b) => b._creationTime - a._creationTime);
    const sessions: AgentSession[] = [];
    for (const { _id: sessionId } of rows.slice(0, SESSION_LIMIT)) {
      const room = await loadSession(ctx, sessionId);
      let me: Id<"participants"> | undefined;
      for await (const row of ctx.db
        .query("participants")
        .withIndex("by_agentId_and_sessionId", (q) =>
          q.eq("agentId", agent._id).eq("sessionId", sessionId),
        )) {
        if (row.leftAt === undefined) me = row._id;
      }
      if (!room || !me) continue;
      const agents: AgentSession["agents"] = [];
      for (const p of room.participants) {
        if (p.kind !== "agent" || p.participantId === me) continue;
        const other = await ctx.db.get("agents", p.agentId as Id<"agents">);
        agents.push({
          participantId: p.participantId as Id<"participants">,
          name: other?.name ?? "Agente",
        });
      }
      sessions.push({ sessionId, request: room.intent.description, agents });
    }
    return {
      sessions,
      truncated: rows.length > SESSION_LIMIT || seats.length > RECIPIENT_SCAN,
    };
  },
});
