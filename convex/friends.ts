import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { sha256Hex } from "./agentKeys";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FRIEND_LIMIT = 100;
const AGENTS_PER_FRIEND = 20;

function fail(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

// The team's Clerk session token carries no name claim, so the client sends the name to show.
// It is only a label for the friend who shares or opens the link: nothing is authorized by it.
const displayNameArg = { displayName: v.optional(v.string()) };

async function requireUser(ctx: Pick<QueryCtx, "auth">, displayName?: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("Unauthorized", "sign in to manage your friends");
  return {
    tokenIdentifier: identity.tokenIdentifier,
    name: (
      identity.name?.trim() ||
      identity.givenName?.trim() ||
      displayName?.trim() ||
      "Sin nombre"
    ).slice(0, 120),
  };
}

export function friendship(
  ctx: Pick<QueryCtx, "db">,
  ownerTokenIdentifier: string,
  friendTokenIdentifier: string,
) {
  return ctx.db
    .query("friendships")
    .withIndex("by_ownerTokenIdentifier_and_friendTokenIdentifier", (q) =>
      q
        .eq("ownerTokenIdentifier", ownerTokenIdentifier)
        .eq("friendTokenIdentifier", friendTokenIdentifier),
    )
    .unique();
}

async function inviteRow(ctx: Pick<QueryCtx, "db">, code: string) {
  const codeHash = await sha256Hex(code);
  return ctx.db
    .query("friendInvites")
    .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
    .unique();
}

// A user has one link at a time: a new one replaces the previous one, used or not.
export const createInvite = mutation({
  args: displayNameArg,
  returns: v.object({ code: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { displayName }) => {
    const user = await requireUser(ctx, displayName);
    const previous = await ctx.db
      .query("friendInvites")
      .withIndex("by_inviterTokenIdentifier", (q) =>
        q.eq("inviterTokenIdentifier", user.tokenIdentifier),
      )
      .take(10);
    for (const row of previous) await ctx.db.delete("friendInvites", row._id);
    const code = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    await ctx.db.insert("friendInvites", {
      codeHash: await sha256Hex(code),
      inviterTokenIdentifier: user.tokenIdentifier,
      inviterName: user.name,
      expiresAt,
    });
    return { code, expiresAt };
  },
});

// When the user's friend link is still waiting to be opened: unused and not expired.
export async function pendingInviteExpiry(
  ctx: Pick<QueryCtx, "db">,
  tokenIdentifier: string,
) {
  const rows = await ctx.db
    .query("friendInvites")
    .withIndex("by_inviterTokenIdentifier", (q) =>
      q.eq("inviterTokenIdentifier", tokenIdentifier),
    )
    .take(10);
  const now = Date.now();
  return (
    rows.find((row) => row.usedAt === undefined && row.expiresAt > now)
      ?.expiresAt ?? null
  );
}

export const inviteInfo = query({
  args: { code: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      inviterName: v.string(),
      expiresAt: v.number(),
      used: v.boolean(),
      own: v.boolean(),
      alreadyFriends: v.boolean(),
    }),
  ),
  handler: async (ctx, { code }) => {
    const row = await inviteRow(ctx, code);
    if (!row) return null;
    const identity = await ctx.auth.getUserIdentity();
    const own = identity?.tokenIdentifier === row.inviterTokenIdentifier;
    return {
      inviterName: row.inviterName,
      expiresAt: row.expiresAt,
      used: row.usedAt !== undefined,
      own,
      alreadyFriends:
        !!identity &&
        !own &&
        !!(await friendship(
          ctx,
          identity.tokenIdentifier,
          row.inviterTokenIdentifier,
        )),
    };
  },
});

async function befriend(
  ctx: MutationCtx,
  owner: string,
  friend: { tokenIdentifier: string; name: string },
) {
  if (await friendship(ctx, owner, friend.tokenIdentifier)) return;
  const count = await ctx.db
    .query("friendships")
    .withIndex("by_ownerTokenIdentifier_and_friendTokenIdentifier", (q) =>
      q.eq("ownerTokenIdentifier", owner),
    )
    .take(FRIEND_LIMIT);
  if (count.length >= FRIEND_LIMIT) {
    fail("FriendLimit", `an account can have at most ${FRIEND_LIMIT} friends`);
  }
  await ctx.db.insert("friendships", {
    ownerTokenIdentifier: owner,
    friendTokenIdentifier: friend.tokenIdentifier,
    friendName: friend.name,
    autoApprove: false,
  });
}

