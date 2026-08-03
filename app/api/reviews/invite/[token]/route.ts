// app/api/reviews/invite/[token]/route.ts
//
// Public, unauthenticated — deliberately so, same reasoning as
// app/api/order-items/confirm/[token]/route.ts: whoever clicks this link
// from an email/WhatsApp message is never logged into Umuhle as that
// specific session. Security comes from the token itself (review_invites.token,
// an unguessable random UUID) rather than a session — see lib/review-invites.ts.
//
// This is the unauthenticated counterpart to POST /api/reviews (which still
// requires a live session and is used by the dashboard's ReviewModal). Both
// ultimately write to the same `reviews` table and are subject to the same
// database constraints, so a booking/order-item/salon reviewed via one path
// can't also be double-reviewed via the other.
//
// GET  -> display info for the review landing page (who/what is being
//         reviewed, and whether this invite has already been used).
// POST -> submits the review. Every identity/target field (reviewer_id,
//         reviewed_id, booking_id, artist_id, product_id, salon_id,
//         order_item_id) comes from the invite row itself, NEVER from the
//         request body — the client can only supply rating + comment.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_COMMENT_LENGTH = 500;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

type Invite = {
  token: string;
  review_type: "client_to_artist" | "artist_to_client" | "client_to_salon" | "client_to_product";
  reviewer_id: string;
  reviewed_id: string;
  booking_id: string | null;
  order_item_id: string | null;
  salon_id: string | null;
};

