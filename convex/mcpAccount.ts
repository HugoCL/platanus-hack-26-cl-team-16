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
import {
  acceptFriendInvite,
  friendsOf,
  issueFriendInvite,
  pendingInviteExpiry,
} from "./friends";
import { callerCredential, chargeRequest } from "./mcpRooms";

// Account tools for external agents, called by the MCP server in lib/mcp.ts: who the calling agent
// is, its link to a human, and that human's friends. Like the room tools, each one takes the
// caller's API key and spends a token of the key's `mcpRequest` bucket first. The server turns the
// codes returned here into URLs on its public origin.

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
// manage. The name the agent passes is only the label the friend sees, as on the site.
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
  friends: { name: string; autoApprove: boolean; agentCount: number }[];
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
    const friends = await friendsOf(ctx, ownerTokenIdentifier);
    return {
      friends: friends.map(({ name, autoApprove, agents }) => ({
        name,
        autoApprove,
        agentCount: agents.length,
      })),
      inviteExpiresAt: await pendingInviteExpiry(ctx, ownerTokenIdentifier),
    };
  },
});

const nameArg = { ownerName: v.string() };

function label(name: string) {
  const trimmed = name.trim();
  if (!trimmed) fail("InvalidArgument", "ownerName must not be empty");
  return trimmed.slice(0, 120);
}

export const createFriendInvite = action({
  args: { ...keyArgs, ...nameArg },
  handler: async (ctx, args): Promise<Code> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runMutation(
      internal.mcpAccount.createFriendInviteAsCaller,
      args,
    );
  },
});

export const createFriendInviteAsCaller = internalMutation({
  args: { ...keyArgs, ...nameArg },
  handler: async (ctx, { apiKey, ownerName }): Promise<Code> => {
    const { ownerTokenIdentifier } = await callerOwner(ctx, apiKey);
    return issueFriendInvite(ctx, {
      tokenIdentifier: ownerTokenIdentifier,
      name: label(ownerName),
    });
  },
});

const acceptArgs = { ...keyArgs, ...nameArg, code: v.string() };

export const acceptFriendInviteForOwner = action({
  args: acceptArgs,
  handler: async (ctx, args): Promise<{ friendName: string }> => {
    await chargeRequest(ctx, args.apiKey);
    return ctx.runMutation(
      internal.mcpAccount.acceptFriendInviteAsCaller,
      args,
    );
  },
});

export const acceptFriendInviteAsCaller = internalMutation({
  args: acceptArgs,
  handler: async (
    ctx,
    { apiKey, ownerName, code },
  ): Promise<{ friendName: string }> => {
    const { ownerTokenIdentifier } = await callerOwner(ctx, apiKey);
    return {
      friendName: await acceptFriendInvite(
        ctx,
        { tokenIdentifier: ownerTokenIdentifier, name: label(ownerName) },
        code,
      ),
    };
  },
});
