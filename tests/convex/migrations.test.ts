// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import migrationsTest from "@convex-dev/migrations/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { CLINIC_AGENT_SLUG } from "../../shared/seedData";

const modules = import.meta.glob("../../convex/**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

it("backfills the provider's purpose into rooms seeded before it was required", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  migrationsTest.register(t);
  await t.mutation(internal.seed.ensure, {});
  const { sessionId, clinicPurpose } = await t.run(async (ctx) => {
    const session = await ctx.db.query("sessions").first();
    const clinic = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", CLINIC_AGENT_SLUG))
      .unique();
    if (!session?.contract || !clinic) throw new Error("seed is missing");
    const { purpose: _purpose, ...legacy } = session.contract;
    await ctx.db.patch(session._id, { contract: legacy });
    return { sessionId: session._id, clinicPurpose: clinic.purpose };
  });

  await t.mutation(internal.migrations.run, {
    fn: "migrations:backfillSessionPurpose",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const session = await t.run((ctx) => ctx.db.get(sessionId));
  expect(session?.contract?.purpose).toBe(clinicPurpose);
});
