// lib/payments/resume.ts
//
// Resolves where the "Try again" button on /payment/failed and
// /payment/cancelled should send the shopper. Every payment type used to
// hard-code /checkout, which only actually makes sense for `order` — an
// artist booking or store deposit booking sent people to a dead end with
// no way back to the artist/salon they were mid-booking with, forcing them
// to re-find the store/artist and start the whole flow over. See the
// per-type initiate routes (app/api/{ozow,tradesafe}/initiate/route.ts)
// for where `ref` + `type` originate.
//
// `booking` needs no lookup here — the intent id alone is enough for the
// homepage to resolve it (and to fall back gracefully if it's gone), see
// the `resumeBooking` handling in app/page.tsx. `store_booking_deposit`
// does need one, since the salon id isn't otherwise available on this
// page — RLS ("client sees own bookings") scopes this to the current
// user's own row, same as everywhere else this table is read client-side.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveTryAgainHref(
  supabase: SupabaseClient,
  type: string | null,
  ref: string | null
): Promise<string> {
  if (!ref || !type) return "/shop";

  switch (type) {
    case "order":
      return "/checkout";

    case "booking":
      return `/?resumeBooking=${encodeURIComponent(ref)}`;

    case "store_booking_deposit": {
      const { data } = await supabase
        .from("store_bookings")
        .select("salon_id")
        .eq("id", ref)
        .maybeSingle();
      return data?.salon_id
        ? `/stores/${data.salon_id}?resumeBooking=${encodeURIComponent(ref)}`
        : "/stores";
    }

    default:
      // ad / product_listing / salon — no dedicated retry surface for
      // these yet; the dashboard is a saner landing spot than the shop.
      return "/dashboard";
  }
}
