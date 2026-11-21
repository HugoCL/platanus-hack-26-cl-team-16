import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import {
  canonicalComuna,
  interpretDirectoryText,
  MAX_QUERY_LENGTH,
  resolveCategory,
  type TextInterpretation,
} from "../lib/directory";
import { AgentCard, effectiveAllowedIntents } from "../shared/agent";
import type { Category } from "../shared/catalog";
import type { AgentDetail, AgentSummary } from "../shared/mcp";
import { createLlmProvider } from "../shared/providers/llm";
import type { AgentStatus } from "../shared/scope";
import { api, components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, type QueryCtx, query } from "./_generated/server";

export type DirectoryCard = Omit<AgentDetail, "agentId"> &
  Pick<AgentSummary, "comuna" | "allowedIntents"> & { agentId: Id<"agents"> };

export type DirectorySearchResult = {
  agents: DirectoryCard[];
  truncated: boolean;
};

type ListedCard = { agent: Doc<"agents">; card: AgentCard };

const LISTED_STATUSES: AgentStatus[] = ["active", "prospect"];
export const CATEGORY_LIMIT = 200;
export const SCAN_ROW_BUDGET = 1000;
export const SCAN_BYTE_BUDGET = 8 * 1024 * 1024;
export const RESPONSE_BYTE_BUDGET = 4 * 1024 * 1024;
export const MAX_LIMIT = 20;

const rateLimiter = new RateLimiter(components.rateLimiter, {
  directoryTextLlm: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 10,
  },
});

const encoder = new TextEncoder();
const byteSize = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).length;

function invalidArgument(message: string): never {
  throw new ConvexError({ kind: "InvalidArgument", message });
}

