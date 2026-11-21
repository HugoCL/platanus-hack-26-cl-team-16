import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
} from "./_generated/server";

// API keys for agents that connect from outside, through the MCP server in app/api/mcp.
// `issue` shows a key in clear once; only its SHA-256 hash and a short visible prefix are stored.
// The caller's identity always comes from the key, through `agentForApiKey`: no public function
// takes an agentId as the caller. Keys are only for external agents: the platform speaks for hosted
// ones. A key works while it is not revoked and its agent is still active and external.

const KEY_PREFIX = "dak_";
const VISIBLE_PREFIX_LENGTH = 12;
const API_KEY_FORMAT = /^dak_[0-9a-f]{64}$/;
const LAST_USED_RESOLUTION_MS = MINUTE;

// Every MCP request spends one token of its key's bucket, so one client in a loop cannot use up
// the deployment for the rest. The endpoint spends it through `authenticate`, and every public
// function that takes a key (convex/mcpRooms.ts) spends it again, so calling Convex directly does
// not skip the quota.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  mcpRequest: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 60 },
});

export const isApiKeyFormat = (value: string) => API_KEY_FORMAT.test(value);

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
  return (await credentialForApiKey(ctx, apiKey))?.agent ?? null;
}

// Called again by the mutation that finally writes for an MCP caller (rooms.create and the gate's
// commit):
// moderation runs between the first check and that write, and a key revoked in between must not
// still open a room or send.
export async function requireLiveCredential(
  ctx: Pick<QueryCtx, "db">,
  keyId: Id<"agentApiKeys">,
  agentId: string,
) {
  const key = await ctx.db.get(keyId);
  const agent =
    key && key.revokedAt === undefined ? await ctx.db.get(key.agentId) : null;
  if (
    agent?._id !== agentId ||
    agent.status !== "active" ||
    agent.kind !== "external"
  ) {
    throw new ConvexError({
      kind: "Unauthorized",
      message: "the API key is not valid",
    });
  }
}

export async function credentialForApiKey(
  ctx: Pick<QueryCtx, "db">,
  apiKey: string,
): Promise<{ key: Doc<"agentApiKeys">; agent: Doc<"agents"> } | null> {
  if (!isApiKeyFormat(apiKey)) return null;
  const keyHash = await sha256Hex(apiKey);
  const key = await ctx.db
    .query("agentApiKeys")
    .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
    .unique();
  if (!key || key.revokedAt !== undefined) return null;
  const agent = await ctx.db.get(key.agentId);
  return agent?.status === "active" && agent.kind === "external"
    ? { key, agent }
    : null;
}

// Spends a token of the key's bucket and records when the key was last used, to the minute so a
// busy key does not write on every request.
export async function spendRequest(
  ctx: MutationCtx,
  key: Doc<"agentApiKeys">,
  { throws = false }: { throws?: boolean } = {},
) {
  const limit = await rateLimiter.limit(ctx, "mcpRequest", {
    key: key._id,
    throws,
  });
  if (!limit.ok) return limit;
  const now = Date.now();
  if (now - (key.lastUsedAt ?? 0) >= LAST_USED_RESOLUTION_MS) {
    await ctx.db.patch(key._id, { lastUsedAt: now });
  }
  return limit;
}

// Called once per MCP request: checks the key and spends a token of its bucket.
export const authenticate = mutation({
  args: { apiKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({ ok: v.literal(true), agentId: v.id("agents") }),
    v.object({ ok: v.literal(false), retryAfterMs: v.number() }),
  ),
  handler: async (ctx, { apiKey }) => {
    const credential = await credentialForApiKey(ctx, apiKey);
    if (!credential) return null;
    const { key, agent } = credential;
    const limit = await spendRequest(ctx, key);
    if (!limit.ok)
      return { ok: false as const, retryAfterMs: limit.retryAfter ?? 0 };
    return { ok: true as const, agentId: agent._id };
  },
});

// `pnpm mcp:revoke '{"slug":"asistente-externo-demo","prefix":"dak_1a2b3c4d"}'`, with the
// visible prefix that `issue` printed. Revoking twice keeps the first revocation time.
export const revoke = internalMutation({
  args: { slug: v.string(), prefix: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug, prefix }) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    const keys = agent
      ? await ctx.db
          .query("agentApiKeys")
          .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
          .collect()
      : [];
    const key = keys.find((row) => row.prefix === prefix);
    if (!key) {
      throw new ConvexError({
        kind: "NotFound",
        message: `no key ${prefix} for agent ${slug}`,
      });
    }
    if (key.revokedAt === undefined) {
      await ctx.db.patch(key._id, { revokedAt: Date.now() });
    }
    return null;
  },
});

// `pnpm mcp:key '{"slug":"asistente-externo-demo"}'`. An action, so the key comes from real randomness
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
    if (agent.status !== "active" || agent.kind !== "external") {
      throw new ConvexError({
        kind: "InvalidArgument",
        message: `agent ${slug} is ${agent.status} and ${agent.kind}: keys are only for active external agents`,
      });
    }
    await ctx.db.insert("agentApiKeys", { agentId: agent._id, ...key });
    return agent._id;
  },
});
