// lib/find-available-slot.ts
//
// Factored out of app/api/cron/renewal-nudge/route.ts so app/api/renewals/
// [id]/route.ts (the rebook deep-link) can re-verify availability at
// click-time with the exact same logic, rather than trusting a
// suggested_date/time that could be days stale by the time someone taps
// the link — the whole point of "book now before it's taken" is that the
// slot might genuinely be gone by then.
//
// Server-only (takes a Supabase client) — deliberately kept out of
// lib/booking-times.ts, which stays a zero-dependency file safe to import
// from client components (see app/reschedule/[token]/page.tsx).

import type { SupabaseClient } from "@supabase/supabase-js";
import { TIMES } from "@/lib/booking-times";

const SLOT_SEARCH_DAYS = 14;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function findNextAvailableSlot(
  supabase: SupabaseClient,
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
    const takenTimes = new Set((taken ?? []).map((t: { booking_time: string }) => t.booking_time.slice(0, 5)));
    const openTime = TIMES.find(t => !takenTimes.has(t));
    if (openTime) return { date: candidateDate, time: openTime };
  }
  return null;
}
