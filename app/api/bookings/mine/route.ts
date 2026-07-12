// app/api/bookings/mine/route.ts
//
// Bookings where the CURRENT USER is the artist being booked (as opposed
// to `BookingsTab`'s existing client-side query, which is bookings where
// they're the client). There wasn't previously any way for an artist to
// see who had booked them — this is what the "Client Bookings" view in
// the dashboard and the artist-review flow both read from.
//
// Uses the service-role client for the same reason as /api/reviews: we
// don't know what `bookings`/`artists` RLS currently allows for a
// non-owning-client read, so the safe path is to verify identity via the
// caller's own session (`auth.getUser()`) and then read with the service
// role, rather than depend on an unverified policy.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter") ?? "upcoming"; // upcoming | past | all

  const service = await createServiceClient();

  const { data: artist } = await service
    .from("artists")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!artist) return NextResponse.json({ bookings: [], artistId: null });

  const today = new Date().toISOString().split("T")[0];
  let query = service
    .from("bookings")
    .select(`
      *,
      client:profiles!bookings_client_id_fkey(full_name, avatar_url, phone),
      service:services(name, duration_minutes)
    `)
    .eq("artist_id", artist.id)
    .order("booking_date", { ascending: false })
    .order("booking_time", { ascending: false });

  if (filter === "upcoming") {
    query = query.gte("booking_date", today).in("status", ["confirmed", "pending_payment", "in_progress"]);
  } else if (filter === "past") {
    query = query.or(`booking_date.lt.${today},status.in.(completed,cancelled,no_show)`);
  }

  const { data, error } = await query.limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ bookings: data ?? [], artistId: artist.id });
}
