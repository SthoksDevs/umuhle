// app/api/cron/renewal-nudge/route.ts
//
// Daily. Looks a week ahead at booking_renewals due soon, finds the next
// open slot with the *same* artist, and nudges the client to rebook
// before someone else takes it. See lib/whatsapp.ts's notifyRenewalReminder
// for the (not-yet-approved) template this depends on.
//
// Slot-finding reuses the exact same "is this time already booked for
// this artist on this date" check as the homepage booking drawer
// (app/page.tsx) and the reschedule page — a flat TIMES grid checked
// against non-cancelled bookings, no duration-aware overlap logic, same
// simplicity the rest of the booking flow already uses.
//
// NOTE on the rebook link: this currently points at the homepage rather
// than a fully pre-filled, one-tap "same artist/service/slot" booking
// flow — there's no existing deep-link mechanism into the booking drawer
// to hook into yet (the only query-param-driven flow today is the
// payment-retry "resume" intent, which is a different shape of thing).
// Building that one-tap version is a good follow-up; the suggested
// date/time is still communicated in the message text either way.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyRenewalReminder } from "@/lib/whatsapp";
import { TIMES } from "@/lib/booking-times";

const LOOKAHEAD_DAYS = 7; // start looking a week out — still slack to book
const SLOT_SEARCH_DAYS = 14; // how far past due_at to search for an opening

const REBOOK_URL = "https://umuhle.co.za/";

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function findNextAvailableSlot(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  artistId: string,
  fromDate: string
): Promise<{ date: string; time: string } | null> {
  for (let i = 0; i < SLOT_SEARCH_DAYS; i++) {
    const candidateDate = addDays(fromDate, i);
    const { data: taken } = await supabase
      .from("bookings")
      .select("booking_time")
      .eq("artist_id", artistId)
      .eq("booking_date", candidateDate)
      .neq("status", "cancelled");
    const takenTimes = new Set((taken ?? []).map(t => t.booking_time.slice(0, 5)));
    const openTime = TIMES.find(t => !takenTimes.has(t));
    if (openTime) return { date: candidateDate, time: openTime };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const lookaheadDate = addDays(new Date().toISOString().slice(0, 10), LOOKAHEAD_DAYS);

  const { data: due, error } = await supabase
    .from("booking_renewals")
    .select(`
      id, due_at, artist_id, service_id,
      client:profiles!booking_renewals_client_id_fkey(full_name, phone, whatsapp_comms_enabled),
      artist:artists!booking_renewals_artist_id_fkey(display_name),
      service:services(name)
    `)
    .eq("status", "pending")
    .lte("due_at", lookaheadDate);

  if (error) console.error("[renewal-nudge] fetch error:", error);

  let nudged = 0;

  for (const renewal of due ?? []) {
    const slot = await findNextAvailableSlot(supabase, renewal.artist_id, renewal.due_at);
    if (!slot) continue; // no opening yet — stays 'pending', retried next run

    const clientRow = Array.isArray(renewal.client) ? renewal.client[0] : renewal.client;
    const artistRow = Array.isArray(renewal.artist) ? renewal.artist[0] : renewal.artist;
    const serviceRow = Array.isArray(renewal.service) ? renewal.service[0] : renewal.service;

    await supabase
      .from("booking_renewals")
      .update({ status: "nudged", nudge_sent_at: new Date().toISOString(), suggested_date: slot.date, suggested_time: slot.time })
      .eq("id", renewal.id);
    nudged++;

    // Promotional, not transactional — only opted-in clients, and this is
    // checked here (not inside notifyRenewalReminder) same as the file's
    // established convention of leaving that call to the caller.
    if (clientRow?.phone && clientRow?.whatsapp_comms_enabled) {
      try {
        await notifyRenewalReminder({
          clientPhone: clientRow.phone as string,
          clientName: clientRow.full_name as string,
          serviceName: (serviceRow?.name as string) ?? "your usual",
          artistName: (artistRow?.display_name as string) ?? "your artist",
          suggestedDate: slot.date,
          suggestedTime: slot.time,
          rebookUrl: REBOOK_URL,
        });
      } catch (e) {
        // Expected to fail until umuhle_renewal_reminder is approved —
        // logged, not fatal. The row's already flagged 'nudged' above so
        // this won't retry forever once the template exists; a person
        // whose nudge silently failed pre-approval just won't get a
        // second attempt for this cycle, same trade-off as the no-show
        // nudge.
        console.error("[renewal-nudge] send error:", e);
      }
    }
  }

  return NextResponse.json({ scanned: due?.length ?? 0, nudged });
}
