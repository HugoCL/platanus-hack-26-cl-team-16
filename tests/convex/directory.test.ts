// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { AgentDetail, AgentSummary } from "../../shared/mcp";
import { CLINIC_AGENT_SLUG } from "../../shared/seedData";

const modules = import.meta.glob("../../convex/**/*.ts");

let t: ReturnType<typeof convexTest>;
beforeEach(async () => {
  t = convexTest(schema, modules);
  await t.mutation(internal.seed.ensure, {});
});

describe("E1 success criteria", () => {
  it("1. category cardiologia in Providencia returns the seed clinic first", async () => {
    const cards = await t.query(api.directory.search, {
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
      source: "parser",
    });
    expect(agents[0]?.slug).toBe(CLINIC_AGENT_SLUG);
  });

  it("3. a search with no matches returns an empty list, not an error", async () => {
    await expect(
      t.query(api.directory.search, { category: "gimnasio", comuna: "Pirque" }),
    ).resolves.toEqual([]);
    await expect(
      t.query(api.directory.search, { category: "no_existe" }),
    ).resolves.toEqual([]);
    await expect(
      t.query(api.directory.search, { comuna: "Narnia" }),
    ).resolves.toEqual([]);
    const text = await t.action(api.directory.searchText, {
      query: "xyzzy qwerty",
    });
    expect(text.agents).toEqual([]);
    const textNoMatch = await t.action(api.directory.searchText, {
      query: "gimnasio en Pirque",
    });
    expect(textNoMatch.agents).toEqual([]);
  });

  it("4. every returned card is valid and carries its purpose and scope", async () => {
    const results = [
      await t.query(api.directory.search, {}),
      await t.query(api.directory.search, { category: "salud" }),
      await t.query(api.directory.search, { comuna: "Las Condes" }),
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
});

describe("directory search", () => {
  it("a parent category includes its children", async () => {
    const slugs = (
      await t.query(api.directory.search, { category: "salud" })
    ).map((c) => c.slug);
    expect(slugs).toEqual(
      expect.arrayContaining([CLINIC_AGENT_SLUG, "dental-nunoa"]),
    );
    const general = await t.query(api.directory.search, {
      category: "medicina_general",
    });
    expect(general.map((c) => c.slug)).toEqual([CLINIC_AGENT_SLUG]);
  });

  it("puts verified cards first", async () => {
    const cards = await t.query(api.directory.search, {
      category: "cafeteria",
    });
    expect(cards.length).toBeGreaterThan(1);
    const firstUnverified = cards.findIndex((c) => !c.verified);
    expect(firstUnverified).toBeGreaterThan(0);
    expect(cards.slice(firstUnverified).every((c) => !c.verified)).toBe(true);
  });

  it("accepts labels and comunas without accents, and honours limit", async () => {
    const byLabel = await t.query(api.directory.search, {
      category: "Odontología",
      comuna: "nunoa",
    });
    expect(byLabel.map((c) => c.slug)).toEqual(["dental-nunoa"]);
    const limited = await t.query(api.directory.search, { limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("reads one card by slug or id, and returns null when missing", async () => {
    const bySlug = await t.query(api.directory.get, {
      slug: CLINIC_AGENT_SLUG,
    });
    expect(bySlug?.entityName).toBe("Clínica Providencia Salud");
    expect(bySlug?.scope.forbiddenTopics).toContain("datos de otros pacientes");
    const byId = await t.query(api.directory.get, {
      agentId: bySlug?.agentId as never,
    });
    expect(byId).toEqual(bySlug);
    await expect(
      t.query(api.directory.get, { slug: "no-existe" }),
    ).resolves.toBeNull();
  });
});
