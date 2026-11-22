import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { friendship } from "./friends";
import { publishNotice } from "./gate";
import {
  MAX_PARTICIPANTS,
  requireRoomHuman,
  requireRoomIdentity,
} from "./roomState";

const PENDING_LIMIT = 50;

function fail(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

async function activeRoom(ctx: MutationCtx, sessionId: Id<"sessions">) {
  const session = await ctx.db.get("sessions", sessionId);
  if (session?.status !== "active") {
    fail("RoomNotActive", "the room is not active");
  }
  return session;
}

// Checks the room can take the agent, and returns whether its owner is already in the room.
// A human is in a room for one agent, and sees what the moderator withholds from that side only,
// so a second guest of theirs would have nobody able to see its blocked messages.
async function seat(
  ctx: MutationCtx,
  {
    sessionId,
    agentId,
    ownerTokenIdentifier,
  }: Pick<
    Doc<"roomInvitations">,
    "sessionId" | "agentId" | "ownerTokenIdentifier"
  >,
) {
  const members = await ctx.db
    .query("participants")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_PARTICIPANTS + 1);
  if (members.some((p) => p.kind === "agent" && p.agentId === agentId)) {
    fail("AlreadyParticipant", "the agent is already in the room");
  }
  const owner = members.find(
    (p) => p.kind === "human" && p.tokenIdentifier === ownerTokenIdentifier,
  );
  if (
    owner?.kind === "human" &&
    members.some(
      (p) =>
        p.kind === "agent" &&
        p.role === "guest" &&
        p.agentId === owner.onBehalfOfAgentId,
    )
  ) {
    fail("OwnerHasGuest", "that friend already has an agent in the room");
  }
  if (members.length + (owner ? 1 : 2) > MAX_PARTICIPANTS) {
    fail("RoomFull", `a room holds at most ${MAX_PARTICIPANTS} participants`);
  }
  return owner !== undefined;
}

// Adds the agent as a guest and its owner as a human on its behalf. A guest is not the room's
// provider, so the moderation rules that let personal data reach the provider do not cover it.
async function join(
  ctx: MutationCtx,
  invitation: Pick<
    Doc<"roomInvitations">,
    "sessionId" | "agentId" | "ownerTokenIdentifier" | "inviterName"
  >,
  ownerName: string,
) {
  const { sessionId, agentId, ownerTokenIdentifier } = invitation;
  await activeRoom(ctx, sessionId);
  const agent = await ctx.db.get("agents", agentId);
  if (agent?.ownerTokenIdentifier !== ownerTokenIdentifier) {
    fail("NotFound", "the agent no longer belongs to that friend");
  }
  const ownerPresent = await seat(ctx, invitation);
  await ctx.db.insert("participants", {
    sessionId,
    kind: "agent",
    agentId,
    role: "guest",
  });
  if (!ownerPresent) {
    await ctx.db.insert("participants", {
      sessionId,
      kind: "human",
      tokenIdentifier: ownerTokenIdentifier,
      displayName: ownerName,
      role: "owner",
      onBehalfOfAgentId: agentId,
    });
  }
  await publishNotice(
    ctx,
    sessionId,
    "agent_joined",
    `${agent.name} se unió a la sala, invitado por ${invitation.inviterName}.`,
  );
}

function pendingInRoom(ctx: Pick<QueryCtx, "db">, sessionId: Id<"sessions">) {
  return ctx.db
    .query("roomInvitations")
    .withIndex("by_sessionId_and_status", (q) =>
      q.eq("sessionId", sessionId).eq("status", "pending"),
    )
    .take(PENDING_LIMIT);
}

