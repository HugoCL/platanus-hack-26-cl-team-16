import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import {
  canonicalComuna,
  categoryWithDescendants,
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

const LISTED_STATUSES: AgentStatus[] = ["active", "prospect"];
const CATEGORY_LIMIT = 200;
export const SCAN_BUDGET = 1000;
export const MAX_LIMIT = 20;

const rateLimiter = new RateLimiter(components.rateLimiter, {
  directoryTextLlm: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 10,
  },
});

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

function rank(a: Doc<"agents">, b: Doc<"agents">) {
  return (
    Number(b.verified) - Number(a.verified) ||
    Number(b.status === "active") - Number(a.status === "active") ||
    a.name.localeCompare(b.name, "es")
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

function isListed(agent: Doc<"agents">) {
  return (
    LISTED_STATUSES.includes(agent.status) &&
    AgentCard.safeParse(cardFields(agent)).success
  );
}

export async function toDirectoryCard(
  ctx: QueryCtx,
  agent: Doc<"agents">,
): Promise<DirectoryCard> {
  const card = cardFields(agent);
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
    const none = { agents: [], truncated: false };
    const categories = await loadCategories(ctx);
    let wanted: Set<string> | undefined;
    if (args.category !== undefined) {
      const category = resolveCategory(args.category, categories);
      if (!category) return none;
      wanted = categoryWithDescendants(category.slug, categories);
    }
    let comuna: string | undefined;
    if (args.comuna !== undefined) {
      const canonical = canonicalComuna(args.comuna);
      if (!canonical) return none;
      comuna = canonical;
    }

    const matches: Doc<"agents">[] = [];
    let scanned = 0;
    let truncated = false;
    for (const status of LISTED_STATUSES) {
      if (truncated) break;
      const rows = comuna
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
      for await (const agent of rows) {
        if (scanned === SCAN_BUDGET) {
          truncated = true;
          break;
        }
        scanned += 1;
        if (wanted && !agent.categories.some((c) => wanted.has(c))) continue;
        if (isListed(agent)) matches.push(agent);
      }
    }
    const agents = await Promise.all(
      matches
        .sort(rank)
        .slice(0, args.limit)
        .map((agent) => toDirectoryCard(ctx, agent)),
    );
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
    if (!agent || !isListed(agent)) return null;
    return toDirectoryCard(ctx, agent);
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
    const interpretation = await interpretDirectoryText(
      query,
      categories,
      async () => {
        await rateLimiter.limit(ctx, "directoryTextLlm", { throws: true });
        return createLlmProvider();
      },
    );
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
