// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { SCAN_BUDGET, toDirectoryCard } from "../../convex/directory";
import schema from "../../convex/schema";
import { AgentDetail, AgentSummary } from "../../shared/mcp";
import { CLINIC_AGENT_SLUG } from "../../shared/seedData";

const modules = import.meta.glob("../../convex/**/*.ts");

const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;
beforeEach(async () => {
  t = createTest();
  rateLimiter.register(t);
  await t.mutation(internal.seed.ensure, {});
});

const search = async (args: {
  category?: string;
  comuna?: string;
  limit?: number;
}) => (await t.query(api.directory.search, args)).agents;

async function insertCopies(
  fromSlug: string,
  count: number,
  card: (i: number) => Partial<Doc<"agents">>,
) {
  await t.run(async (ctx) => {
    const source = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", fromSlug))
      .unique();
    if (!source) throw new Error(`missing ${fromSlug}`);
    const { _id, _creationTime, ...base } = source;
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("agents", { ...base, ...card(i) });
    }
  });
}

describe("E1 success criteria", () => {
  it("1. category cardiologia in Providencia returns the seed clinic first", async () => {
    const cards = await search({
      category: "cardiologia",
      comuna: "Providencia",
    });
    expect(cards[0]?.slug).toBe(CLINIC_AGENT_SLUG);
  });

  it('2. free text "cardiólogo en Providencia" returns the same card', async () => {
    const { interpretation, agents } = await t.action(
      api.directory.searchText,
      { query: "cardiólogo en Providencia" },
    );
    expect(interpretation).toEqual({
      category: "cardiologia",
      comuna: "Providencia",
      unresolved: [],
      source: "parser",
    });
    expect(agents[0]?.slug).toBe(CLINIC_AGENT_SLUG);
  });

  it("3. a search with no matches returns an empty list, not an error", async () => {
    await expect(
      t.query(api.directory.search, { category: "gimnasio", comuna: "Pirque" }),
    ).resolves.toEqual({ agents: [], truncated: false });
    await expect(search({ category: "no_existe" })).resolves.toEqual([]);
    await expect(search({ comuna: "Narnia" })).resolves.toEqual([]);
    for (const query of ["gimnasio en Pirque", "hola"]) {
      const result = await t.action(api.directory.searchText, { query });
      expect(result.interpretation.unresolved).toEqual([]);
      expect(result.agents).toEqual([]);
    }
  });

  it("4. every returned card is valid and carries its purpose and scope", async () => {
    const results = [
      await search({}),
      await search({ category: "salud" }),
      await search({ comuna: "Las Condes" }),
      (
        await t.action(api.directory.searchText, {
          query: "café en Las Condes",
        })
      ).agents,
    ];
    const one = await t.query(api.directory.get, { slug: CLINIC_AGENT_SLUG });
    const cards = [...results.flat(), one];
    expect(cards.length).toBeGreaterThan(15);
    for (const card of cards) {
      expect(AgentDetail.safeParse(card).error?.issues ?? []).toEqual([]);
      expect(AgentSummary.safeParse(card).error?.issues ?? []).toEqual([]);
      expect(card?.purpose.length).toBeGreaterThan(0);
      expect(card?.scope).toBeDefined();
      expect(card?.allowedIntents).toBeDefined();
    }
  });

  it("4. a stored card that breaks the shared contract is never returned", async () => {
    await insertCopies(CLINIC_AGENT_SLUG, 1, () => ({
      slug: "aaa-invalida",
      name: "AAA Clínica inválida",
      purpose: "",
    }));
    const cards = await search({
      category: "cardiologia",
      comuna: "Providencia",
      limit: 1,
    });
    expect(cards.map((c) => c.slug)).toEqual([CLINIC_AGENT_SLUG]);
    expect((await search({})).map((c) => c.slug)).not.toContain("aaa-invalida");
    await expect(
      t.query(api.directory.get, { slug: "aaa-invalida" }),
    ).resolves.toBeNull();
  });
});

