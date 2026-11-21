import { z } from "zod";
import fixtureBusinesses from "../fixtures/businesses.json";
import { distanceKm, encodeGeohash } from "../geo";
import type { Env } from "../models";
import {
  BusinessCandidate,
  type BusinessProvider,
  type ProspectingScope,
  type SiteExtraction,
  SiteExtraction as SiteExtractionSchema,
} from "../prospecting";

export interface BusinessSource {
  readonly provider: BusinessProvider;
  discover(scope: ProspectingScope): Promise<BusinessCandidate[]>;
}

export interface BusinessEnricher {
  enrich(websiteUrl: string): Promise<SiteExtraction>;
}

const FixtureBusiness = BusinessCandidate.extend({
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    comuna: z.string().min(1),
    region: z.string().min(1),
    address: z.string().optional(),
  }),
});

export function createFixtureSource(
  businesses: unknown = fixtureBusinesses,
): BusinessSource {
  const parsed = z.array(FixtureBusiness).parse(businesses);
  return {
    provider: "fixture",
    async discover(scope) {
      const { comuna, center, radiusKm } = scope.area;
      return parsed
        .filter((b) => b.category === scope.category)
        .filter((b) =>
          comuna
            ? b.location.comuna === comuna
            : distanceKm(center, b.location) <= radiusKm,
        )
        .slice(0, scope.limit)
        .map((b) => ({
          ...b,
          location: {
            ...b.location,
            geohash: encodeGeohash(b.location.lat, b.location.lng),
          },
        }));
    },
  };
}

const OSM_TAGS: Record<string, string> = {
  cafeteria: '"amenity"="cafe"',
  restaurante: '"amenity"="restaurant"',
  salud: '"amenity"~"clinic|doctors"',
  odontologia: '"amenity"="dentist"',
  farmacia: '"amenity"="pharmacy"',
  panaderia: '"shop"="bakery"',
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function createOverpassSource(
  endpoint = "https://overpass-api.de/api/interpreter",
): BusinessSource {
  return {
    provider: "osm",
    async discover(scope) {
      const tag = OSM_TAGS[scope.category];
      if (!tag) throw new Error(`no OSM tag mapping for ${scope.category}`);
      const { lat, lng } = scope.area.center;
      const radius = Math.round(scope.area.radiusKm * 1000);
      const query = `[out:json][timeout:25];nwr[${tag}][name](around:${radius},${lat},${lng});out center ${scope.limit};`;
      const res = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
      const { elements } = (await res.json()) as {
        elements: OverpassElement[];
      };
      return elements.flatMap((el): BusinessCandidate[] => {
        const point =
          el.center ??
          (el.lat !== undefined && el.lon !== undefined
            ? { lat: el.lat, lon: el.lon }
            : undefined);
        const tags = el.tags ?? {};
        if (!point || !tags.name) return [];
        return [
          {
            name: tags.name,
            category: scope.category,
            location: {
              lat: point.lat,
              lng: point.lon,
              geohash: encodeGeohash(point.lat, point.lon),
              comuna:
                tags["addr:city"] ?? scope.area.comuna ?? scope.area.label,
              region: "Región Metropolitana",
              address:
                [tags["addr:street"], tags["addr:housenumber"]]
                  .filter(Boolean)
                  .join(" ") || undefined,
            },
            contact: {
              phone: tags.phone ?? tags["contact:phone"],
              email: tags.email ?? tags["contact:email"],
              website: tags.website ?? tags["contact:website"],
            },
            openingHours: tags.opening_hours,
            source: {
              provider: "osm",
              externalId: `${el.type}/${el.id}`,
              url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
            },
          },
        ];
      });
    },
  };
}

export function createGooglePlacesSource(apiKey: string): BusinessSource {
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return {
    provider: "google_places",
    async discover() {
      throw new Error("Google Places source is not implemented yet");
    },
  };
}

export function createFirecrawlEnricher(apiKey: string): BusinessEnricher {
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");
  return {
    async enrich(websiteUrl) {
      const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: websiteUrl,
          formats: [
            {
              type: "json",
              schema: SiteExtractionSchema.toJSONSchema(),
              prompt:
                "Extract the business description, what it offers, opening hours and public contact details.",
            },
          ],
          onlyMainContent: true,
        }),
      });
      if (!res.ok) throw new Error(`Firecrawl returned ${res.status}`);
      const body = (await res.json()) as { data?: { json?: unknown } };
      return SiteExtractionSchema.parse(body.data?.json);
    },
  };
}

export function configuredBusinessSources(
  env: Env = process.env,
): BusinessSource[] {
  const names = (env.BUSINESS_SOURCES ?? "fixture")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.map((name) => {
    if (name === "fixture") return createFixtureSource();
    if (name === "osm") return createOverpassSource(env.OVERPASS_URL);
    if (name === "google_places") {
      return createGooglePlacesSource(env.GOOGLE_PLACES_API_KEY ?? "");
    }
    throw new Error(
      `unknown business source "${name}" (use fixture, osm or google_places)`,
    );
  });
}

export function configuredBusinessEnricher(
  env: Env = process.env,
): BusinessEnricher | null {
  const name = env.BUSINESS_ENRICHER ?? "none";
  if (name === "none") return null;
  if (name === "firecrawl") {
    return createFirecrawlEnricher(env.FIRECRAWL_API_KEY ?? "");
  }
  throw new Error(
    `unknown business enricher "${name}" (use none or firecrawl)`,
  );
}