export const acceptInvite = mutation({
  args: { code: v.string(), ...displayNameArg },
  returns: v.null(),
  handler: async (ctx, { code, displayName }) => {
    const user = await requireUser(ctx, displayName);
    const row = await inviteRow(ctx, code);
    if (!row || row.usedAt !== undefined || row.expiresAt <= Date.now()) {
      fail("InvalidArgument", "invalid, used or expired friend link");
    }
    if (row.inviterTokenIdentifier === user.tokenIdentifier) {
      fail("InvalidArgument", "you cannot accept your own friend link");
    }
    await befriend(ctx, user.tokenIdentifier, {
      tokenIdentifier: row.inviterTokenIdentifier,
      name: row.inviterName,
    });
    await befriend(ctx, row.inviterTokenIdentifier, {
      tokenIdentifier: user.tokenIdentifier,
      name: user.name,
    });
    await ctx.db.patch("friendInvites", row._id, { usedAt: Date.now() });
    return null;
  },
});

// The agents a friend owns, published or not: the friend approves each invocation (or turns on
// auto-approve), so being listed here grants nothing by itself.
export async function friendAgents(
  ctx: Pick<QueryCtx, "db">,
  friendTokenIdentifier: string,
): Promise<Doc<"agents">[]> {
  return ctx.db
    .query("agents")
    .withIndex("by_ownerTokenIdentifier", (q) =>
      q.eq("ownerTokenIdentifier", friendTokenIdentifier),
    )
    .take(AGENTS_PER_FRIEND);
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      friendshipId: v.id("friendships"),
      name: v.string(),
      autoApprove: v.boolean(),
      agents: v.array(
        v.object({
          agentId: v.id("agents"),
          name: v.string(),
          description: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return identity ? friendsOf(ctx, identity.tokenIdentifier) : [];
  },
});

export async function friendsOf(
  ctx: Pick<QueryCtx, "db">,
  ownerTokenIdentifier: string,
) {
  const rows = await ctx.db
    .query("friendships")
    .withIndex("by_ownerTokenIdentifier_and_friendTokenIdentifier", (q) =>
      q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
    )
    .take(FRIEND_LIMIT);
  return Promise.all(
    rows.map(async (row) => ({
      friendshipId: row._id,
      name: row.friendName,
      autoApprove: row.autoApprove,
      agents: (await friendAgents(ctx, row.friendTokenIdentifier)).map(
        (agent) => ({
          agentId: agent._id,
          name: agent.name,
          description: agent.description,
        }),
      ),
    })),
  );
}

async function ownFriendship(
  ctx: MutationCtx,
  friendshipId: Doc<"friendships">["_id"],
) {
  const user = await requireUser(ctx);
  const row = await ctx.db.get("friendships", friendshipId);
  if (row?.ownerTokenIdentifier !== user.tokenIdentifier) {
    fail("NotFound", "that friend is not in your list");
  }
  return row;
}

export const setAutoApprove = mutation({
  args: { friendshipId: v.id("friendships"), autoApprove: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { friendshipId, autoApprove }) => {
    const row = await ownFriendship(ctx, friendshipId);
    await ctx.db.patch("friendships", row._id, { autoApprove });
    return null;
  },
});

// Ends the friendship for both sides.
export const remove = mutation({
  args: { friendshipId: v.id("friendships") },
  returns: v.null(),
  handler: async (ctx, { friendshipId }) => {
    const row = await ownFriendship(ctx, friendshipId);
    const mirror = await friendship(
      ctx,
      row.friendTokenIdentifier,
      row.ownerTokenIdentifier,
    );
    await ctx.db.delete("friendships", row._id);
    if (mirror) await ctx.db.delete("friendships", mirror._id);
    return null;
  },
});
