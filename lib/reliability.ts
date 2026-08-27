// lib/reliability.ts
//
// Shared between app/api/bookings/[id]/status/route.ts (which classifies
// and records outcomes via the record_artist_booking_outcome /
// record_client_booking_outcome Postgres functions — see the 20260827
// migration) and the dashboard's reliability display.

export const LATE_CANCELLATION_WINDOW_HOURS = 24;

// A cancellation is "late" if it happens inside the window before the
// booked appointment time — the client/artist-facing threshold from the
// original brief. `at` defaults to now, but the status route passes an
// explicit timestamp so this stays a pure function.
//
// SAST (Africa/Johannesburg) is UTC+2 year-round — no DST — so the
// explicit +02:00 offset is required here: without it, a date-time string
// with no timezone designator parses as the *runtime's* local time (UTC
// on Vercel), not SAST, which would silently misclassify anything within
// 2 hours of the boundary. Same convention as bookingDateTime() in
// app/api/notifications/route.ts — kept in sync with that, not imported
// from it, since that file also pulls in server-only notification code.
export function isLateCancellation(bookingDate: string, bookingTime: string, at: Date = new Date()): boolean {
  const appointment = new Date(`${bookingDate}T${bookingTime}+02:00`);
  if (Number.isNaN(appointment.getTime())) return false;
  const hoursUntil = (appointment.getTime() - at.getTime()) / (1000 * 60 * 60);
  return hoursUntil < LATE_CANCELLATION_WINDOW_HOURS;
}

// Matches the worked example in the brief: 128 completed, 2 cancellations,
// 0 no-shows -> 98%. Returns null rather than 100 when there's no history
// yet, so the UI can show "Not enough bookings yet" instead of a
// misleadingly perfect score.
export function computeReliabilityScore(completed: number, cancelled: number, noShow: number): number | null {
  const total = completed + cancelled + noShow;
  if (total === 0) return null;
  return Math.round((completed / total) * 100);
}

export interface ReliabilityStanding {
  score: number | null;
  warning: boolean;      // 1st late cancellation or no-show
  visibilityReduced: boolean; // 3+ incidents in 90 days (mirrors artists.visibility_reduced)
  underReview: boolean;  // 5+ incidents in 90 days (mirrors account_status = 'pending_review')
}

export function artistReliabilityStanding(artist: {
  completed_bookings_count: number;
  cancelled_count: number;
  late_cancelled_count: number;
  no_show_count: number;
  visibility_reduced: boolean;
}, accountStatus: string): ReliabilityStanding {
  return {
    score: computeReliabilityScore(artist.completed_bookings_count, artist.cancelled_count, artist.no_show_count),
    warning: artist.late_cancelled_count + artist.no_show_count >= 1,
    visibilityReduced: artist.visibility_reduced,
    underReview: accountStatus === "pending_review",
  };
}
