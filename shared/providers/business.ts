import { encodeGeohash } from "../geo";
import type {
  BusinessCandidate,
  ProspectingScope,
  SiteExtraction,
} from "../prospecting";
import { SiteExtraction as SiteExtractionSchema } from "../prospecting";

export interface BusinessSource {
  readonly provider: BusinessCandidate["source"]["provider"];
  discover(scope: ProspectingScope): Promise<BusinessCandidate[]>;
}

export interface BusinessEnricher {
  enrich(websiteUrl: string): Promise<SiteExtraction>;
}

const OSM_TAGS: Record<string, string> = {
  cafe: '"amenity"="cafe"',
  restaurant: '"amenity"="restaurant"',
  clinic: '"amenity"~"clinic|doctors"',
  dentist: '"amenity"="dentist"',
  pharmacy: '"amenity"="pharmacy"',
  bakery: '"shop"="bakery"',
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
  endpoint = process.env.OVERPASS_URL ??
    "https://overpass-api.de/api/interpreter",
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

export function createFirecrawlEnricher(
  apiKey = process.env.FIRECRAWL_API_KEY,
): BusinessEnricher {
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

export function createGooglePlacesSource(
  apiKey = process.env.GOOGLE_PLACES_API_KEY,
): BusinessSource | null {
  if (!apiKey) return null;
  return {
    provider: "google_places",
    async discover() {
      throw new Error("Google Places source is not implemented yet");
    },
  };
}

export function availableBusinessSources(): BusinessSource[] {
  const places = createGooglePlacesSource();
  return places ? [places, createOverpassSource()] : [createOverpassSource()];
}
