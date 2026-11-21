import type { TableNames } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

// Local deployments start empty, so every table needs sample data to develop against.
//
// RULE: add a table to convex/schema.ts -> add a seeder for it below. `seeders` is typed as
// Record<TableNames, Seeder>, so `pnpm typecheck` fails until every table has one.
//
// `pnpm dev` runs `seed:ensure` once at startup, before it starts watching. It only fills tables
// that are empty, so it is safe to run again. `pnpm seed` runs it by hand, `pnpm seed:reset`
// wipes and reseeds a local deployment (it refuses to run anywhere else). Both talk to the running
// deployment, so start `pnpm dev` first.
type Seeder = (ctx: MutationCtx) => Promise<void>;

export const seeders = {
  numbers: async (ctx) => {
    for (const value of [3, 1, 4, 1, 5]) {
      await ctx.db.insert("numbers", { value });
    }
  },
} satisfies Record<TableNames, Seeder>;

const tableNames = Object.keys(seeders) as TableNames[];

// Seeds every table that has no documents yet and leaves the others alone.
export const ensure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seeded: TableNames[] = [];
    for (const table of tableNames) {
      if ((await ctx.db.query(table).first()) === null) {
        await seeders[table](ctx);
        seeded.push(table);
      }
    }
    console.log(
      seeded.length
        ? `seed: seeded ${seeded.join(", ")}`
        : "seed: every table already has data",
    );
    return { seeded };
  },
});

// Local deployments (`convex dev` anonymous or local) serve from the loopback address.
function isLocalDeployment() {
  const url = process.env.CONVEX_CLOUD_URL;
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
  } catch {
    return false;
  }
}

// Deletes every document of every seeded table, then seeds again. Local deployments only.
// It runs in one transaction, so it suits seed-sized tables, not big ones. Everything is deleted
// first and seeded afterwards, in `seeders` order (list parents before children), so a seeder
// never sees leftover rows of a later table.
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!isLocalDeployment()) {
      throw new Error(
        "seed:reset only runs on a local deployment (CONVEX_CLOUD_URL must be localhost or 127.0.0.1)",
      );
    }
    for (const table of tableNames) {
      for await (const doc of ctx.db.query(table)) {
        await ctx.db.delete(doc._id);
      }
    }
    for (const table of tableNames) {
      await seeders[table](ctx);
    }
    console.log(`seed: reset ${tableNames.join(", ")}`);
    return { reset: tableNames };
  },
});
