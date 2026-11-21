import { ConvexError, v } from "convex/values";
import { formatKnowledge } from "../lib/agent-knowledge";
import type { ProviderContext } from "../lib/agents/provider";
import { internalQuery } from "./_generated/server";
import { freeSlots } from "./bookings";

const OFFERING_LIMIT = 50;
const CATEGORY_LIMIT = 200;

// The provider agent's whole view of the world: its card, its active offerings and their free
// slots that start after `now`. It reads no messages, bookings or people from any room, so
// whatever reaches the agent, it has nobody else's data to give away (E8 criterion 4).
export const context = internalQuery({
  args: { agentId: v.id("agents"), now: v.number() },
  handler: async (ctx, { agentId, now }): Promise<ProviderContext> => {
    const agent = await ctx.db.get("agents", agentId);
    if (!agent) {
      throw new ConvexError({
        kind: "InvalidArgument",
        message: "unknown agent",
      });
    }
    const config = await ctx.db
      .query("hostedAgentConfigs")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();
    const offerings = await ctx.db
      .query("offerings")
      .withIndex("by_agentId_and_active", (q) =>
        q.eq("agentId", agentId).eq("active", true),
      )
      .take(OFFERING_LIMIT);
    const active = new Set(offerings.map((o) => o._id));
    const knowledge = formatKnowledge(
      await ctx.db
        .query("agentSources")
        .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
        .take(10),
    );
    const categories = await ctx.db
      .query("categories")
      .take(CATEGORY_LIMIT + 1);
    if (categories.length > CATEGORY_LIMIT) {
      throw new ConvexError({
        kind: "InvalidArgument",
        message: "too many categories to match the requested service",
      });
    }
    return {
      card: {
        name: agent.name,
        description: agent.description,
        purpose: agent.purpose,
        capabilities: agent.capabilities,
        scope: agent.scope,
        location: agent.location,
      },
      instructions: config?.systemPrompt ?? null,
      ...(knowledge ? { knowledge } : {}),
      categories: categories.map(
        ({ slug, parent, label, attributeSchema }) => ({
          slug,
          parent,
          label,
          attributeSchema,
        }),
      ),
      offerings: offerings.map((o) => ({
        id: o._id,
        category: o.category,
        name: o.name,
        description: o.description,
        price: o.price,
        attributes: o.attributes,
      })),
      freeSlots: (await freeSlots(ctx, agentId, now))
        .filter((slot) => active.has(slot.offeringId))
        .map((slot) => ({
          id: slot._id,
          offeringId: slot.offeringId,
          start: slot.start,
          end: slot.end,
        })),
    };
  },
});
