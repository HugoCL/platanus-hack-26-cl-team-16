import { describe, expect, it } from "vitest";
import {
  configuredBusinessEnricher,
  configuredBusinessSources,
  createFixtureSource,
} from "../shared/providers/business";

const lasCondes = {
  category: "cafeteria",
  area: {
    label: "Las Condes",
    comuna: "Las Condes",
    center: { lat: -33.4116, lng: -70.5713 },
    radiusKm: 4,
  },
  limit: 20,
};

describe("business sources", () => {
  it("defaults to the local fixture source and no enricher", () => {
    expect(configuredBusinessSources({}).map((s) => s.provider)).toEqual([
      "fixture",
    ]);
    expect(configuredBusinessEnricher({})).toBeNull();
  });

  it("finds fictitious cafés in Las Condes without touching the network", async () => {
    const found = await createFixtureSource().discover(lasCondes);
    expect(found.map((b) => b.name)).toEqual(
      expect.arrayContaining(["Café Los Dominicos", "Café Manquehue"]),
    );
    expect(found.every((b) => b.category === "cafeteria")).toBe(true);
    expect(found.every((b) => b.location?.comuna === "Las Condes")).toBe(true);
    expect(found.every((b) => b.source.provider === "fixture")).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns an empty list when nothing matches", async () => {
    const found = await createFixtureSource().discover({
      ...lasCondes,
      category: "astilleros",
    });
    expect(found).toEqual([]);
  });

  it("real sources stay off unless configured, and fail without keys", () => {
    expect(() =>
      configuredBusinessSources({ BUSINESS_SOURCES: "google_places" }),
    ).toThrow(/GOOGLE_PLACES_API_KEY/);
    expect(() =>
      configuredBusinessEnricher({ BUSINESS_ENRICHER: "firecrawl" }),
    ).toThrow(/FIRECRAWL_API_KEY/);
  });
});
