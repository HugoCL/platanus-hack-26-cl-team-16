import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type QueryCtx,
  query,
} from "./_generated/server";

// API keys for agents that connect from outside, through the MCP server in app/api/mcp.
// `issue` shows a key in clear once; only its SHA-256 hash and a short visible prefix are stored.
// The caller's identity always comes from the key, through `agentForApiKey`: no public function
// takes an agentId as the caller. A key works while it is not revoked and its agent is active.

const KEY_PREFIX = "dak_";
const VISIBLE_PREFIX_LENGTH = 12;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toHex(new Uint8Array(digest));
}

export async function agentForApiKey(
  ctx: Pick<QueryCtx, "db">,
  apiKey: string,
): Promise<Doc<"agents"> | null> {
  const keyHash = await sha256Hex(apiKey);
  const key = await ctx.db
    .query("agentApiKeys")
    .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
    .unique();
  if (!key || key.revokedAt !== undefined) return null;
  const agent = await ctx.db.get(key.agentId);
  return agent?.status === "active" ? agent : null;
}

export const authenticate = query({
  args: { apiKey: v.string() },
  returns: v.union(v.id("agents"), v.null()),
  handler: async (ctx, { apiKey }) =>
    (await agentForApiKey(ctx, apiKey))?._id ?? null,
});

// `pnpm mcp:key '{"slug":"mi-agente-juan"}'`. An action, so the key comes from real randomness
// rather than a mutation's seeded generator.
export const issue = internalAction({
  args: { slug: v.string(), label: v.optional(v.string()) },
  handler: async (
    ctx,
    { slug, label },
  ): Promise<{ apiKey: string; prefix: string; agentId: Id<"agents"> }> => {
    const apiKey =
      KEY_PREFIX + toHex(crypto.getRandomValues(new Uint8Array(32)));
    const prefix = apiKey.slice(0, VISIBLE_PREFIX_LENGTH);
    const agentId: Id<"agents"> = await ctx.runMutation(
      internal.agentKeys.store,
      { slug, keyHash: await sha256Hex(apiKey), prefix, label },
    );
    return { apiKey, prefix, agentId };
  },
});

export const store = internalMutation({
  args: {
    slug: v.string(),
    keyHash: v.string(),
    prefix: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, { slug, ...key }): Promise<Id<"agents">> => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!agent) {
      throw new ConvexError({
        kind: "NotFound",
        message: `no agent with slug ${slug}`,
      });
    }
    await ctx.db.insert("agentApiKeys", { agentId: agent._id, ...key });
    return agent._id;
  },
});
