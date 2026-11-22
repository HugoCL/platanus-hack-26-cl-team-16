import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { isApiKeyFormat, sha256Hex, storeApiKey } from "./agentKeys";
import { insertSelfRegistered } from "./agentRegistration";
import authConfig from "./auth.config";

// MCP clients that sign in with OAuth (Claude, ChatGPT and other general assistants) carry a Clerk
// access token for a person, while every room function wants an agent's API key. The MCP route
// verifies the token and calls `credential` with the server secret it shares with this deployment;
// the answer is the key of that person's own agent, which is created on first use. The key is
// derived from the secret and the user, so it is never stored in clear and is the same every time
// until the secret changes.

const OAUTH_LABEL = "oauth";

function fail(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}

export const credential = mutation({
  args: { secret: v.string(), userId: v.string() },
  returns: v.object({ apiKey: v.string() }),
  handler: async (ctx, { secret, userId }) => {
    const expected = process.env.MCP_OAUTH_SECRET;
    // Comparing digests keeps the comparison from depending on how much of the secret matches.
    if (!expected || (await sha256Hex(expected)) !== (await sha256Hex(secret)))
      fail("Unauthorized", "OAuth sign-in requires the server credential");
    if (!/^user_\w{1,64}$/.test(userId))
      fail("InvalidArgument", "not a Clerk user id");

    const apiKey = `dak_${await sha256Hex(`${expected}:mcp-oauth:${userId}`)}`;
    if (!isApiKeyFormat(apiKey)) throw new Error("derived key is malformed");
    const keyHash = await sha256Hex(apiKey);
    const key = await ctx.db
      .query("agentApiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
      .unique();
    if (key) return { apiKey };

    // The agent is found by the user, not by the key, so a rotated secret gives the same agent a
    // new key instead of leaving its rooms behind with an agent nobody can reach.
    const slug = `agente-personal-${(await sha256Hex(`mcp-oauth:${userId}`)).slice(0, 24)}`;
    // The same identifier Convex gives this person when they sign in to the app.
    const owner = `${authConfig.providers[0].domain}|${userId}`;
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!agent) {
      await insertSelfRegistered(ctx, {
        slug,
        name: "Mi agente personal",
        description:
          "Agente personal conectado por MCP con la cuenta de su dueño.",
        ownerTokenIdentifier: owner,
      });
    } else {
      if (agent.ownerTokenIdentifier !== owner)
        fail("Conflict", "that agent belongs to someone else");
      const keys = await ctx.db
        .query("agentApiKeys")
        .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
        .collect();
      for (const old of keys) {
        if (old.label === OAUTH_LABEL && old.revokedAt === undefined)
          await ctx.db.patch(old._id, { revokedAt: Date.now() });
      }
    }
    await storeApiKey(ctx, {
      slug,
      keyHash,
      prefix: apiKey.slice(0, 12),
      label: OAUTH_LABEL,
    });
    return { apiKey };
  },
});
