// lib/provinces.ts
//
// Lightweight "which SA province is this point in" classifier. Used only by
// the province-fallback shown on app/page.tsx and app/stores/page.tsx when
// literally nothing is within NEARBY_RADIUS_KM: rather than a hard dead end,
// we show what's elsewhere in the customer's own province, flagged clearly
// as further out, so they can make an informed call on whether it's worth
// the trip. This used to be the "show all instead" escape hatch — scoping
// it to the customer's own province (instead of the whole country) is the
// replacement.
//
// This is a *nearest-centroid* approximation, not a real polygon lookup —
// there's no province boundary data in this project, and getting it exactly
// right for towns right on a border doesn't matter much for a "still worth
// a look" fallback. Reuses distanceKm() from lib/geolocation.ts so the two
// never disagree on what "distance" means.

import { distanceKm, type Coords } from "@/lib/geolocation";

const PROVINCE_CENTROIDS: { name: string; coords: Coords }[] = [
  { name: "Western Cape",  coords: { latitude: -33.6, longitude: 20.0 } },
  { name: "Eastern Cape",  coords: { latitude: -32.0, longitude: 26.5 } },
  { name: "Northern Cape", coords: { latitude: -29.5, longitude: 21.0 } },
  { name: "Free State",    coords: { latitude: -28.8, longitude: 26.8 } },
  { name: "KwaZulu-Natal", coords: { latitude: -29.0, longitude: 30.3 } },
  { name: "Gauteng",       coords: { latitude: -26.1, longitude: 28.1 } },
  { name: "Mpumalanga",    coords: { latitude: -25.8, longitude: 30.0 } },
  { name: "Limpopo",       coords: { latitude: -23.8, longitude: 29.5 } },
  { name: "North West",    coords: { latitude: -26.6, longitude: 25.5 } },
];

export function getProvince(coords: Coords): string {
  let closest = PROVINCE_CENTROIDS[0];
  let closestDist = Infinity;
  for (const p of PROVINCE_CENTROIDS) {
    const d = distanceKm(coords, p.coords);
    if (d < closestDist) { closestDist = d; closest = p; }
  }
  return closest.name;
}
