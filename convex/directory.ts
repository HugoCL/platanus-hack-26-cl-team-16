import { v } from "convex/values";
import {
  canonicalComuna,
  categoryWithDescendants,
  interpretDirectoryText,
  resolveCategory,
  type TextInterpretation,
} from "../lib/directory";
import { effectiveAllowedIntents } from "../shared/agent";
import type { Category } from "../shared/catalog";
import type { AgentDetail, AgentSummary } from "../shared/mcp";
import { createLlmProvider } from "../shared/providers/llm";
import type { AgentStatus } from "../shared/scope";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, type QueryCtx, query } from "./_generated/server";

export type DirectoryCard = AgentDetail &
  Pick<AgentSummary, "comuna" | "allowedIntents">;

const LISTED_STATUSES: AgentStatus[] = ["active", "prospect"];
const SCAN_LIMIT = 500;

async function loadCategories(ctx: QueryCtx): Promise<Category[]> {
  const rows = await ctx.db.query("categories").take(SCAN_LIMIT);
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

async function toDirectoryCard(
  ctx: QueryCtx,
  agent: Doc<"agents">,
): Promise<DirectoryCard> {
  const {
    _id,
    _creationTime,
    entityId,
    ownerTokenIdentifier,
    primaryCategory,
    searchText,
    embedding,
    ...card
  } = agent;
  const entity = entityId ? await ctx.db.get(entityId) : null;
  return {
    ...card,
    agentId: _id,
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
  handler: async (ctx, args): Promise<DirectoryCard[]> => {
    const categories = await loadCategories(ctx);
    let wanted: Set<string> | undefined;
    if (args.category !== undefined) {
      const category = resolveCategory(args.category, categories);
      if (!category) return [];
      wanted = categoryWithDescendants(category.slug, categories);
    }
    let comuna: string | undefined;
    if (args.comuna !== undefined) {
      const canonical = canonicalComuna(args.comuna);
      if (!canonical) return [];
      comuna = canonical;
    }

    const rows = await Promise.all(
      LISTED_STATUSES.map((status) =>
        comuna
          ? ctx.db
              .query("agents")
              .withIndex("by_status_and_location_comuna", (q) =>
                q.eq("status", status).eq("location.comuna", comuna),
              )
              .take(SCAN_LIMIT)
          : ctx.db
              .query("agents")
              .withIndex("by_status_and_primaryCategory", (q) =>
                q.eq("status", status),
              )
              .take(SCAN_LIMIT),
      ),
    );
    const matches = rows
      .flat()
      .filter((agent) => !wanted || agent.categories.some((c) => wanted.has(c)))
      .sort(rank)
      .slice(0, args.limit);
    return Promise.all(matches.map((agent) => toDirectoryCard(ctx, agent)));
  },
});

export const get = query({
  args: {
    agentId: v.optional(v.id("agents")),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, { agentId, slug }): Promise<DirectoryCard | null> => {
    const agent = agentId
      ? await ctx.db.get(agentId)
      : slug
        ? await ctx.db
            .query("agents")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .unique()
        : null;
    if (!agent || !LISTED_STATUSES.includes(agent.status)) return null;
    return toDirectoryCard(ctx, agent);
  },
});

export const searchText = action({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    { query, limit },
  ): Promise<{
    interpretation: TextInterpretation;
    agents: DirectoryCard[];
  }> => {
    const categories: Category[] = await ctx.runQuery(
      api.directory.categories,
      {},
    );
    const interpretation = await interpretDirectoryText(
      query,
      categories,
      createLlmProvider(),
    );
    if (!interpretation.category && !interpretation.comuna) {
      return { interpretation, agents: [] };
    }
    const agents: DirectoryCard[] = await ctx.runQuery(api.directory.search, {
      category: interpretation.category ?? undefined,
      comuna: interpretation.comuna ?? undefined,
      limit,
    });
    return { interpretation, agents };
  },
});
