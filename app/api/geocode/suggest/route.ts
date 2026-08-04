// app/api/geocode/suggest/route.ts
//
// Powers the "search your address" autocomplete on the dashboard's
// SalonForm (app/dashboard/page.tsx) — a live, as-you-type list of real,
// matched addresses to pick from, rather than trusting free-text entry
// across five separate fields. Picking a suggestion fills address/suburb/
// city/postal_code AND latitude/longitude directly from that match, which
// sidesteps the whole class of "geocode failed on save" problem: the
// coordinates come straight from a result Nominatim already resolved,
// instead of being re-derived later from whatever ended up in the fields.
//
// /api/geocode (the sibling POST route) stays as-is — a best-effort
// fallback for anyone who types the fields by hand instead of using this.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type NominatimAddress = {
  house_number?: string;
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  postcode?: string;
};
type NominatimResult = { lat: string; lon: string; display_name: string; address?: NominatimAddress };

export async function GET(req: NextRequest) {
  // Same auth gate as /api/geocode — keeps this from being an open,
  // unauthenticated proxy to Nominatim from the public internet.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 4) return NextResponse.json({ results: [] });

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=za&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": "UmuhleMarketplace/1.0 (info@umuhle.co.za)" } }
    );
    if (!res.ok) return NextResponse.json({ results: [] });

    const raw = (await res.json()) as NominatimResult[];
    const results = raw
      .map(r => {
        const latitude = parseFloat(r.lat);
        const longitude = parseFloat(r.lon);
        const a = r.address ?? {};
        return {
          displayName: r.display_name,
          latitude,
          longitude,
          street: [a.house_number, a.road].filter(Boolean).join(" "),
          suburb: a.suburb || a.neighbourhood || a.city_district || "",
          city: a.city || a.town || a.village || "",
          postalCode: a.postcode || "",
        };
      })
      .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