describe("directory search", () => {
  it("publishes only the card fields", async () => {
    const clinic = await t.query(api.directory.get, {
      slug: CLINIC_AGENT_SLUG,
    });
    if (!clinic) throw new Error("missing clinic");
    await t.run(async (ctx) => {
      await ctx.db.patch(clinic.agentId, {
        ownerTokenIdentifier: "secret-owner",
        embedding: [0.1, 0.2],
      });
    });
    const cards = [
      ...(await search({})),
      await t.query(api.directory.get, { slug: CLINIC_AGENT_SLUG }),
    ];
    const allowed = new Set([
      ...Object.keys(AgentDetail.shape),
      ...Object.keys(AgentSummary.shape),
    ]);
    for (const card of cards) {
      expect(Object.keys(card ?? {}).filter((k) => !allowed.has(k))).toEqual(
        [],
      );
    }
    expect(JSON.stringify(cards)).not.toContain("secret-owner");

    const withFutureField = await t.run(async (ctx) => {
      const doc = await ctx.db.get(clinic.agentId);
      if (!doc) throw new Error("missing clinic");
      const withSecret = { ...doc, apiSecret: "x" };
      return toDirectoryCard(ctx, withSecret);
    });
    expect(withFutureField).not.toHaveProperty("apiSecret");
  });

  it("ranks every scanned card before applying the limit", async () => {
    await insertCopies("hotel-providencia-suites", 500, (i) => ({
      slug: `hotel-relleno-${i}`,
      name: `Hotel relleno ${i}`,
      verified: false,
    }));
    await insertCopies("hotel-providencia-suites", 1, () => ({
      slug: "aaa-hotel-verificado",
      name: "AAA Hotel verificado",
    }));
    const result = await t.query(api.directory.search, {
      category: "hoteleria",
      comuna: "Providencia",
      limit: 1,
    });
    expect(result).toMatchObject({
      truncated: false,
      agents: [{ slug: "aaa-hotel-verificado" }],
    });
  });

  it("reports truncation when the scan budget runs out", async () => {
    await insertCopies("hotel-providencia-suites", SCAN_BUDGET, (i) => ({
      slug: `hotel-relleno-${i}`,
      name: `Hotel relleno ${i}`,
      verified: false,
    }));
    const result = await t.query(api.directory.search, {
      comuna: "Providencia",
      limit: 1,
    });
    expect(result.truncated).toBe(true);
    expect(result.agents).toHaveLength(1);
  });

  it("free text never drops the half it could not resolve", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const query of [
      "cardiólogo en Narnia",
      "me duele el pecho en Providencia",
      "abogado en Santiago de Compostela",
    ]) {
      const result = await t.action(api.directory.searchText, { query });
      expect(result.interpretation.unresolved).toHaveLength(1);
      expect(result.agents).toEqual([]);
    }
    warn.mockRestore();
  });

  it("caps the free-text length and rate-limits only the LLM fallback", async () => {
    await expect(
      t.action(api.directory.searchText, { query: "a".repeat(301) }),
    ).rejects.toThrow(/at most 300/);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 10; i++) {
      await t.action(api.directory.searchText, {
        query: "me duele el pecho secreto-123",
      });
    }
    await expect(
      t.action(api.directory.searchText, { query: "me duele el pecho" }),
    ).rejects.toThrow(/RateLimited/);
    const parsed = await t.action(api.directory.searchText, {
      query: "cardiólogo en Providencia",
    });
    expect(parsed.agents[0]?.slug).toBe(CLINIC_AGENT_SLUG);

    expect(warn).toHaveBeenCalledWith(
      "directory: LLM fallback failed:",
      "Error",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secreto-123");
    warn.mockRestore();
  });

  it("rejects a limit that is not an integer from 1 to 20", async () => {
    for (const limit of [-1, 0, 1.5, 21]) {
      await expect(search({ limit })).rejects.toThrow(/limit/);
      await expect(
        t.action(api.directory.searchText, { query: "café", limit }),
      ).rejects.toThrow(/limit/);
    }
  });

  it("a parent category includes its children", async () => {
    const slugs = (await search({ category: "salud" })).map((c) => c.slug);
    expect(slugs).toEqual(
      expect.arrayContaining([CLINIC_AGENT_SLUG, "dental-nunoa"]),
    );
    const general = await search({ category: "medicina_general" });
    expect(general.map((c) => c.slug)).toEqual([CLINIC_AGENT_SLUG]);
  });

  it("puts verified cards first", async () => {
    const cards = await search({ category: "cafeteria" });
    expect(cards.length).toBeGreaterThan(1);
    const firstUnverified = cards.findIndex((c) => !c.verified);
    expect(firstUnverified).toBeGreaterThan(0);
    expect(cards.slice(firstUnverified).every((c) => !c.verified)).toBe(true);
  });

  it("accepts labels and comunas without accents, and honours limit", async () => {
    const byLabel = await search({ category: "Odontología", comuna: "nunoa" });
    expect(byLabel.map((c) => c.slug)).toEqual(["dental-nunoa"]);
    expect(await search({ limit: 3 })).toHaveLength(3);
  });

  it("reads one card by slug or id, and returns null when missing", async () => {
    const bySlug = await t.query(api.directory.get, {
      slug: CLINIC_AGENT_SLUG,
    });
    if (!bySlug) throw new Error("missing clinic");
    expect(bySlug.entityName).toBe("Clínica Providencia Salud");
    expect(bySlug.scope.forbiddenTopics).toContain("datos de otros pacientes");
    const byId = await t.query(api.directory.get, { agentId: bySlug.agentId });
    expect(byId).toEqual(bySlug);
    await expect(
      t.query(api.directory.get, { slug: "no-existe" }),
    ).resolves.toBeNull();
    await expect(t.query(api.directory.get, {})).rejects.toThrow(/exactly one/);
    await expect(
      t.query(api.directory.get, {
        slug: CLINIC_AGENT_SLUG,
        agentId: bySlug.agentId,
      }),
    ).rejects.toThrow(/exactly one/);
  });
});
