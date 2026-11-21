// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { sha256Hex } from "../../convex/agentKeys";
import schema from "../../convex/schema";
import { CONSUMER_AGENT_SLUG } from "../../shared/seedData";

const modules = import.meta.glob("../../convex/**/*.ts");

const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;
beforeEach(async () => {
  t = createTest();
  await t.mutation(internal.seed.ensure, {});
});

const issue = () =>
  t.action(internal.agentKeys.issue, {
    slug: CONSUMER_AGENT_SLUG,
    label: "test",
  });
const authenticate = (apiKey: string) =>
  t.query(api.agentKeys.authenticate, { apiKey });

describe("agent API keys", () => {
  it("issues a key that is stored only as its hash and visible prefix", async () => {
    const { apiKey, prefix, agentId } = await issue();
    expect(apiKey).toMatch(/^dak_[0-9a-f]{64}$/);
    expect(prefix).toBe(apiKey.slice(0, 12));

    const rows = await t.run((ctx) =>
      ctx.db
        .query("agentApiKeys")
        .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
        .collect(),
    );
    expect(rows.find((row) => row.prefix === prefix)).toMatchObject({
      keyHash: await sha256Hex(apiKey),
      label: "test",
    });
    expect(JSON.stringify(rows)).not.toContain(apiKey.slice(prefix.length));
  });

  it("resolves the agent from a valid key", async () => {
    const { apiKey, agentId } = await issue();
    await expect(authenticate(apiKey)).resolves.toBe(agentId);
  });

  it("rejects unknown and revoked keys", async () => {
    const { apiKey } = await issue();
    await expect(authenticate(`${apiKey}0`)).resolves.toBeNull();
    await expect(authenticate("")).resolves.toBeNull();

    const keyHash = await sha256Hex(apiKey);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("agentApiKeys")
        .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
        .unique();
      if (!row) throw new Error("issued key is missing");
      await ctx.db.patch(row._id, { revokedAt: Date.now() });
    });
    await expect(authenticate(apiKey)).resolves.toBeNull();
  });

  it("stops accepting a key once its agent is no longer active", async () => {
    const { apiKey, agentId } = await issue();
    await t.run((ctx) => ctx.db.patch(agentId, { status: "draft" }));
    await expect(authenticate(apiKey)).resolves.toBeNull();
  });

  it("refuses to issue a key for an unknown agent", async () => {
    await expect(
      t.action(internal.agentKeys.issue, { slug: "no-existe" }),
    ).rejects.toThrow(/no agent with slug no-existe/);
  });
});
