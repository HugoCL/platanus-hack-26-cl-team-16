/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import type { FunctionArgs } from "convex/server";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { CLINIC_AGENT_SLUG, CONSUMER_AGENT_SLUG } from "../../shared/seedData";

const modules = import.meta.glob("../../convex/**/*.ts");

export const REQUEST = "Necesito hora con un cardiólogo en Providencia";

export type OpenArgs = FunctionArgs<typeof api.rooms.open>;

export async function seededRooms() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  await t.mutation(internal.seed.ensure, {});
  const agentId = (slug: string) =>
    t.run(async (ctx) => {
      const agent = await ctx.db
        .query("agents")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!agent) throw new Error(`missing ${slug}`);
      return agent._id;
    });
  const consumerId = await agentId(CONSUMER_AGENT_SLUG);
  const clinicId = await agentId(CLINIC_AGENT_SLUG);
  const open = (overrides: Partial<OpenArgs> = {}) =>
    t.mutation(api.rooms.open, {
      initiatorAgentId: consumerId,
      providerAgentId: clinicId,
      request: REQUEST,
      ...overrides,
    });
  return { t, consumerId, clinicId, open };
}

export async function errorKind(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { data?: { kind?: string } }).data?.kind ?? "untyped";
  }
  throw new Error("expected the call to fail");
}