function checkLimit(limit: number | undefined) {
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
  ) {
    invalidArgument(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
}

async function loadCategories(ctx: QueryCtx): Promise<Category[]> {
  const rows = await ctx.db.query("categories").take(CATEGORY_LIMIT);
  return rows.map(({ slug, parent, label, attributeSchema }) => ({
    slug,
    parent,
    label,
    attributeSchema,
  }));
}

async function resolveCategorySlugs(ctx: QueryCtx, input: string) {
  let complete = true;
  let root = await ctx.db
    .query("categories")
    .withIndex("by_slug", (q) => q.eq("slug", input))
    .unique();
  if (!root) {
    const page = await ctx.db.query("categories").take(CATEGORY_LIMIT + 1);
    complete = page.length <= CATEGORY_LIMIT;
    root = resolveCategory(input, page.slice(0, CATEGORY_LIMIT));
  }
  if (!root) return { slugs: null, complete };

  const slugs = new Set([root.slug]);
  const queue = [root.slug];
  for (let parent = queue.shift(); parent; parent = queue.shift()) {
    const children = await ctx.db
      .query("categories")
      .withIndex("by_parent", (q) => q.eq("parent", parent))
      .take(CATEGORY_LIMIT);
    if (children.length === CATEGORY_LIMIT) complete = false;
    for (const child of children) {
      if (slugs.size >= CATEGORY_LIMIT) {
        complete = false;
        break;
      }
      if (slugs.has(child.slug)) continue;
      slugs.add(child.slug);
      queue.push(child.slug);
    }
  }
  return { slugs, complete };
}

function rank(a: ListedCard, b: ListedCard) {
  return (
    Number(b.card.verified) - Number(a.card.verified) ||
    Number(b.card.status === "active") - Number(a.card.status === "active") ||
    a.card.name.localeCompare(b.card.name, "es")
  );
}

function cardFields(agent: Doc<"agents">): AgentCard {
  return {
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    purpose: agent.purpose,
    categories: agent.categories,
    capabilities: agent.capabilities,
    scope: agent.scope,
    location: agent.location,
    kind: agent.kind,
    endpoint: agent.endpoint,
    publicKey: agent.publicKey,
    status: agent.status,
    verified: agent.verified,
  };
}

export function listedCard(agent: Doc<"agents">): ListedCard | null {
  if (!LISTED_STATUSES.includes(agent.status)) return null;
  const parsed = AgentCard.safeParse(cardFields(agent));
  return parsed.success ? { agent, card: parsed.data } : null;
}

export async function toDirectoryCard(
  ctx: QueryCtx,
  { agent, card }: ListedCard,
): Promise<DirectoryCard> {
  const entity = agent.entityId ? await ctx.db.get(agent.entityId) : null;
  return {
    ...card,
    agentId: agent._id,
    entityName: entity?.name,
    comuna: card.location?.comuna,
    allowedIntents: effectiveAllowedIntents(card),
  };
}

export const categories = query({
  args: {},
  handler: (ctx) => loadCategories(ctx),
});

export const search = query({
  args: {
    category: v.optional(v.string()),
    comuna: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DirectorySearchResult> => {
    checkLimit(args.limit);
    const limit = args.limit ?? MAX_LIMIT;
    let truncated = false;

    let wanted: Set<string> | undefined;
    if (args.category !== undefined) {
      const resolved = await resolveCategorySlugs(ctx, args.category);
      truncated ||= !resolved.complete;
      if (!resolved.slugs) return { agents: [], truncated };
      wanted = resolved.slugs;
    }
    let comuna: string | undefined;
    if (args.comuna !== undefined) {
      const canonical = canonicalComuna(args.comuna);
      if (!canonical) return { agents: [], truncated };
      comuna = canonical;
    }

    const matches: ListedCard[] = [];
    let rows = 0;
    let bytes = 0;
    let scanStopped = false;
    for (const status of LISTED_STATUSES) {
      if (scanStopped) break;
      const range = comuna
        ? ctx.db
            .query("agents")
            .withIndex("by_status_and_location_comuna", (q) =>
              q.eq("status", status).eq("location.comuna", comuna),
            )
        : ctx.db
            .query("agents")
            .withIndex("by_status_and_primaryCategory", (q) =>
              q.eq("status", status),
            );
      for await (const agent of range) {
        if (rows === SCAN_ROW_BUDGET || bytes >= SCAN_BYTE_BUDGET) {
          scanStopped = true;
          break;
        }
        rows += 1;
        bytes += byteSize(agent);
        if (wanted && !agent.categories.some((c) => wanted.has(c))) continue;
        const listed = listedCard(agent);
        if (listed) matches.push(listed);
      }
    }
    truncated ||= scanStopped || matches.length > limit;

    const agents: DirectoryCard[] = [];
    let responseBytes = 0;
    for (const match of matches.sort(rank).slice(0, limit)) {
      const card = await toDirectoryCard(ctx, match);
      responseBytes += byteSize(card);
      if (responseBytes > RESPONSE_BYTE_BUDGET) {
        truncated = true;
        break;
      }
      agents.push(card);
    }
    return { agents, truncated };
  },
});

export const get = query({
  args: {
    agentId: v.optional(v.id("agents")),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, { agentId, slug }): Promise<DirectoryCard | null> => {
    if ((agentId === undefined) === (slug === undefined)) {
      invalidArgument("pass exactly one of agentId or slug");
    }
    const agent = agentId
      ? await ctx.db.get(agentId)
      : await ctx.db
          .query("agents")
          .withIndex("by_slug", (q) => q.eq("slug", slug as string))
          .unique();
    const listed = agent && listedCard(agent);
    return listed ? toDirectoryCard(ctx, listed) : null;
  },
});

export const searchText = action({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    { query, limit },
  ): Promise<
    DirectorySearchResult & { interpretation: TextInterpretation }
  > => {
    checkLimit(limit);
    if (query.length > MAX_QUERY_LENGTH) {
      invalidArgument(`query must be at most ${MAX_QUERY_LENGTH} characters`);
    }
    const categories: Category[] = await ctx.runQuery(
      api.directory.categories,
      {},
    );
    const interpretation = await interpretDirectoryText(query, categories, {
      acquire: async () => {
        await rateLimiter.limit(ctx, "directoryTextLlm", { throws: true });
      },
      createLlm: () => createLlmProvider(),
    });
    if (
      interpretation.unresolved.length > 0 ||
      (!interpretation.category && !interpretation.comuna)
    ) {
      return { interpretation, agents: [], truncated: false };
    }
    const result: DirectorySearchResult = await ctx.runQuery(
      api.directory.search,
      {
        category: interpretation.category ?? undefined,
        comuna: interpretation.comuna ?? undefined,
        limit,
      },
    );
    return { interpretation, ...result };
  },
});
