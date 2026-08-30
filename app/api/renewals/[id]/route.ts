// app/api/renewals/[id]/route.ts
//
// The receiving end of the one-tap rebook deep link (?rebook=<renewal_id>
// on the homepage — see RebookWatcher in app/page.tsx). Same public,
// token-in-URL trust model as /api/reschedule/[token] — booking_renewals.id
// is an unguessable UUID, and this only ever returns booking-adjacent
// details, nothing sensitive enough to warrant requiring login on
// whatever device the WhatsApp link gets opened on.
//
// Re-verifies availability with findNextAvailableSlot rather than trusting
// suggested_date/suggested_time as-is — those were computed whenever the
// renewal-nudge cron last ran, which could be days before someone actually
// taps the link, and the whole point of this feature is "book now before
// it's taken" — so if it *has* been taken, this quietly finds the next
// open slot instead of sending someone to a dead end.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { findNextAvailableSlot } from "@/lib/find-available-slot";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: renewal } = await supabase
    .from("booking_renewals")
    .select("id, client_id, artist_id, service_id, due_at, suggested_date, source_booking_id")
    .eq("id", id)
    .single();
  if (!renewal) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });

  const { data: artist } = await supabase
    .from("artists")
    .select("*, services(id, name, price, duration_minutes, is_active)")
    .eq("id", renewal.artist_id)
    .single();
  if (!artist) return NextResponse.json({ error: "This artist is no longer available." }, { status: 404 });

  // Re-verify from today (not the possibly-past suggested_date) — a
  // renewal clicked well after its due date shouldn't suggest a slot
  // that's already in the past.
  const searchFrom = new Date().toISOString().slice(0, 10);
  const slot = await findNextAvailableSlot(supabase, renewal.artist_id, searchFrom);

  // Best-effort prefill of meeting address / point of contact from the
  // original booking this renewal came from — still fully editable in the
  // drawer, just saves re-typing it for the common case where nothing's
  // changed since last time.
  const { data: sourceBooking } = await supabase
    .from("bookings")
    .select("meeting_address, client_poc_name, client_poc_phone")
    .eq("id", renewal.source_booking_id)
    .maybeSingle();

  return NextResponse.json({
    artist,
    serviceId: renewal.service_id,
    bookingDate: slot?.date ?? null,
    bookingTime: slot?.time ?? null,
    slotAvailable: !!slot,
    meetingAddress: sourceBooking?.meeting_address ?? "",
    pocName: sourceBooking?.client_poc_name ?? "",
    pocPhone: sourceBooking?.client_poc_phone ?? "",
  });
}
