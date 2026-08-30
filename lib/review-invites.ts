// lib/review-invites.ts
//
// Creates the capability tokens behind the unauthenticated review-submission
// landing page (/review/[token] -> app/api/reviews/invite/[token]).
//
// Why a token instead of plain ?userId=&itemId= query params: this still
// works as a single GET link with no login, but the reviewer's identity and
// the thing being reviewed are resolved server-side from an opaque row
// instead of being editable text in the URL. Same trust model already used
// for order_items.confirm_token (see app/api/order-items/confirm/[token]) --
// the token itself, an unguessable random UUID, IS the credential.
//
// See supabase/migrations/20260729_review_invites.sql for the table and its
// target-shape check constraint (mirrors reviews_target_shape_check on the
// `reviews` table itself).

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReviewType = "client_to_artist" | "artist_to_client" | "client_to_salon" | "client_to_product";

type CreateReviewInviteOpts =
  | { reviewType: "client_to_artist" | "artist_to_client"; reviewerId: string; reviewedId: string; bookingId: string }
  | { reviewType: "client_to_product"; reviewerId: string; reviewedId: string; orderItemId: string }
  | { reviewType: "client_to_salon"; reviewerId: string; reviewedId: string; salonId: string; storeBookingId: string; branchId: string };

/**
 * Inserts a review_invites row and returns its token (the URL-ready id), or
 * null if the insert failed -- callers should treat that as "couldn't send
 * the review link this time" and log it, not block whatever completion flow
 * they're in the middle of (see call sites in bookings/[id]/status,
 * order-items/confirm/[token], store-bookings/[id]/status).
 */
export async function createReviewInvite(
  supabase: SupabaseClient,
  opts: CreateReviewInviteOpts
): Promise<string | null> {
  const { data, error } = await supabase
    .from("review_invites")
    .insert({
      review_type:      opts.reviewType,
      reviewer_id:      opts.reviewerId,
      reviewed_id:      opts.reviewedId,
      booking_id:       "bookingId" in opts ? opts.bookingId : null,
      order_item_id:    "orderItemId" in opts ? opts.orderItemId : null,
      salon_id:         "salonId" in opts ? opts.salonId : null,
      store_booking_id: "storeBookingId" in opts ? opts.storeBookingId : null,
      branch_id:        "branchId" in opts ? opts.branchId : null,
    })
    .select("token")
    .single();

  if (error || !data) {
    console.error("[review-invites] failed to create invite:", error);
    return null;
  }
  return data.token as string;
}

/** Public review-submission URL for a given invite token. */
export function buildReviewUrl(token: string): string {
  return `https://umuhle.co.za/review/${token}`;
}
