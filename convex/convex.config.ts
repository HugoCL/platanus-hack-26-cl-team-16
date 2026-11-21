import migrations from "@convex-dev/migrations/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
// Schema changes and backfills: see convex/migrations.ts.
app.use(migrations);
// Throttling: see `rateLimiter` in convex/myFunctions.ts.
app.use(rateLimiter);
// Background jobs with bounded parallelism: see the example in convex/jobs.ts.
// Each `use` makes one pool, reachable as `components.<name>`.
app.use(workpool, { name: "backgroundWork" });

export default app;
