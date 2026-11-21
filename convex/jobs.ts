import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

// Background jobs with a cap on parallelism, for slow or rate-limited work such as calling an
// AI API. `components.backgroundWork` is mounted in convex/convex.config.ts.
export const pool = new Workpool(components.backgroundWork, {
  maxParallelism: 5,
});

// Usage: enqueue from a mutation or action and the pool runs it in the background, with at most
// `maxParallelism` jobs at once.
//
//   import { internal } from "./_generated/api";
//   import { pool } from "./jobs";
//
//   export const askModel = mutation({
//     args: { prompt: v.string() },
//     handler: async (ctx, args) => {
//       await pool.enqueueAction(ctx, internal.ai.generate, { prompt: args.prompt });
//     },
//   });
//
// Retries and completion callbacks: https://www.convex.dev/components/workpool
