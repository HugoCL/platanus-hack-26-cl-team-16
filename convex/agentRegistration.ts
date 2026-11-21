import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { AgentCard } from "../shared/agent";
import { EXTERNAL_AGENT_SLUG, SEED_AGENTS } from "../shared/seed-data";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { generateApiKey, sha256Hex, storeApiKey } from "./agentKeys";

export const SELF_REGISTERED_SCOPE = {
  allowedIntents: [],
  forbiddenTopics: [],
  dataItShares: [],
  dataItRequests: [],
};

const limiter = new RateLimiter(components.rateLimiter, {
  registrationIp: { kind: "token bucket", rate: 5, period: HOUR, capacity: 5 },
  registrationGlobal: {
    kind: "token bucket",
    rate: 60,
    period: HOUR,
    capacity: 60,
  },
});
const registrationArgs = {
  name: v.string(),
  description: v.string(),
  purpose: v.optional(v.string()),
  category: v.optional(v.string()),
  wantsPublic: v.optional(v.boolean()),
  clientIp: v.optional(v.string()),
};
const registered = v.object({
  agentId: v.id("agents"),
  slug: v.string(),
  apiKey: v.string(),
  linkCode: v.string(),
});
const summary = v.object({
  agentId: v.id("agents"),
  name: v.string(),
  description: v.string(),
  slug: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("active"),
    v.literal("prospect"),
  ),
});
const publicationFields = {
  purpose: v.string(),
  category: v.string(),
  description: v.optional(v.string()),
};

function fail(kind: string, message: string): never {
  throw new ConvexError({ kind, message });
}
function text(value: string, max: number) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max)
    fail("InvalidArgument", `text must contain 1–${max} characters`);
  return trimmed;
}
function searchText(
  card: Pick<Doc<"agents">, "name" | "description" | "purpose" | "categories">,
) {
  return [
    card.name,
    card.description,
    card.purpose,
    card.categories.join(" "),
  ].join(" ");
}
function toSummary(agent: Doc<"agents">) {
  return {
    agentId: agent._id,
    name: agent.name,
    description: agent.description,
    slug: agent.slug,
    status: agent.status,
  };
}

export const register = action({
  args: registrationArgs,
  returns: registered,
  handler: async (
    ctx,
    args,
  ): Promise<{
    agentId: Id<"agents">;
    slug: string;
    apiKey: string;
    linkCode: string;
  }> => {
    const name = text(args.name, 120);
    const description = text(args.description, 1000);
    const { apiKey, prefix } = generateApiKey();
    const linkCode = crypto.randomUUID() + crypto.randomUUID();
    const base =
      name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "agent";
    const slug = `${base}-${crypto.randomUUID()}`;
    const agentId = await ctx.runMutation(internal.agentRegistration.create, {
      ...args,
      name,
      description,
      slug,
      prefix,
      keyHash: await sha256Hex(apiKey),
      codeHash: await sha256Hex(linkCode),
    });
    return { agentId, slug, apiKey, linkCode };
  },
});

export const create = internalMutation({
  args: {
    ...registrationArgs,
    slug: v.string(),
    prefix: v.string(),
    keyHash: v.string(),
    codeHash: v.string(),
  },
  returns: v.id("agents"),
  handler: async (ctx, args) => {
    for (const [bucket, key] of [
      ["registrationIp", args.clientIp ?? "unknown"],
      ["registrationGlobal", "global"],
    ] as const) {
      const limit = await limiter.limit(ctx, bucket, { key });
      if (!limit.ok) fail("RateLimited", "registration quota exhausted");
    }
    if (
      await ctx.db
        .query("agents")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug))
        .unique()
    )
      fail("Conflict", "slug already exists; retry registration");
    const template = SEED_AGENTS.find(
      ({ card }) => card.slug === EXTERNAL_AGENT_SLUG,
    );
    if (!template) throw new Error("external agent template is missing");
    const category = args.category ?? template.card.categories[0];
    const categoryRow = await ctx.db
      .query("categories")
      .withIndex("by_slug", (q) => q.eq("slug", category))
      .unique();
    if (!categoryRow) fail("InvalidArgument", "unknown category");
    const card = AgentCard.parse({
      ...template.card,
      name: text(args.name, 120),
      description: text(args.description, 1000),
      purpose: text(args.purpose ?? args.description, 1000),
      categories: [category],
      scope: SELF_REGISTERED_SCOPE,
      verified: false,
      slug: args.slug,
      status: "draft",
    });
    const agentId = await ctx.db.insert("agents", {
      ...card,
      selfRegistered: true,
      wantsPublic: args.wantsPublic,
      primaryCategory: card.categories[0],
      searchText: searchText(card),
    });
    await storeApiKey(ctx, {
      slug: args.slug,
      keyHash: args.keyHash,
      prefix: args.prefix,
    });
    await ctx.db.insert("agentLinkCodes", {
      agentId,
      codeHash: args.codeHash,
      expiresAt: Date.now() + 24 * HOUR,
    });
    return agentId;
  },
});

