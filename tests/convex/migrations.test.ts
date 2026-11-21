// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import migrationsTest from "@convex-dev/migrations/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { CLINIC_AGENT_SLUG } from "../../shared/seed-data";

const modules = import.meta.glob("../../convex/**/*.ts");

it("clears legacy patient fields and verification only on self-registered agents", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.mutation(internal.seed.ensure, {});
  const { agentId, clinicId, clinicScope } = await t.run(async (ctx) => {
    const clinic = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", CLINIC_AGENT_SLUG))
      .unique();
    if (!clinic) throw new Error("missing clinic");
    const { _id, _creationTime, ...card } = clinic;
    const agentId = await ctx.db.insert("agents", {
      ...card,
      slug: "legacy-self-registered",
      kind: "external",
      selfRegistered: true,
    });
    return { agentId, clinicId: _id, clinicScope: clinic.scope };
  });
  await t.mutation(internal.migrations.run, {
    fn: "migrations:clearSelfRegisteredPatientScope",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get(agentId))).toMatchObject({
    verified: false,
    scope: {
      allowedIntents: [],
      forbiddenTopics: [],
      dataItShares: [],
      dataItRequests: [],
    },
  });
  expect(await t.run((ctx) => ctx.db.get(clinicId))).toMatchObject({
    verified: true,
    scope: clinicScope,
  });

  const { sessionId, clinicSessionId, clinicContract } = await t.run(
    async (ctx) => {
      const seed = await ctx.db.query("sessions").first();
      if (!seed?.contract) throw new Error("missing session");
      const { _id, _creationTime, ...session } = seed;
      const sessionId = await ctx.db.insert("sessions", session);
      await ctx.db.insert("participants", {
        sessionId,
        kind: "agent",
        agentId,
        role: "recipient",
      });
      return { sessionId, clinicSessionId: _id, clinicContract: seed.contract };
    },
  );
  await t.mutation(internal.migrations.run, {
    fn: "migrations:clearSelfRegisteredRoomData",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.run((ctx) => ctx.db.get(sessionId)))?.contract).toMatchObject(
    { recipientShares: [], recipientRequests: [], forbiddenTopics: [] },
  );
  expect((await t.run((ctx) => ctx.db.get(clinicSessionId)))?.contract).toEqual(
    clinicContract,
  );
});

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
