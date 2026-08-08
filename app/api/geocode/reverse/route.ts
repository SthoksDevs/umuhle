// app/api/geocode/reverse/route.ts
//
// The reverse of app/api/geocode/route.ts: turns a lat/lng — typically a
// pin the client dropped or dragged on components/AddressMapPicker.tsx —
// into a human-readable address string. Same Nominatim-backed,
// auth-gated shape as its siblings in this folder (see route.ts and
// suggest/route.ts for the address -> lat/lng direction).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const NOMINATIM_HEADERS = {
  // Nominatim's usage policy requires an identifying User-Agent.
  "User-Agent": "UmuhleMarketplace/1.0 (info@umuhle.co.za)",
};

export async function GET(req: NextRequest) {
  // Require a logged-in session so this can't be used as an open,
  // unauthenticated proxy to Nominatim from the public internet.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lon = parseFloat(req.nextUrl.searchParams.get("lon") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=0`,
      { headers: NOMINATIM_HEADERS }
    );
    if (!res.ok) return NextResponse.json({ error: "Reverse geocoding failed" }, { status: 502 });

    const data = (await res.json()) as { display_name?: string };
    if (!data.display_name) return NextResponse.json({ error: "No address found for that location" }, { status: 404 });

    return NextResponse.json({ address: data.display_name });
  } catch {
    return NextResponse.json({ error: "Reverse geocoding request failed" }, { status: 502 });
  }
}
