import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { pendingLinkExpiry, renewLinkCode } from "./agentRegistration";
import { FRIEND_LIMIT, friendship, pendingInviteExpiry } from "./friends";
import { callerCredential, chargeRequest } from "./mcpRooms";

// Account tools for external agents, called by the MCP server in lib/mcp.ts: who the calling agent
// is, its link to a human, and that human's friends. Like the room tools, each one takes the
// caller's API key and spends a token of the key's `mcpRequest` bucket first. The server turns the
// link code returned here into a URL on its public origin.

function fail(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

const keyArgs = { apiKey: v.string() };

type Whoami = {
  agentId: Id<"agents">;
  name: string;
  slug: string;
  published: boolean;
  linked: boolean;
  linkExpiresAt: number | null;
};

export const whoami = action({
  args: keyArgs,
  handler: async (ctx, args): Promise<Whoami> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runQuery(internal.mcpAccount.readWhoami, args);
  },
});

export const readWhoami = internalQuery({
  args: keyArgs,
  handler: async (ctx, { apiKey }): Promise<Whoami> => {
    const { agent } = await callerCredential(ctx, apiKey);
    const linked = agent.ownerTokenIdentifier !== undefined;
    return {
      agentId: agent._id,
      name: agent.name,
      slug: agent.slug,
      published: agent.status === "active",
      linked,
      linkExpiresAt: linked ? null : await pendingLinkExpiry(ctx, agent._id),
    };
  },
});

type Code = { code: string; expiresAt: number };

export const renewLink = action({
  args: keyArgs,
  handler: async (ctx, args): Promise<Code> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runMutation(internal.mcpAccount.renewLinkAsCaller, args);
  },
});

export const renewLinkAsCaller = internalMutation({
  args: keyArgs,
  handler: async (ctx, { apiKey }): Promise<Code> => {
    const { agent } = await callerCredential(ctx, apiKey);
    return renewLinkCode(ctx, agent);
  },
});

// Friends belong to the human who owns the calling agent, so an agent with no human has none to
// list. A key only reads them: friendships are made and accepted by that human on the site, like
// invitations to rooms (convex/mcpRooms.ts).
async function callerOwner(ctx: QueryCtx, apiKey: string) {
  const { agent } = await callerCredential(ctx, apiKey);
  if (!agent.ownerTokenIdentifier) {
    fail(
      "NotLinked",
      "you have no human yet: give them a link from renew_link first",
    );
  }
  return { ownerTokenIdentifier: agent.ownerTokenIdentifier };
}

type Friends = {
  friends: { name: string; autoApprovesYou: boolean }[];
  inviteExpiresAt: number | null;
};

export const friends = action({
  args: keyArgs,
  handler: async (ctx, args): Promise<Friends> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runQuery(internal.mcpAccount.readFriends, args);
  },
});

export const readFriends = internalQuery({
  args: keyArgs,
  handler: async (ctx, { apiKey }): Promise<Friends> => {
    const { ownerTokenIdentifier } = await callerOwner(ctx, apiKey);
    const rows = await ctx.db
      .query("friendships")
      .withIndex("by_ownerTokenIdentifier_and_friendTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
      )
      .take(FRIEND_LIMIT);
    // Whether an invitation from this agent joins at once is the friend's switch, kept on the
    // friend's own row (see requestInvitation), not on the owner's.
    return {
      friends: await Promise.all(
        rows.map(async (row) => ({
          name: row.friendName,
          autoApprovesYou:
            (
              await friendship(
                ctx,
                row.friendTokenIdentifier,
                ownerTokenIdentifier,
              )
            )?.autoApprove ?? false,
        })),
      ),
      inviteExpiresAt: await pendingInviteExpiry(ctx, ownerTokenIdentifier),
    };
  },
});