const first = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const service = serviceClient();

  const { data: invite, error } = await service
    .from("review_invites")
    .select("token, review_type, reviewer_id, reviewed_id, booking_id, order_item_id, salon_id")
    .eq("token", params.token)
    .single<Invite>();

  if (error || !invite) {
    return NextResponse.json({ error: "This review link isn't valid." }, { status: 404 });
  }

  let targetName = "";
  let targetImage: string | null = null;
  let subtitle: string | null = null;
  let alreadyReviewed = false;
  let productItems: Array<{ token: string; targetName: string; targetImage: string | null }> = [];

  if (invite.review_type === "client_to_artist" || invite.review_type === "artist_to_client") {
    const { data: booking } = await service
      .from("bookings")
      .select(`
        id,
        service:services(name),
        client:profiles!bookings_client_id_fkey(full_name, avatar_url),
        artist:artists(display_name, avatar_url)
      `)
      .eq("id", invite.booking_id!)
      .single();

    const service_ = first(booking?.service);
    const client = first(booking?.client);
    const artist = first(booking?.artist);

    if (invite.review_type === "client_to_artist") {
      targetName = artist?.display_name ?? "your artist";
      targetImage = artist?.avatar_url ?? null;
    } else {
      targetName = client?.full_name ?? "your client";
      targetImage = client?.avatar_url ?? null;
    }
    subtitle = service_?.name ?? null;

    const { data: existing } = await service
      .from("reviews")
      .select("id")
      .eq("booking_id", invite.booking_id!)
      .eq("reviewer_id", invite.reviewer_id)
      .maybeSingle();
    alreadyReviewed = Boolean(existing);
  }

  else if (invite.review_type === "client_to_product") {
    const { data: item } = await service
      .from("order_items")
      .select("product:products(name, image_url)")
      .eq("id", invite.order_item_id!)
      .single();

    const product = first(item?.product);
    targetName = product?.name ?? "this product";
    targetImage = product?.image_url ?? null;

    const { data: existing } = await service
      .from("reviews")
      .select("id")
      .eq("order_item_id", invite.order_item_id!)
      .eq("reviewer_id", invite.reviewer_id)
      .maybeSingle();
    alreadyReviewed = Boolean(existing);

    // Full pending list for this reviewer, not just this one token — see
    // app/api/cron/review-invites/route.ts, which now sends one digest
    // link per customer covering every unreviewed product at once rather
    // than a separate email per item.
    const { data: siblingInvites } = await service
      .from("review_invites")
      .select("token, order_item_id")
      .eq("review_type", "client_to_product")
      .eq("reviewer_id", invite.reviewer_id);

    const siblingItemIds = Array.from(
      new Set((siblingInvites ?? []).map((s) => s.order_item_id).filter((id): id is string => Boolean(id)))
    );

    const [{ data: siblingProducts }, { data: siblingReviews }] = await Promise.all([
      siblingItemIds.length
        ? service.from("order_items").select("id, product:products(name, image_url)").in("id", siblingItemIds)
        : Promise.resolve({ data: [] as Array<{ id: string; product: unknown }> }),
      siblingItemIds.length
        ? service.from("reviews").select("order_item_id").eq("reviewer_id", invite.reviewer_id).in("order_item_id", siblingItemIds)
        : Promise.resolve({ data: [] as Array<{ order_item_id: string | null }> }),
    ]);

    const reviewedItemIds = new Set((siblingReviews ?? []).map((r) => r.order_item_id));
    const productById = new Map(
      (siblingProducts ?? []).map((row) => [
        row.id,
        first(row.product) as { name: string | null; image_url: string | null } | null,
      ])
    );

    productItems = (siblingInvites ?? [])
      .filter((s) => s.order_item_id && !reviewedItemIds.has(s.order_item_id))
      .map((s) => {
        const p = productById.get(s.order_item_id!);
        return {
          token: s.token,
          targetName: p?.name ?? "this product",
          targetImage: p?.image_url ?? null,
        };
      });
  }

  else if (invite.review_type === "client_to_salon") {
    const { data: salon } = await service
      .from("partner_salons")
      .select("name, gallery_urls")
      .eq("id", invite.salon_id!)
      .single();

    targetName = salon?.name ?? "this salon";
    targetImage = salon?.gallery_urls?.[0] ?? null;

    const { data: existing } = await service
      .from("reviews")
      .select("id")
      .eq("salon_id", invite.salon_id!)
      .eq("reviewer_id", invite.reviewer_id)
      .maybeSingle();
    alreadyReviewed = Boolean(existing);
  }

  return NextResponse.json({
    reviewType: invite.review_type,
    targetName,
    targetImage,
    subtitle,
    alreadyReviewed,
    ...(invite.review_type === "client_to_product" ? { productItems } : {}),
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;

  const body = await req.json().catch(() => null);
  const rating = Number(body?.rating);
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, MAX_COMMENT_LENGTH) : null;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "A star rating from 1 to 5 is required." }, { status: 400 });
  }

  const service = serviceClient();

  const { data: invite, error } = await service
    .from("review_invites")
    .select("token, review_type, reviewer_id, reviewed_id, booking_id, order_item_id, salon_id")
    .eq("token", params.token)
    .single<Invite>();

  if (error || !invite) {
    return NextResponse.json({ error: "This review link isn't valid." }, { status: 404 });
  }

  const insertPayload: Record<string, unknown> = {
    reviewer_id: invite.reviewer_id,
    reviewed_id: invite.reviewed_id,
    review_type: invite.review_type,
    rating,
    comment,
  };

  if (invite.review_type === "client_to_artist" || invite.review_type === "artist_to_client") {
    const { data: booking } = await service
      .from("bookings")
      .select("artist_id")
      .eq("id", invite.booking_id!)
      .single();
    insertPayload.booking_id = invite.booking_id;
    insertPayload.artist_id = booking?.artist_id ?? null;
  } else if (invite.review_type === "client_to_product") {
    const { data: item } = await service
      .from("order_items")
      .select("product_id")
      .eq("id", invite.order_item_id!)
      .single();
    insertPayload.order_item_id = invite.order_item_id;
    insertPayload.product_id = item?.product_id ?? null;
  } else if (invite.review_type === "client_to_salon") {
    insertPayload.salon_id = invite.salon_id;
  }

  const { data: review, error: insertError } = await service
    .from("reviews")
    .insert(insertPayload)
    .select("id, rating, comment, review_type, created_at")
    .single();

  if (insertError) {
    // unique_violation — one of reviews_booking_reviewer_unique,
    // reviews_order_item_reviewer_unique, reviews_salon_reviewer_unique.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "You've already submitted a review for this." }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ review });
}