async function codeRow(ctx: QueryCtx, code: string) {
  const codeHash = await sha256Hex(code);
  const row = await ctx.db
    .query("agentLinkCodes")
    .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
    .unique();
  return row;
}

export const linkInfo = query({
  args: { code: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...summary.fields,
      alreadyLinked: v.boolean(),
      linkedToCurrentUser: v.boolean(),
      purpose: v.string(),
      category: v.string(),
      wantsPublic: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, { code }) => {
    const row = await codeRow(ctx, code);
    const agent = row && (await ctx.db.get(row.agentId));
    if (!row || !agent) return null;
    const identity = await ctx.auth.getUserIdentity();
    const linkedToCurrentUser =
      !!identity && agent.ownerTokenIdentifier === identity.tokenIdentifier;
    if (row.expiresAt <= Date.now() && !linkedToCurrentUser) return null;
    if (row.usedAt !== undefined && !linkedToCurrentUser) return null;
    return {
      ...toSummary(agent),
      alreadyLinked: agent.ownerTokenIdentifier !== undefined,
      linkedToCurrentUser,
      purpose: agent.purpose,
      category: agent.primaryCategory,
      wantsPublic: agent.wantsPublic,
    };
  },
});

export const link = mutation({
  args: { code: v.string(), publish: v.optional(v.object(publicationFields)) },
  returns: v.null(),
  handler: async (ctx, { code, publish }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("Unauthorized", "sign in to link an agent");
    const row = await codeRow(ctx, code);
    const agent = row && (await ctx.db.get(row.agentId));
    if (!row || !agent || row.expiresAt <= Date.now())
      fail("InvalidArgument", "invalid or expired link code");
    if (
      agent.ownerTokenIdentifier &&
      agent.ownerTokenIdentifier !== identity.tokenIdentifier
    )
      fail("Forbidden", "agent belongs to another user");
    if (row.usedAt !== undefined)
      fail("InvalidArgument", "link code already used");
    await ctx.db.patch(agent._id, {
      ownerTokenIdentifier: identity.tokenIdentifier,
    });
    await ctx.db.patch(row._id, { usedAt: Date.now() });
    if (publish) await publishCard(ctx, { agentId: agent._id, ...publish });
    return null;
  },
});

async function owned(ctx: MutationCtx, agentId: Id<"agents">) {
  const identity = await ctx.auth.getUserIdentity();
  const agent = await ctx.db.get(agentId);
  if (
    !identity ||
    !agent ||
    agent.ownerTokenIdentifier !== identity.tokenIdentifier ||
    agent.kind !== "external" ||
    !agent.selfRegistered
  )
    fail(
      "Forbidden",
      "only the owner of a self-registered agent may change publication",
    );
  return agent;
}

async function publishCard(
  ctx: MutationCtx,
  args: {
    agentId: Id<"agents">;
    purpose: string;
    category: string;
    description?: string;
  },
) {
  const agent = await owned(ctx, args.agentId);
  const category = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", args.category))
    .unique();
  if (!category) fail("InvalidArgument", "unknown category");
  const updates = {
    purpose: text(args.purpose, 1000),
    description:
      args.description === undefined
        ? agent.description
        : text(args.description, 1000),
    categories: [category.slug],
    primaryCategory: category.slug,
    scope: SELF_REGISTERED_SCOPE,
    verified: false,
    capabilities: agent.capabilities.includes("info")
      ? agent.capabilities
      : [...agent.capabilities, "info" as const],
    status: "active" as const,
  };
  await ctx.db.patch(agent._id, {
    ...updates,
    searchText: searchText({ ...agent, ...updates }),
    embedding: undefined,
  });
  return null;
}

export const publish = mutation({
  args: { agentId: v.id("agents"), ...publicationFields },
  returns: v.null(),
  handler: publishCard,
});

export const unpublish = mutation({
  args: { agentId: v.id("agents") },
  returns: v.null(),
  handler: async (ctx, { agentId }) => {
    await owned(ctx, agentId);
    await ctx.db.patch(agentId, { status: "draft" });
    return null;
  },
});

export const mine = query({
  args: {},
  returns: v.array(summary),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
      )
      .take(100);
    return agents.filter((agent) => agent.kind === "external").map(toSummary);
  },
});
