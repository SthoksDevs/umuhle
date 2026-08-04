// app/api/geocode/route.ts
//
// Turns a salon's address fields into a latitude/longitude pair so the
// public store page's "Find us here" map (app/stores/[id]/page.tsx, which
// already renders a keyless Google Maps iframe whenever
// salon.latitude && salon.longitude are set) actually has something to
// show. partner_salons.latitude/longitude existed in the schema already
// but nothing ever wrote to them for salon (as opposed to individual
// artist) listings — this route is what the dashboard's SalonForm now
// calls on save to fill that gap.
//
// Uses OpenStreetMap's Nominatim search API rather than Google's Geocoding
// API: it's free and needs no API key/billing setup, which matters for a
// call that only fires a handful of times a day (once per store create or
// edit). Nominatim's usage policy just asks for a descriptive User-Agent
// and no more than ~1 request/second, both of which this easily satisfies.
// If Umuhle later needs higher accuracy/volume, swap the fetch below for
// Google's Geocoding API — the request/response shape here is deliberately
// kept simple so that's a one-function change.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const NOMINATIM_HEADERS = {
  // Nominatim's usage policy requires an identifying User-Agent.
  "User-Agent": "UmuhleMarketplace/1.0 (info@umuhle.co.za)",
};

// Naively joining address + suburb + city + postalCode + "South Africa"
// breaks the moment any of those already appear inside the address field —
// e.g. an owner pastes a full address ("56 Main Rd, Sandton, 2196, South
// Africa") into the address box, which then gets suburb/city/postcode/
// country all bolted on again, producing a heavily duplicated string that
// Nominatim's parser can fail to match at all. This only appends a part if
// it isn't already present (case-insensitive) in what's been built so far.
function buildQuery(address: string, suburb?: string, city?: string, postalCode?: string): string {
  const parts = [address.trim()];
  const already = () => parts.join(" ").toLowerCase();
  for (const part of [suburb, city, postalCode, "South Africa"]) {
    const t = (part ?? "").trim();
    if (t && !already().includes(t.toLowerCase())) parts.push(t);
  }
  return parts.filter(Boolean).join(", ");
}

async function nominatimSearch(query: string): Promise<{ lat: string; lon: string } | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=za&q=${encodeURIComponent(query)}`,
    { headers: NOMINATIM_HEADERS }
  );
  if (!res.ok) return null;
  const results = (await res.json()) as Array<{ lat: string; lon: string }>;
  return results[0] ?? null;
}

export async function POST(req: NextRequest) {
  // Require a logged-in session so this can't be used as an open,
  // unauthenticated proxy to Nominatim from the public internet.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { address?: string; suburb?: string; city?: string; postalCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const address = (body.address ?? "").trim();
  if (!address) {
    return NextResponse.json({ error: "Not enough address detail to geocode" }, { status: 400 });
  }

  try {
    // Try the fullest query first; if Nominatim can't match that (a real
    // possibility with messier, longer strings), fall back to just the
    // address line + country, which is more forgiving.
    const full = buildQuery(address, body.suburb, body.city, body.postalCode);
    let hit = await nominatimSearch(full);
    if (!hit) {
      const simple = buildQuery(address);
      if (simple !== full) hit = await nominatimSearch(simple);
    }

    if (!hit) return NextResponse.json({ error: "No match found for that address" }, { status: 404 });

    const latitude = parseFloat(hit.lat);
    const longitude = parseFloat(hit.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({ error: "Geocoding returned an invalid result" }, { status: 502 });
    }

    return NextResponse.json({ latitude, longitude });
  } catch {
    return NextResponse.json({ error: "Geocoding request failed" }, { status: 502 });
  }
}
