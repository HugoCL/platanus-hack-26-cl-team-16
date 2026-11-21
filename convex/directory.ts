import { ConvexError, v } from "convex/values";
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
export const MAX_LIMIT = 20;

function checkLimit(limit: number | undefined) {
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
  ) {
    throw new ConvexError({
      kind: "InvalidArgument",
      message: `limit must be an integer from 1 to ${MAX_LIMIT}`,
    });
  }
}

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

export async function toDirectoryCard(
  ctx: QueryCtx,
  agent: Doc<"agents">,
): Promise<DirectoryCard> {
  const entity = agent.entityId ? await ctx.db.get(agent.entityId) : null;
  return {
    agentId: agent._id,
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
    entityName: entity?.name,
    comuna: agent.location?.comuna,
    allowedIntents: effectiveAllowedIntents(agent),
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
    checkLimit(args.limit);
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
    if ((agentId === undefined) === (slug === undefined)) {
      throw new ConvexError({
        kind: "InvalidArgument",
        message: "pass exactly one of agentId or slug",
      });
    }
    const agent = agentId
      ? await ctx.db.get(agentId)
      : await ctx.db
          .query("agents")
          .withIndex("by_slug", (q) => q.eq("slug", slug as string))
          .unique();
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
    checkLimit(limit);
    const categories: Category[] = await ctx.runQuery(
      api.directory.categories,
      {},
    );
    const interpretation = await interpretDirectoryText(query, categories, () =>
      createLlmProvider(),
    );
    if (
      interpretation.unresolved.length > 0 ||
      (!interpretation.category && !interpretation.comuna)
    ) {
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
