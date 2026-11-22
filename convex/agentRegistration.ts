import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { AgentCard } from "../shared/agent";
import { EXTERNAL_AGENT_SLUG, SEED_AGENTS } from "../shared/seed-data";
import { SessionStatus } from "../shared/session";
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
import { publishNotice } from "./gate";

const LINK_TTL_MS = 24 * HOUR;

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

async function requireRegistrationSecret(secret: string | undefined) {
  const expected = process.env.AGENT_REGISTRATION_SECRET;
  if (!expected) {
    console.warn(
      "AGENT_REGISTRATION_SECRET is not set; registration is unprotected.",
    );
    return;
  }
  // Native MAC verification avoids a timing-sensitive JavaScript comparison.
  const key = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(expected),
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(secret ?? ""),
    ))
  )
    fail("Unauthorized", "registration requires the server credential");
}

export const register = action({
  args: { ...registrationArgs, secret: v.optional(v.string()) },
  returns: registered,
  handler: async (
    ctx,
    { secret, ...args },
  ): Promise<{
    agentId: Id<"agents">;
    slug: string;
    apiKey: string;
    linkCode: string;
  }> => {
    await requireRegistrationSecret(secret);
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

// The draft card every self-registered agent starts from: the seed's external agent with an empty
// scope. `ownerTokenIdentifier` links it at once, for an owner who is already known.
export async function insertSelfRegistered(
  ctx: MutationCtx,
  args: {
    name: string;
    description: string;
    slug: string;
    purpose?: string;
    category?: string;
    wantsPublic?: boolean;
    ownerTokenIdentifier?: string;
  },
) {
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
    ownerTokenIdentifier: args.ownerTokenIdentifier,
    primaryCategory: card.categories[0],
    searchText: searchText(card),
  });
  return agentId;
}

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
    const agentId = await insertSelfRegistered(ctx, args);
    await storeApiKey(ctx, {
      slug: args.slug,
      keyHash: args.keyHash,
      prefix: args.prefix,
    });
    await insertLinkCode(ctx, agentId, args.codeHash);
    return agentId;
  },
});

// An agent has one link code at a time: a new one replaces the previous one, so a link that leaked
// stops working once the agent asks for another.
async function insertLinkCode(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  codeHash: string,
) {
  for (const row of await ctx.db
    .query("agentLinkCodes")
    .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
    .take(10)) {
    await ctx.db.delete("agentLinkCodes", row._id);
  }
  const expiresAt = Date.now() + LINK_TTL_MS;
  await ctx.db.insert("agentLinkCodes", { agentId, codeHash, expiresAt });
  return expiresAt;
}

// A new link code for an agent that has no human yet, for when the one from registration expired
// or was lost.
export async function renewLinkCode(ctx: MutationCtx, agent: Doc<"agents">) {
  if (agent.ownerTokenIdentifier) {
    fail("AlreadyLinked", "you are already linked to a human");
  }
  const code = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = await insertLinkCode(ctx, agent._id, await sha256Hex(code));
  return { code, expiresAt };
}

// When the agent's link is still waiting for its human: an unused code that has not expired.
export async function pendingLinkExpiry(
  ctx: Pick<QueryCtx, "db">,
  agentId: Id<"agents">,
) {
  const rows = await ctx.db
    .query("agentLinkCodes")
    .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
    .take(10);
  const now = Date.now();
  return (
    rows.find((row) => row.usedAt === undefined && row.expiresAt > now)
      ?.expiresAt ?? null
  );
}

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
      expiresAt: v.number(),
      usedAt: v.optional(v.number()),
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
    if (row.usedAt !== undefined && !linkedToCurrentUser) return null;
    return {
      ...toSummary(agent),
      alreadyLinked: agent.ownerTokenIdentifier !== undefined,
      linkedToCurrentUser,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
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
    const displayName = (
      identity.name?.trim() ||
      identity.givenName?.trim() ||
      "Tú"
    ).slice(0, 120);
    for await (const session of ctx.db
      .query("sessions")
      .withIndex("by_initiatorAgentId_and_status", (q) =>
        q.eq("initiatorAgentId", agent._id),
      )) {
      const participants = await ctx.db
        .query("participants")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .take(10);
      if (participants.some((p) => p.kind === "human" && p.role === "owner"))
        continue;
      const human = participants.find(
        (p) =>
          p.kind === "human" && p.tokenIdentifier === identity.tokenIdentifier,
      );
      const ownership = {
        role: "owner" as const,
        onBehalfOfAgentId: agent._id,
        displayName,
      };
      if (human)
        await ctx.db.patch(human._id, { ...ownership, leftAt: undefined });
      else
        await ctx.db.insert("participants", {
          sessionId: session._id,
          kind: "human",
          tokenIdentifier: identity.tokenIdentifier,
          ...ownership,
        });
    }
    if (publish) await publishCard(ctx, { agentId: agent._id, ...publish });
    return null;
  },
});

const RETIRE_BATCH = 100;

// Takes a linked agent away from its human for good, for an assistant that no longer exists: its
// keys stop working, its pending invitations are cancelled, the rooms it opened are closed, and
// it is no longer anyone's. The card and the closed rooms stay, so their history still reads.
export async function retireAgent(ctx: MutationCtx, agent: Doc<"agents">) {
  const keys = await ctx.db
    .query("agentApiKeys")
    .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
    .take(RETIRE_BATCH);
  for (const key of keys) {
    if (key.revokedAt === undefined)
      await ctx.db.patch("agentApiKeys", key._id, { revokedAt: Date.now() });
  }
  const codes = await ctx.db
    .query("agentLinkCodes")
    .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
    .take(RETIRE_BATCH);
  for (const code of codes) await ctx.db.delete("agentLinkCodes", code._id);
  const invitations = await ctx.db
    .query("roomInvitations")
    .withIndex("by_agentId_and_status", (q) =>
      q.eq("agentId", agent._id).eq("status", "pending"),
    )
    .take(RETIRE_BATCH);
  for (const invitation of invitations) {
    await ctx.db.patch("roomInvitations", invitation._id, {
      status: "cancelled",
    });
  }
  const rooms = await ctx.db
    .query("sessions")
    .withIndex("by_initiatorAgentId_and_status", (q) =>
      q.eq("initiatorAgentId", agent._id).eq("status", "active"),
    )
    .take(RETIRE_BATCH);
  for (const room of rooms) {
    await ctx.db.patch("sessions", room._id, {
      status: "closed",
      closedReason: "agent_removed",
    });
    await publishNotice(
      ctx,
      room._id,
      "session_closed",
      "Sala cerrada: el agente que la abrió ya no existe.",
    );
  }
  await ctx.db.patch("agents", agent._id, {
    ownerTokenIdentifier: undefined,
    status: "draft",
  });
}

async function owned(
  ctx: Pick<QueryCtx, "auth" | "db">,
  agentId: Id<"agents">,
) {
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

export const rooms = query({
  args: { agentId: v.id("agents"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      sessionId: v.id("sessions"),
      description: v.string(),
      status: zodToConvex(SessionStatus),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { agentId, paginationOpts }) => {
    await owned(ctx, agentId);
    const result = await ctx.db
      .query("sessions")
      .withIndex("by_initiatorAgentId", (q) =>
        q.eq("initiatorAgentId", agentId),
      )
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map((session) => ({
        sessionId: session._id,
        description: session.intent.description,
        status: session.status,
        createdAt: session._creationTime,
      })),
    };
  },
});

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
