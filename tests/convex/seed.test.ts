// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { AgentCard } from "../../shared/agent";
import { Offering, validateOfferingAttributes } from "../../shared/catalog";
import { SEED_AGENTS, SEED_CATEGORIES } from "../../shared/seed-data";

const modules = import.meta.glob("../../convex/**/*.ts");

it("seed:ensure loads every table with valid data", async () => {
  const t = convexTest(schema, modules);
  const { seeded } = await t.mutation(internal.seed.ensure, {});
  expect(seeded).toContain("agents");

  const data = await t.run(async (ctx) => ({
    agents: await ctx.db.query("agents").collect(),
    offerings: await ctx.db.query("offerings").collect(),
    availability: await ctx.db.query("availability").collect(),
    messages: await ctx.db.query("messages").collect(),
    sessions: await ctx.db.query("sessions").collect(),
  }));

  expect(data.agents).toHaveLength(SEED_AGENTS.length);
  for (const agent of data.agents) {
    expect(AgentCard.safeParse(agent).error?.issues ?? []).toEqual([]);
  }
  for (const offering of data.offerings) {
    expect(Offering.safeParse(offering).success).toBe(true);
    expect(validateOfferingAttributes(offering, SEED_CATEGORIES).success).toBe(
      true,
    );
  }

  const clinic = data.agents.find(
    (a) => a.slug === "clinica-providencia-agenda",
  );
  const clinicSlots = data.availability.filter(
    (a) => a.agentId === clinic?._id,
  );
  expect(clinicSlots).toHaveLength(4);
  expect(clinicSlots.every((slot) => slot.booked === 0)).toBe(true);

  expect(data.sessions[0].contract?.maxTurns).toBe(12);
  expect(data.sessions[0].contract?.purpose).toBe(clinic?.purpose);
  expect(data.messages.every((m) => m.recipient !== undefined)).toBe(true);

  const again = await t.mutation(internal.seed.ensure, {});
  expect(again.seeded).not.toContain("agents");
});