export const invite = mutation({
  args: { sessionId: v.id("sessions"), agentId: v.id("agents") },
  returns: v.object({
    status: v.union(v.literal("pending"), v.literal("approved")),
  }),
  handler: async (ctx, { sessionId, agentId }) => {
    const inviter = await requireRoomHuman(ctx, sessionId);
    if (inviter.role === "observer") {
      fail("Forbidden", "observers cannot invite agents");
    }
    await activeRoom(ctx, sessionId);
    const agent = await ctx.db.get("agents", agentId);
    const owner = agent?.ownerTokenIdentifier;
    const theirs =
      owner && (await friendship(ctx, inviter.tokenIdentifier, owner));
    const mine =
      owner && (await friendship(ctx, owner, inviter.tokenIdentifier));
    // Both directions must exist, and one error covers every miss so agent ids cannot be probed.
    if (!owner || !theirs || !mine) {
      fail("NotFriend", "you can only invite an agent that a friend owns");
    }
    const pending = await pendingInRoom(ctx, sessionId);
    if (pending.some((row) => row.agentId === agentId)) {
      fail("AlreadyInvited", "that agent already has a pending invitation");
    }
    if (pending.length >= PENDING_LIMIT) {
      fail("TooManyInvitations", "this room has too many pending invitations");
    }
    const invitation = {
      sessionId,
      agentId,
      inviterTokenIdentifier: inviter.tokenIdentifier,
      // The name the owner knows the inviter by; the room's own label can be a bare "Tú".
      inviterName: mine.friendName,
      ownerTokenIdentifier: owner,
    };
    if (mine.autoApprove) {
      await join(ctx, invitation, theirs.friendName);
    } else {
      await seat(ctx, invitation);
    }
    const status = mine.autoApprove
      ? ("approved" as const)
      : ("pending" as const);
    await ctx.db.insert("roomInvitations", {
      ...invitation,
      status,
      autoApproved: mine.autoApprove,
    });
    return { status };
  },
});

async function pendingInvitation(
  ctx: MutationCtx,
  invitationId: Id<"roomInvitations">,
  party: "ownerTokenIdentifier" | "inviterTokenIdentifier",
) {
  const { tokenIdentifier } = await requireRoomIdentity(ctx);
  const row = await ctx.db.get("roomInvitations", invitationId);
  if (row?.[party] !== tokenIdentifier) {
    fail("NotFound", "that invitation is not yours");
  }
  if (row.status !== "pending") {
    fail("AlreadyAnswered", "that invitation is no longer pending");
  }
  return row;
}

// The agent's owner answers. Approving re-checks the friendship, so removing a friend also
// voids the invitations they left pending.
export const respond = mutation({
  args: { invitationId: v.id("roomInvitations"), approve: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { invitationId, approve }) => {
    const row = await pendingInvitation(
      ctx,
      invitationId,
      "ownerTokenIdentifier",
    );
    if (approve) {
      const owner = await friendship(
        ctx,
        row.inviterTokenIdentifier,
        row.ownerTokenIdentifier,
      );
      if (!owner) fail("NotFriend", "you are no longer friends");
      await join(ctx, row, owner.friendName);
    }
    await ctx.db.patch("roomInvitations", row._id, {
      status: approve ? "approved" : "denied",
    });
    return null;
  },
});

export const cancel = mutation({
  args: { invitationId: v.id("roomInvitations") },
  returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const row = await pendingInvitation(
      ctx,
      invitationId,
      "inviterTokenIdentifier",
    );
    await ctx.db.patch("roomInvitations", row._id, { status: "cancelled" });
    return null;
  },
});

const invitationView = {
  invitationId: v.id("roomInvitations"),
  sessionId: v.id("sessions"),
  agentId: v.id("agents"),
  agentName: v.string(),
  inviterName: v.string(),
};

async function view(ctx: Pick<QueryCtx, "db">, row: Doc<"roomInvitations">) {
  const agent = await ctx.db.get("agents", row.agentId);
  return {
    invitationId: row._id,
    sessionId: row.sessionId,
    agentId: row.agentId,
    agentName: agent?.name ?? "Agente eliminado",
    inviterName: row.inviterName,
  };
}

// What the signed-in user has to answer: requests for agents they own, with what the room is for.
export const inbox = query({
  args: {},
  returns: v.array(v.object({ ...invitationView, request: v.string() })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("roomInvitations")
      .withIndex("by_ownerTokenIdentifier_and_status", (q) =>
        q
          .eq("ownerTokenIdentifier", identity.tokenIdentifier)
          .eq("status", "pending"),
      )
      .take(PENDING_LIMIT);
    return Promise.all(
      rows.map(async (row) => {
        const session = await ctx.db.get("sessions", row.sessionId);
        return {
          ...(await view(ctx, row)),
          request: session?.intent.description ?? "",
        };
      }),
    );
  },
});

export const forRoom = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(v.object({ ...invitationView, mine: v.boolean() })),
  handler: async (ctx, { sessionId }) => {
    const viewer = await requireRoomHuman(ctx, sessionId);
    const rows = await pendingInRoom(ctx, sessionId);
    return Promise.all(
      rows.map(async (row) => ({
        ...(await view(ctx, row)),
        mine: row.inviterTokenIdentifier === viewer.tokenIdentifier,
      })),
    );
  },
});
