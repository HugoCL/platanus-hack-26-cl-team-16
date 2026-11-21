import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { SELF_REGISTERED_SCOPE } from "./agentRegistration";

// Use this file for every destructive schema change and every backfill:
//   1. make the schema accept old and new data (new field optional, old field optional),
//   2. write a migration below that moves the data,
//   3. push, then run `pnpm migrate` (runs everything in `runAll`, skips finished ones),
//   4. tighten the schema once all data matches. Convex refuses the push until it does.
// Docs: https://www.convex.dev/components/migrations
export const migrations = new Migrations<DataModel>(components.migrations);

// `convex run migrations:run '{"fn":"migrations:<name>"}'` runs one migration by name.
export const run = migrations.runner();

// `pnpm migrate`: runs the listed migrations in order. Add new ones to this list.
export const runAll = migrations.runner([
  internal.migrations.exampleBackfillNumbers,
  internal.migrations.backfillSessionPurpose,
  internal.migrations.clearSelfRegisteredPatientScope,
  internal.migrations.clearSelfRegisteredRoomData,
]);

export const clearSelfRegisteredPatientScope = migrations.define({
  table: "agents",
  migrateOne: (_ctx, agent) =>
    agent.selfRegistered
      ? { scope: SELF_REGISTERED_SCOPE, verified: false }
      : undefined,
});

export const clearSelfRegisteredRoomData = migrations.define({
  table: "sessions",
  migrateOne: async (ctx, session) => {
    if (!session.contract) return;
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .take(10);
    const recipient = participants.find(
      (p) => p.kind === "agent" && p.role === "recipient",
    );
    if (recipient?.kind !== "agent") return;
    const agent = await ctx.db.get(recipient.agentId);
    if (!agent?.selfRegistered) return;
    return {
      contract: {
        ...session.contract,
        recipientShares: [],
        recipientRequests: [],
        forbiddenTopics: [],
      },
    };
  },
});

// TEMPLATE, copy this to write a real migration. It runs over every document of `numbers`
// in batches. Return a partial document to patch it, or return nothing to leave it alone.
// This one changes nothing.
export const exampleBackfillNumbers = migrations.define({
  table: "numbers",
  migrateOne: (_ctx, _doc) => {
    // Example, once `label: v.optional(v.string())` exists in convex/schema.ts:
    //   if (_doc.label === undefined) return { label: `n${_doc.value}` };
    return undefined;
  },
});

// Rooms seeded before E2 have a contract without the provider's purpose. Copy it from the
// recipient agent's card. Once every deployment has run it, make `purpose` required again in
// convex/schema.ts.
export const backfillSessionPurpose = migrations.define({
  table: "sessions",
  migrateOne: async (ctx, session) => {
    if (!session.contract || session.contract.purpose !== undefined) return;
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .take(10);
    const recipient = participants.find((p) => p.role === "recipient");
    if (recipient?.kind !== "agent") return;
    const provider = await ctx.db.get(recipient.agentId);
    if (!provider) return;
    return { contract: { ...session.contract, purpose: provider.purpose } };
  },
});
