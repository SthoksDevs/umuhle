// lib/locality.ts
//
// "How local is this seller to the person looking at it?" — shared by the
// artist booking drawer (app/page.tsx) and the salon booking form
// (app/stores/[id]/page.tsx) to rank upsell products: same city first,
// then same province, then the rest of the country.
//
// Deliberately built on lat/long only (distanceKm + the existing
// nearest-centroid getProvince() from lib/provinces.ts), NOT on string
// comparison of profiles.city/province — those are free-typed and
// inconsistently cased ("Cape Town" vs "cape town" vs "CT"), while every
// seller now has real coordinates (profiles.latitude/longitude, see the
// "local_delivery_and_provincial_sales" migration) that distanceKm()
// already knows how to compare reliably. "Same city" itself has no formal
// boundary data in this project (same caveat lib/provinces.ts calls out
// for provinces), so it's approximated as "close enough to plausibly be
// the same metro area" via SAME_CITY_RADIUS_KM — deliberately tighter than
// the 50km NEARBY_RADIUS_KM used elsewhere for "is this worth showing at
// all", since this is a finer-grained tier within results already worth
// showing.

import { distanceKm, type Coords } from "@/lib/geolocation";
import { getProvince } from "@/lib/provinces";

export const SAME_CITY_RADIUS_KM = 15;

export type LocalityTier = 0 | 1 | 2; // 0 = same city, 1 = same province, 2 = rest of country / unknown

/**
 * Classifies a candidate's location against a reference point. Falls back
 * to tier 2 (last, not excluded) whenever either coordinate is missing —
 * a seller who hasn't set an address yet still shows up, just without a
 * locality boost.
 */
export function localityTier(reference: Coords | null, candidate: Coords | null): LocalityTier {
  if (!reference || !candidate) return 2;
  const d = distanceKm(reference, candidate);
  if (d <= SAME_CITY_RADIUS_KM) return 0;
  return getProvince(reference) === getProvince(candidate) ? 1 : 2;
}

/**
 * Stable-sorts items by locality tier (nearest first), preserving each
 * tier's original relative order — so e.g. tag-match relevance or
 * created_at ordering from the underlying query still breaks ties within
 * a tier, only locality decides the coarse grouping.
 */
export function sortByLocality<T>(
  items: T[],
  reference: Coords | null,
  getCoords: (item: T) => Coords | null
): T[] {
  if (!reference) return items;
  return items
    .map((item, index) => ({ item, index, tier: localityTier(reference, getCoords(item)) }))
    .sort((a, b) => (a.tier - b.tier) || (a.index - b.index))
    .map((x) => x.item);
}
