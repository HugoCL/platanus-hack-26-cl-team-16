// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { isApiKeyFormat, sha256Hex } from "../../convex/agentKeys";
import schema from "../../convex/schema";
import { CONSUMER_AGENT_SLUG } from "../../shared/seedData";

const modules = import.meta.glob("../../convex/**/*.ts");

const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;
beforeEach(async () => {
  t = createTest();
  rateLimiter.register(t);
  await t.mutation(internal.seed.ensure, {});
});

const issue = () =>
  t.action(internal.agentKeys.issue, {
    slug: CONSUMER_AGENT_SLUG,
    label: "test",
  });
const authenticate = (apiKey: string) =>
  t.mutation(api.agentKeys.authenticate, { apiKey });
const keyRow = async (apiKey: string) => {
  const keyHash = await sha256Hex(apiKey);
  return t.run((ctx) =>
    ctx.db
      .query("agentApiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
      .unique(),
  );
};

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

  it("resolves the agent from a valid key and records when it was used", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { apiKey, agentId } = await issue();
      expect((await keyRow(apiKey))?.lastUsedAt).toBeUndefined();

      await expect(authenticate(apiKey)).resolves.toEqual({
        ok: true,
        agentId,
      });
      const firstUse = (await keyRow(apiKey))?.lastUsedAt ?? 0;
      expect(firstUse).toBeGreaterThan(0);

      vi.advanceTimersByTime(30_000);
      await authenticate(apiKey);
      expect((await keyRow(apiKey))?.lastUsedAt).toBe(firstUse);

      vi.advanceTimersByTime(31_000);
      await authenticate(apiKey);
      expect((await keyRow(apiKey))?.lastUsedAt).toBeGreaterThanOrEqual(
        firstUse + 60_000,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a malformed key without looking it up", async () => {
    const { apiKey } = await issue();
    expect(isApiKeyFormat(apiKey)).toBe(true);
    for (const malformed of [
      "",
      apiKey.toUpperCase(),
      `${apiKey}0`,
      apiKey.slice(0, -1),
      `sk_${apiKey.slice(4)}`,
    ]) {
      expect(isApiKeyFormat(malformed)).toBe(false);
      await expect(authenticate(malformed)).resolves.toBeNull();
    }
  });

  it("revokes a key by its agent and visible prefix", async () => {
    const { apiKey, prefix } = await issue();
    const other = await issue();
    await t.mutation(internal.agentKeys.revoke, {
      slug: CONSUMER_AGENT_SLUG,
      prefix,
    });
    await expect(authenticate(apiKey)).resolves.toBeNull();
    await expect(authenticate(other.apiKey)).resolves.toEqual({
      ok: true,
      agentId: other.agentId,
    });

    const revokedAt = (await keyRow(apiKey))?.revokedAt;
    await t.mutation(internal.agentKeys.revoke, {
      slug: CONSUMER_AGENT_SLUG,
      prefix,
    });
    expect((await keyRow(apiKey))?.revokedAt).toBe(revokedAt);

    await expect(
      t.mutation(internal.agentKeys.revoke, {
        slug: "no-existe",
        prefix,
      }),
    ).rejects.toThrow(/no key/);
  });

  it("rejects unknown and revoked keys", async () => {
    const { apiKey } = await issue();
    await expect(authenticate(`${apiKey}0`)).resolves.toBeNull();
    await expect(authenticate("")).resolves.toBeNull();

    const row = await keyRow(apiKey);
    if (!row) throw new Error("issued key is missing");
    await t.run((ctx) => ctx.db.patch(row._id, { revokedAt: Date.now() }));
    await expect(authenticate(apiKey)).resolves.toBeNull();
  });

  it("stops accepting a key once its agent is no longer active", async () => {
    const { apiKey, agentId } = await issue();
    await t.run((ctx) => ctx.db.patch(agentId, { status: "draft" }));
    await expect(authenticate(apiKey)).resolves.toBeNull();
  });

  it("refuses to issue a key for an unknown or inactive agent", async () => {
    await expect(
      t.action(internal.agentKeys.issue, { slug: "no-existe" }),
    ).rejects.toThrow(/no agent with slug no-existe/);
    await expect(
      t.action(internal.agentKeys.issue, { slug: "cafe-los-dominicos" }),
    ).rejects.toThrow(/cafe-los-dominicos is prospect, not active/);
  });
});
