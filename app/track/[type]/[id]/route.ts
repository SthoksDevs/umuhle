// app/track/[type]/[id]/route.ts
//
// A permalink customer-facing emails can safely point to. The existing
// /payment/success|cancelled|failed pages are only meaningful right after a
// gateway redirect — their query params are whatever that one gateway
// happened to send back at that moment. A resent email (see
// /api/cron/resend-emails), or an original one someone opens days later,
// has none of that context anymore.
//
// This route re-derives it: look up the order/booking/etc. by id, check its
// CURRENT status, and 302 to whichever result page actually matches today —
// using the exact same ?ref=&type=&method= convention those pages already
// read (see lib/payfast.ts's return_url construction).
//
// Not authenticated — same as the result pages themselves, which take an id
// in the query string and don't check ownership. This route only ever
// reveals which of three generic states ("it went through" / "it didn't" /
// "still pending") a given id is in, nothing else.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

type TrackType = "order" | "booking" | "ad" | "salon" | "product_listing";
const VALID_TYPES: TrackType[] = ["order", "booking", "ad", "salon", "product_listing"];

function resultUrl(
  origin: string,
  outcome: "success" | "cancelled" | "failed",
  params: { ref: string; type: string; method: string }
) {
  const page = outcome === "success" ? "success" : outcome === "cancelled" ? "cancelled" : "failed";
  const qs = new URLSearchParams({ ref: params.ref, type: params.type, method: params.method });
  return new URL(`/payment/${page}?${qs.toString()}`, origin);
}

export async function GET(request: NextRequest, { params }: { params: { type: string; id: string } }) {
  const { type, id } = params;
  const origin = request.nextUrl.origin;
  const fallback = new URL("/dashboard", origin);

  if (!VALID_TYPES.includes(type as TrackType) || !id) {
    return NextResponse.redirect(fallback);
  }

  const supabase = serviceClient();

  try {
    if (type === "order") {
      const { data: order } = await supabase.from("orders").select("id, status, payment_method").eq("id", id).maybeSingle();
      if (!order) return NextResponse.redirect(fallback);
      const method = order.payment_method ?? "payfast";
      if (["paid", "processing", "shipped", "delivered"].includes(order.status)) {
        return NextResponse.redirect(resultUrl(origin, "success", { ref: id, type, method }));
      }
      if (order.status === "cancelled") {
        return NextResponse.redirect(resultUrl(origin, "cancelled", { ref: id, type, method }));
      }
      return NextResponse.redirect(fallback);
    }

    if (type === "booking") {
      const { data: booking } = await supabase.from("bookings").select("id, status, payment_method").eq("id", id).maybeSingle();
      if (booking) {
        const method = booking.payment_method ?? "payfast";
        if (["confirmed", "in_progress", "completed"].includes(booking.status)) {
          return NextResponse.redirect(resultUrl(origin, "success", { ref: id, type, method }));
        }
        if (["cancelled", "no_show"].includes(booking.status)) {
          return NextResponse.redirect(resultUrl(origin, "cancelled", { ref: id, type, method }));
        }
        return NextResponse.redirect(fallback);
      }

      // No confirmed booking exists — a cancelled/failed payment never
      // creates one (see lib/payments/fulfillment.ts's fulfillBooking), so
      // those emails link here using the booking_intent's id instead.
      const { data: intent } = await supabase
        .from("booking_intents")
        .select("id, status, payment_method")
        .eq("id", id)
        .maybeSingle();
      if (!intent) return NextResponse.redirect(fallback);
      const method = intent.payment_method ?? "payfast";
      if (intent.status === "cancelled") {
        return NextResponse.redirect(resultUrl(origin, "cancelled", { ref: id, type, method }));
      }
      if (intent.status === "failed") {
        return NextResponse.redirect(resultUrl(origin, "failed", { ref: id, type, method }));
      }
      return NextResponse.redirect(fallback);
    }

    if (type === "ad") {
      const { data: ad } = await supabase.from("ads").select("id, status").eq("id", id).maybeSingle();
      if (!ad) return NextResponse.redirect(fallback);
      if (["active", "expired"].includes(ad.status)) {
        return NextResponse.redirect(resultUrl(origin, "success", { ref: id, type, method: "payfast" }));
      }
      if (ad.status === "cancelled") {
        return NextResponse.redirect(resultUrl(origin, "cancelled", { ref: id, type, method: "payfast" }));
      }
      return NextResponse.redirect(fallback);
    }

    if (type === "product_listing") {
      const { data: product } = await supabase.from("products").select("id, listing_status").eq("id", id).maybeSingle();
      if (!product) return NextResponse.redirect(fallback);
      if (["active", "expired"].includes(product.listing_status)) {
        return NextResponse.redirect(resultUrl(origin, "success", { ref: id, type, method: "payfast" }));
      }
      if (product.listing_status === "cancelled") {
        return NextResponse.redirect(resultUrl(origin, "cancelled", { ref: id, type, method: "payfast" }));
      }
      return NextResponse.redirect(fallback);
    }

    // salon
    const { data: payment } = await supabase.from("salon_subscription_payments").select("id, status").eq("id", id).maybeSingle();
    if (!payment) return NextResponse.redirect(fallback);
    if (payment.status === "paid") {
      return NextResponse.redirect(resultUrl(origin, "success", { ref: id, type, method: "payfast" }));
    }
    if (payment.status === "failed") {
      return NextResponse.redirect(resultUrl(origin, "failed", { ref: id, type, method: "payfast" }));
    }
    return NextResponse.redirect(fallback);
  } catch (err) {
    console.error("[track] lookup failed:", err);
    return NextResponse.redirect(fallback);
  }
}
