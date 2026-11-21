/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import type { FunctionArgs } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import * as providers from "../../shared/providers/llm";
import { CLINIC_AGENT_SLUG, CONSUMER_AGENT_SLUG } from "../../shared/seedData";

const modules = import.meta.glob("../../convex/**/*.ts");

afterEach(() => vi.restoreAllMocks());

export const REQUEST = "Necesito hora con un cardiólogo en Providencia";

export type OpenArgs = FunctionArgs<typeof api.rooms.open>;

export async function seededRooms({
  transactionLimits = false,
}: {
  transactionLimits?: boolean;
} = {}) {
  const judge = vi.fn((): unknown => ({ decision: "allow", rule: "purpose" }));
  const llm = providers.createFakeLlmProvider({ object: judge });
  const createLlm = vi
    .spyOn(providers, "createLlmProvider")
    .mockReturnValue(llm);
  const t = convexTest({ schema, modules, transactionLimits });
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
    t.action(api.rooms.open, {
      initiatorAgentId: consumerId,
      providerAgentId: clinicId,
      request: REQUEST,
      ...overrides,
    });
  return { t, consumerId, clinicId, open, judge, llm, createLlm };
}

export async function roomWithHuman(
  rooms: Awaited<ReturnType<typeof seededRooms>>,
  maxTurns?: number,
) {
  const room = await rooms.open({ human: { displayName: "Juan" }, maxTurns });
  const id = (role: string) =>
    room.participants.find((p) => p.role === role)
      ?.participantId as Id<"participants">;
  return {
    room,
    sessionId: room.sessionId as Id<"sessions">,
    consumer: id("initiator"),
    provider: id("recipient"),
    human: id("owner"),
  };
}

export async function errorKind(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { data?: { kind?: string } }).data?.kind ?? "untyped";
  }
  throw new Error("expected the call to fail");
}
