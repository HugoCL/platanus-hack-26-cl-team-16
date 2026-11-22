import { z } from "zod";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export const GEOHASH_PRECISION = 7;

export function encodeGeohash(
  lat: number,
  lng: number,
  precision = GEOHASH_PRECISION,
): string {
  let latRange = [-90, 90];
  let lngRange = [-180, 180];
  let hash = "";
  let bit = 0;
  let index = 0;
  let evenBit = true;
  while (hash.length < precision) {
    const range = evenBit ? lngRange : latRange;
    const value = evenBit ? lng : lat;
    const mid = (range[0] + range[1]) / 2;
    if (value >= mid) {
      index = index * 2 + 1;
      if (evenBit) lngRange = [mid, range[1]];
      else latRange = [mid, range[1]];
    } else {
      index *= 2;
      if (evenBit) lngRange = [range[0], mid];
      else latRange = [range[0], mid];
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[index];
      bit = 0;
      index = 0;
    }
  }
  return hash;
}

export function geohashPrefixRange(prefix: string) {
  return { gte: prefix, lt: `${prefix}~` };
}

export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLng>;

export const Location = LatLng.extend({
  geohash: z.string().regex(/^[0-9b-hjkmnp-z]{1,12}$/),
  comuna: z.string().min(1).max(60),
  region: z.string().min(1).max(80),
  address: z.string().max(200).optional(),
});
export type Location = z.infer<typeof Location>;
