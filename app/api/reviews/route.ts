// app/api/reviews/route.ts
//
// Peer review system — bookings work both ways, so once a booking is
// "completed" either side can review the other (client -> artist,
// artist -> client), same idea as Bolt rating both driver and rider.
//
// The `reviews` table and `artists.rating` / `artists.review_count`
// already existed in the schema (planned ahead of time); this wires up
// the actual read/write paths. Keeping `artists.rating` in sync happens
// entirely in Postgres via a trigger — see
// supabase/migrations/20260711_reviews_system.sql — so it's correct no
// matter what writes the row (this route, a future admin tool, etc).
//
// Every query here goes through the service-role client rather than the
// caller's own session. Two reasons: (1) the caller's role on a booking
// can be either the client OR the artist, and we don't know which
// `bookings`/`artists` RLS currently allows for anon-key reads on
// someone else's row; (2) the moderation/visibility rules (only
// approved client_to_artist reviews are public) are simplest to enforce
// once, here, rather than in a policy. Identity itself still comes from
// the caller's own cookie session (`auth.getUser()`), so nothing here
// trusts client-supplied user/role data.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const MAX_COMMENT_LENGTH = 500;
const NOT_REBOOK_REASONS = ["price", "quality", "punctuality", "communication", "cleanliness", "other"] as const;

export async function POST(req: NextRequest) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in to leave a review." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : undefined;
  const rating = Number(body?.rating);
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, MAX_COMMENT_LENGTH) : null;

  // Satisfaction survey — only meaningful for client_to_artist, enforced
  // below once we know reviewType. All optional; skipping any of them
  // (e.g. no rebookIntervalDays) is a valid, common answer, not an error.
  const wouldRebook = typeof body?.wouldRebook === "boolean" ? body.wouldRebook : null;
  const notRebookReason = NOT_REBOOK_REASONS.includes(body?.notRebookReason) ? body.notRebookReason : null;
  const rebookIntervalDays = Number.isInteger(body?.rebookIntervalDays) && body.rebookIntervalDays > 0 && body.rebookIntervalDays <= 730
    ? body.rebookIntervalDays : null;
  const npsScore = Number.isInteger(body?.npsScore) && body.npsScore >= 0 && body.npsScore <= 10 ? body.npsScore : null;

  if (!bookingId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "A booking and a star rating from 1 to 5 are required." }, { status: 400 });
  }

  const service = await createServiceClient();

  const { data: booking } = await service
    .from("bookings")
    .select("id, status, client_id, artist_id, service_id, completed_at, artist:artists(profile_id)")
    .eq("id", bookingId)
    .single();

  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (booking.status !== "completed") {
    return NextResponse.json({ error: "You can only leave a review once the booking is completed." }, { status: 400 });
  }

  const artistRow = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;

  let reviewType: "client_to_artist" | "artist_to_client";
  let revieweeId: string | undefined;

  if (booking.client_id === user.id) {
    reviewType = "client_to_artist";
    revieweeId = artistRow?.profile_id;
  } else if (artistRow?.profile_id === user.id) {
    reviewType = "artist_to_client";
    revieweeId = booking.client_id;
  } else {
    return NextResponse.json({ error: "You weren't part of this booking." }, { status: 403 });
  }

  if (!revieweeId) {
    return NextResponse.json({ error: "Couldn't determine who this review is for." }, { status: 400 });
  }

  const { data: review, error } = await service
    .from("reviews")
    .insert({
      booking_id: bookingId,
      reviewer_id: user.id,
      reviewed_id: revieweeId,
      artist_id: booking.artist_id,
      rating,
      comment,
      review_type: reviewType,
      // reviews_survey_scope_check requires these to be null for anything
      // other than client_to_artist — only send them through on that path.
      ...(reviewType === "client_to_artist" ? {
        would_rebook: wouldRebook,
        not_rebook_reason: notRebookReason,
        rebook_interval_days: rebookIntervalDays,
        nps_score: npsScore,
      } : {}),
    })
    .select("id, rating, comment, review_type, created_at")
    .single();

  if (error) {
    // unique_violation — reviews_booking_reviewer_unique (one review per person per booking)
    if (error.code === "23505") {
      return NextResponse.json({ error: "You've already reviewed this booking." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Loyalty rebooking engine — a renewal row only gets created when the
  // client actually gave an interval (skipping the question, or a "no" on
  // would_rebook with no interval, means don't nudge them). Best-effort:
  // this shouldn't block the review response if it fails.
  if (reviewType === "client_to_artist" && rebookIntervalDays && booking.completed_at) {
    try {
      const dueAt = new Date(booking.completed_at);
      dueAt.setDate(dueAt.getDate() + rebookIntervalDays);
      await service.from("booking_renewals").insert({
        client_id: user.id,
        artist_id: booking.artist_id,
        service_id: booking.service_id,
        source_booking_id: bookingId,
        review_id: review.id,
        interval_days: rebookIntervalDays,
        due_at: dueAt.toISOString().slice(0, 10),
      });
    } catch (e) {
      console.error("[reviews] booking_renewals insert error:", e);
    }
  }

  return NextResponse.json({ review });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const service = await createServiceClient();

  // ── Public reviews for an artist (shown in the booking drawer) ──────────
  const artistId = searchParams.get("artistId");
  if (artistId) {
    const limitParam = Number(searchParams.get("limit"));
    const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10, 50);

    const { data, error } = await service
      .from("reviews")
      .select("id, rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(full_name, avatar_url)")
      .eq("artist_id", artistId)
      .eq("review_type", "client_to_artist")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ reviews: data ?? [] });
  }

  // ── Public reviews for a salon (shown on the store detail page) ─────────
  const salonId = searchParams.get("salonId");
  if (salonId) {
    const limitParam = Number(searchParams.get("limit"));
    const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10, 50);

    const { data, error } = await service
      .from("reviews")
      .select("id, rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(full_name, avatar_url)")
      .eq("salon_id", salonId)
      .eq("review_type", "client_to_salon")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ reviews: data ?? [] });
  }

  // ── Public reviews for a product (shown on the product detail page) ─────
  const productId = searchParams.get("productId");
  if (productId) {
    const limitParam = Number(searchParams.get("limit"));
    const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10, 50);

    const { data, error } = await service
      .from("reviews")
      .select("id, rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(full_name, avatar_url)")
      .eq("product_id", productId)
      .eq("review_type", "client_to_product")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ reviews: data ?? [] });
  }

  // ── "Have I already reviewed these bookings?" (for button state) ────────
  const bookingIdsParam = searchParams.get("bookingIds");
  if (bookingIdsParam) {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const bookingIds = bookingIdsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 100);
    if (bookingIds.length === 0) return NextResponse.json({ reviews: {} });

    const { data, error } = await service
      .from("reviews")
      .select("booking_id, rating, comment, created_at")
      .eq("reviewer_id", user.id)
      .in("booking_id", bookingIds);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const reviews: Record<string, { rating: number; comment: string | null; created_at: string }> = {};
    for (const r of data ?? []) reviews[r.booking_id] = { rating: r.rating, comment: r.comment, created_at: r.created_at };
    return NextResponse.json({ reviews });
  }

  return NextResponse.json({ error: "artistId, salonId, productId, or bookingIds query param required" }, { status: 400 });
}
