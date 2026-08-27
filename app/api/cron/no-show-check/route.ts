// app/api/cron/no-show-check/route.ts
//
// "Check-in" is the artist flipping a booking to in_progress when they
// physically start the service — nothing new needed for that. This route
// is what's missing: watching for the case where it never happens.
//
// Two passes over confirmed, not-yet-checked-in bookings, run on the same
// 15-min cadence as app/api/notifications/route.ts:
//   1. 15+ min past scheduled start, no_show_reminder_sent = false ->
//      WhatsApp nudge with a reschedule link, flag sent.
//   2. 60+ min past scheduled start, still status = 'confirmed' -> auto-
//      flip to no_show. See the 20260827_no_show_nudge migration for why
//      this defaults to attributing the customer rather than leaving
//      fault fully unattributed, and how an explicit human report (the
//      existing Cancel / "Artist didn't arrive" actions) pre-empts this
//      by moving status away from 'confirmed' before the 60-minute mark.
//
// Same idempotent-scan-and-flag pattern as app/api/notifications/route.ts
// — one attempt per booking, success or not, rather than retrying a
// failing send forever at 15-min intervals.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyNoShowCheck } from "@/lib/whatsapp";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const SIXTY_MIN_MS = 60 * 60 * 1000;

// SAST (Africa/Johannesburg) is UTC+2 year-round — no DST. Kept in sync
// with the identical helper in app/api/notifications/route.ts and
// lib/reliability.ts's isLateCancellation rather than imported, since
// each of those files has its own reason not to pull in the others'
// server-only code.
function bookingDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}+02:00`);
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const { data: bookings, error: fetchError } = await supabase
    .from("bookings")
    .select(`
      id, client_id, booking_date, booking_time, reschedule_token, no_show_reminder_sent,
      client:profiles!bookings_client_id_fkey(full_name, phone, whatsapp_comms_enabled),
      artist:artists!bookings_artist_id_fkey(display_name)
    `)
    .eq("status", "confirmed")
    .lte("booking_date", today);

  if (fetchError) console.error("[no-show-check] fetch error:", fetchError);

  let nudged = 0;
  let autoFlipped = 0;

  for (const booking of bookings ?? []) {
    const startedAt = bookingDateTime(booking.booking_date, booking.booking_time);
    const lateMs = now.getTime() - startedAt.getTime();
    if (lateMs < FIFTEEN_MIN_MS) continue; // not due yet

    const clientRow = Array.isArray(booking.client) ? booking.client[0] : booking.client;
    const artistRow = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;

    // ── Pass 1: 15-minute nudge (once) ──
    if (!booking.no_show_reminder_sent) {
      try {
        if (clientRow?.phone && clientRow?.whatsapp_comms_enabled) {
          await notifyNoShowCheck({
            clientPhone: clientRow.phone as string,
            clientName: clientRow.full_name as string,
            artistName: (artistRow?.display_name as string) ?? "your artist",
            rescheduleToken: booking.reschedule_token,
          });
        }
      } catch (e) {
        // Expected to fail until umuhle_no_show_check is an approved
        // template — see lib/whatsapp.ts's notifyNoShowCheck. Logged, not
        // fatal, and not retried once flagged below.
        console.error("[no-show-check] nudge send error:", e);
      }
      await supabase.from("bookings").update({ no_show_reminder_sent: true }).eq("id", booking.id);
      nudged++;
    }

    // ── Pass 2: 60-minute auto-flip ──
    if (lateMs >= SIXTY_MIN_MS) {
      const { error: flipError } = await supabase
        .from("bookings")
        .update({ status: "no_show", no_show_at: now.toISOString(), no_show_party: "client" })
        .eq("id", booking.id)
        .eq("status", "confirmed"); // re-check status hasn't changed since the select above

      if (!flipError) {
        autoFlipped++;
        try {
          await supabase.rpc("record_client_booking_outcome", { p_client_id: booking.client_id, p_outcome: "no_show" });
        } catch (e) {
          console.error("[no-show-check] reliability recording error:", e);
        }
      }
    }
  }

  return NextResponse.json({ scanned: bookings?.length ?? 0, nudged, autoFlipped });
}
