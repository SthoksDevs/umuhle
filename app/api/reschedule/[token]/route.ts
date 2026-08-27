// app/api/reschedule/[token]/route.ts
//
// The route behind app/reschedule/[token]/page.tsx — the link sent in the
// no-show nudge (see app/api/cron/no-show-check/route.ts) and, generally,
// available any time a client wants to move a paid booking rather than
// cancel it. Same trust model as review_invites.token: the token in the
// URL is the only credential, no login required.
//
// GET returns the booking's current details + any taken slots for a given
// candidate date (so the page can grey out a day without ever exposing
// other people's booking rows directly to an unauthenticated client).
// POST moves the booking to a new date/time on the *same* row — already
// paid, no new checkout — and re-arms the normal reminder/no-show cycle.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const RESCHEDULABLE_STATUSES = ["confirmed", "no_show"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = await createServiceClient();

  const { data: booking } = await service
    .from("bookings")
    .select(`
      id, status, booking_date, booking_time, artist_id,
      artist:artists(id, display_name, avatar_url),
      service:services(id, name)
    `)
    .eq("reschedule_token", token)
    .single();

  if (!booking) return NextResponse.json({ error: "This reschedule link isn't valid." }, { status: 404 });

  const artist = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;
  const service_ = Array.isArray(booking.service) ? booking.service[0] : booking.service;

  if (!RESCHEDULABLE_STATUSES.includes(booking.status)) {
    return NextResponse.json({
      error: booking.status === "completed"
        ? "This booking's already been completed, so there's nothing to reschedule."
        : "This booking's been cancelled, so there's nothing to reschedule.",
    }, { status: 400 });
  }

  // Optional: taken slots for a specific candidate date, so the page can
  // grey out times without a second round trip exposing raw booking rows.
  const dateParam = req.nextUrl.searchParams.get("date");
  let takenTimes: string[] = [];
  if (dateParam) {
    const { data: taken } = await service
      .from("bookings")
      .select("booking_time")
      .eq("artist_id", booking.artist_id)
      .eq("booking_date", dateParam)
      .neq("status", "cancelled")
      .neq("id", booking.id);
    takenTimes = (taken ?? []).map(t => t.booking_time.slice(0, 5));
  }

  return NextResponse.json({
    status: booking.status,
    bookingDate: booking.booking_date,
    bookingTime: booking.booking_time.slice(0, 5),
    artistName: artist?.display_name ?? "your artist",
    artistAvatar: artist?.avatar_url ?? null,
    serviceName: service_?.name ?? "your appointment",
    takenTimes,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const date = typeof body?.date === "string" ? body.date : undefined;
  const time = typeof body?.time === "string" ? body.time : undefined;
  if (!date || !time) return NextResponse.json({ error: "Please pick a date and time." }, { status: 400 });

  const service = await createServiceClient();

  const { data: booking } = await service
    .from("bookings")
    .select("id, status, artist_id")
    .eq("reschedule_token", token)
    .single();

  if (!booking) return NextResponse.json({ error: "This reschedule link isn't valid." }, { status: 404 });
  if (!RESCHEDULABLE_STATUSES.includes(booking.status)) {
    return NextResponse.json({ error: "This booking can no longer be rescheduled." }, { status: 400 });
  }

  const { data: clash } = await service
    .from("bookings")
    .select("id")
    .eq("artist_id", booking.artist_id)
    .eq("booking_date", date)
    .eq("booking_time", time)
    .neq("status", "cancelled")
    .neq("id", booking.id)
    .maybeSingle();
  if (clash) return NextResponse.json({ error: "That slot's just been taken — please pick another." }, { status: 409 });

  const { error } = await service
    .from("bookings")
    .update({
      booking_date: date,
      booking_time: time,
      // Recovering from a no-show back to confirmed is exactly what a
      // successful reschedule *is* — and either way, re-arm both reminder
      // cycles for the new slot rather than leaving them permanently
      // flipped from the old one.
      status: "confirmed",
      no_show_at: null,
      reminder_sent: false,
      no_show_reminder_sent: false,
    })
    .eq("id", booking.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
