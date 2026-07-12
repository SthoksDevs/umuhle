// lib/payments/fulfillment.ts
//
// The "what happens after a payment" decisions for every payment type on
// Umuhle — booking, shop order, ad, salon subscription, product listing.
//
// This used to live entirely inside app/api/payfast/notify/route.ts,
// because PayFast was the only gateway that handled anything beyond plain
// shop orders. HappyPay and Ozow each grew their own smaller, slightly
// diverging copy of just the order logic (HappyPay's copy was missing
// stock decrement and the order-paid email — see fulfillOrder() below).
//
// This file is the single version of the truth now. Every gateway's
// webhook route does ONLY gateway-specific transport — verify a signature
// or secret, translate that gateway's field names into a PaymentEvent (see
// ./types) — and then calls fulfillPayment() below. Nothing in this file
// imports lib/payfast, lib/happypay, or lib/ozow, and nothing in here knows
// what an ITN, a HashCheck, or a webhook secret is. That's what makes a
// gateway safe to pause (lib/payments/gateways.ts) or eventually remove
// entirely without touching a single decision made in here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentEvent, FulfillmentResult } from "./types";
import { recordBookingSplit, recordOrderItemSplits } from "@/lib/payouts";
import { notifyBookingCreated, notifyOrderPaid } from "@/lib/whatsapp";
import {
  sendBookingConfirmedEmail,
  sendBookingFailedEmail,
  sendOrderPaidEmail,
  sendOrderFailedEmail,
  sendAdPaidEmail,
  sendSalonPaidEmail,
  sendProductListingPaidEmail,
} from "@/lib/email";
import { LISTING_PACKAGES } from "@/types";

const WEEKS: Record<string, number> = { starter: 6, growth: 12, business: 16, premium: 24 };
const AD_COUNTS: Record<string, number> = { starter: 1, growth: 3, business: 6, premium: 10 };
const DURATION_LABELS: Record<string, string> = {
  starter: "6 weeks", growth: "3 months", business: "4 months", premium: "6 months",
};

/**
 * Only PayFast currently writes its own payment id onto the
 * booking/ad/product/salon-subscription rows themselves (the
 * `payfast_payment_id` columns). Those columns predate multi-gateway
 * support and are still named after PayFast specifically, so we only
 * populate them for PayFast events rather than putting e.g. a HappyPay
 * order id in a column called payfast_payment_id.
 *
 * This isn't a functional gap today — HappyPay/Ozow don't sell bookings,
 * ads, salon subscriptions, or listings yet, only shop orders (see the
 * initiate routes) — but it means nothing needs fixing here if that
 * changes; the natural companion change at that point is a small migration
 * generalizing those columns, done together with whatever adds initiate
 * support for the new type+gateway combination.
 */
function legacyPayfastColumn(event: PaymentEvent): { payfast_payment_id: string | null } | Record<string, never> {
  return event.gateway === "payfast" ? { payfast_payment_id: event.gatewayPaymentId ?? null } : {};
}

/**
 * Single entry point for every gateway's webhook/notify route. Never
 * throws — internal errors are caught and returned as { ok: false } — so a
 * route can always safely acknowledge the gateway's callback. Most
 * gateways retry forever on anything other than the response they expect,
 * and a dropped acknowledgement is a worse outcome than a logged failure.
 */
export async function fulfillPayment(
  supabase: SupabaseClient,
  event: PaymentEvent
): Promise<FulfillmentResult> {
  const tag = `[payments:${event.gateway}→${event.type}:${event.outcome}]`;
  console.log(`${tag} ref=${event.referenceId}${event.gatewayPaymentId ? ` gatewayRef=${event.gatewayPaymentId}` : ""}`);

  try {
    switch (event.type) {
      case "booking":
        return await fulfillBooking(supabase, event, tag);
      case "order":
        return await fulfillOrder(supabase, event, tag);
      case "ad":
        return await fulfillAd(supabase, event, tag);
      case "product_listing":
        return await fulfillProductListing(supabase, event, tag);
      case "salon":
        return await fulfillSalon(supabase, event, tag);
      default: {
        const exhaustiveCheck: never = event.type;
        console.warn(`${tag} unknown payment type`, exhaustiveCheck);
        return { ok: false, message: "Unknown payment type" };
      }
    }
  } catch (err) {
    console.error(`${tag} unhandled error`, err);
    return { ok: false, message: "Internal error while fulfilling payment" };
  }
}

// ── Booking ──────────────────────────────────────────────────────────────────
// paid    → create the real booking from its booking_intent, record the
//           commission split, notify by WhatsApp + email.
// cancelled/failed → close out the intent, no booking is ever created.

async function fulfillBooking(supabase: SupabaseClient, event: PaymentEvent, tag: string): Promise<FulfillmentResult> {
  if (event.outcome === "paid") {
    const { data: intent } = await supabase
      .from("booking_intents")
      .select("*")
      .eq("id", event.referenceId)
      .eq("status", "pending")
      .single();

    if (!intent) {
      console.warn(`${tag} booking intent not found or already processed`, event.referenceId);
      return { ok: true, message: "Already processed or unknown intent" };
    }

    await supabase.from("booking_intents").update({ status: "completed" }).eq("id", event.referenceId);

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .insert({
        client_id: intent.client_id,
        artist_id: intent.artist_id,
        service_id: intent.service_id,
        booking_date: intent.booking_date,
        booking_time: intent.booking_time,
        meeting_address: intent.meeting_address,
        status: "confirmed",
        total_amount: intent.total_amount,
        notes: intent.notes,
        client_poc_name: intent.client_poc_name,
        client_poc_phone: intent.client_poc_phone,
        artist_poc_name: intent.artist_poc_name,
        artist_poc_phone: intent.artist_poc_phone,
        ...legacyPayfastColumn(event),
      })
      .select(`
        id, booking_date, booking_time, meeting_address, notes, total_amount,
        client:profiles!bookings_client_id_fkey(full_name, phone, email),
        artist:artists!bookings_artist_id_fkey(
          display_name, point_of_contact_name, point_of_contact_phone,
          profile:profiles!artists_profile_id_fkey(phone)
        ),
        service:services(name, duration_minutes)
      `)
      .single();

    if (bookingErr || !booking) {
      console.error(`${tag} failed to create booking from intent`, bookingErr);
      return { ok: false, message: "Failed to create booking from intent" };
    }

    // Record the 5.5% commission / 94.5% artist payout split now, at the
    // point of sale. This does NOT touch the artist's wallet yet — that
    // only happens once the booking is marked "completed" (see
    // lib/payouts.ts and /api/bookings/[id]/status).
    try {
      await recordBookingSplit(supabase, booking.id, booking.total_amount);
    } catch (e) {
      console.error(`${tag} failed to record booking commission split`, e);
    }

    const clientRow = Array.isArray(booking.client) ? booking.client[0] : booking.client;
    const artistRow = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;
    const serviceRow = Array.isArray(booking.service) ? booking.service[0] : booking.service;
    const artistProfileRow = Array.isArray(artistRow?.profile) ? artistRow.profile[0] : artistRow?.profile;

    const clientPhone = clientRow?.phone as string | undefined;
    const artistPhone = artistProfileRow?.phone as string | undefined;

    if (clientPhone && artistPhone) {
      try {
        await notifyBookingCreated({
          clientName: clientRow.full_name as string,
          clientPhone,
          artistName: artistRow.display_name as string,
          artistPhone,
          date: booking.booking_date,
          time: booking.booking_time,
          serviceName: serviceRow?.name as string,
          meetingAddress: booking.meeting_address ?? undefined,
          expectedDuration: serviceRow?.duration_minutes ?? undefined,
        });
      } catch (e) {
        console.error(`${tag} WhatsApp notify error`, e);
      }
    }

    // Admin + customer email — MUST be awaited. Vercel kills the function
    // as soon as the route handler returns, so a fire-and-forget promise
    // here never gets to finish its SMTP handshake.
    try {
      await sendBookingConfirmedEmail({
        bookingId: booking.id,
        clientName: (clientRow?.full_name as string) ?? "Unknown",
        clientEmail: (clientRow?.email as string) ?? "",
        artistName: (artistRow?.display_name as string) ?? "Unknown",
        serviceName: (serviceRow?.name as string) ?? "Service",
        date: booking.booking_date,
        time: booking.booking_time,
        amount: booking.total_amount,
        meetingAddress: booking.meeting_address ?? undefined,
      });
    } catch (e) {
      console.error(`${tag} booking confirmed email error`, e);
    }

    return { ok: true, message: "Booking created" };
  }

  // cancelled / failed — no booking was ever created, just close out the intent.
  const { data: intent } = await supabase
    .from("booking_intents")
    .update({ status: event.outcome === "cancelled" ? "cancelled" : "failed" })
    .eq("id", event.referenceId)
    .eq("status", "pending")
    .select(`*, client:profiles!booking_intents_client_id_fkey(full_name, email), service:services(name)`)
    .single();

  if (!intent) return { ok: true, message: "Already processed or unknown intent" };

  const clientRow = Array.isArray(intent.client) ? intent.client[0] : intent.client;
  const serviceRow = Array.isArray(intent.service) ? intent.service[0] : intent.service;

  try {
    await sendBookingFailedEmail({
      bookingId: event.referenceId,
      clientName: clientRow?.full_name ?? "Unknown",
      clientEmail: clientRow?.email ?? "",
      serviceName: serviceRow?.name ?? "Service",
      date: intent.booking_date,
      time: intent.booking_time,
      amount: intent.total_amount,
      reason: event.outcome,
    });
  } catch (e) {
    console.error(`${tag} booking failed email error`, e);
  }

  return { ok: true, message: `Booking intent marked ${event.outcome}` };
}

// ── Order (shop / marketplace products) ─────────────────────────────────────
// paid    → mark paid, decrement stock, record commission split, email +
//           WhatsApp the customer.
// cancelled/failed → mark cancelled (orders has no separate "failed"
//           status — see supabase/schema.sql), email the customer.
//
// This is the one that unifies real behavioural differences between
// gateways, not just code style: PayFast and Ozow already decremented
// stock and sent the proper order-paid email; HappyPay's own webhook did
// neither, and used an ad-hoc WhatsApp message instead of notifyOrderPaid.
// Routing all three through this single function fixes that gap rather
// than just relocating it.

async function fulfillOrder(supabase: SupabaseClient, event: PaymentEvent, tag: string): Promise<FulfillmentResult> {
  const { data: order } = await supabase
    .from("orders")
    .select(`
      id, status, total_amount, shipping_address,
      client:profiles!orders_client_id_fkey(full_name, email, phone)
    `)
    .eq("id", event.referenceId)
    .single();

  if (!order) {
    console.warn(`${tag} order not found`, event.referenceId);
    return { ok: true, message: "Order not found" };
  }
  if (order.status !== "pending_payment") {
    // Every gateway here retries notifications — stay idempotent.
    console.log(`${tag} order already processed, status=${order.status}`);
    return { ok: true, message: "Already processed" };
  }

  const clientRow = Array.isArray(order.client) ? order.client[0] : order.client;

  if (event.outcome === "paid") {
    const { data: orderItems } = await supabase
      .from("order_items")
      .select("product_id, quantity, unit_price, product:products(name)")
      .eq("order_id", event.referenceId);

    await supabase
      .from("orders")
      .update({
        status: "paid",
        ...(event.gatewayPaymentId ? { gateway_order_id: event.gatewayPaymentId } : {}),
        ...legacyPayfastColumn(event),
      })
      .eq("id", event.referenceId)
      .eq("status", "pending_payment");

    if (orderItems) {
      for (const item of orderItems) {
        await supabase.rpc("decrement_stock", { p_product_id: item.product_id, p_qty: item.quantity });
      }
    }

    // Record each item's 5.5% commission / 94.5% partner payout split now
    // that payment has cleared. Wallets aren't credited until the order is
    // later marked "delivered" — see lib/payouts.ts.
    try {
      await recordOrderItemSplits(supabase, event.referenceId);
    } catch (e) {
      console.error(`${tag} failed to record order commission split`, e);
    }

    try {
      await sendOrderPaidEmail({
        orderId: event.referenceId,
        clientName: clientRow?.full_name ?? "Unknown",
        clientEmail: clientRow?.email ?? "",
        totalAmount: order.total_amount,
        shippingAddress: order.shipping_address ?? undefined,
        items: (orderItems ?? []).map((i) => ({
          name: (Array.isArray(i.product) ? i.product[0] : i.product)?.name ?? "Product",
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
    } catch (e) {
      console.error(`${tag} order paid email error`, e);
    }

    if (clientRow?.phone) {
      try {
        await notifyOrderPaid({
          clientName: clientRow.full_name ?? "there",
          clientPhone: clientRow.phone,
          orderId: event.referenceId,
          itemCount: orderItems?.length ?? 0,
          totalAmount: order.total_amount,
          paymentMethod: event.gateway,
        });
      } catch (e) {
        console.error(`${tag} WhatsApp notify error`, e);
      }
    }

    return { ok: true, message: "Order marked paid" };
  }

  // cancelled / failed
  await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", event.referenceId)
    .eq("status", "pending_payment");

  try {
    await sendOrderFailedEmail({
      orderId: event.referenceId,
      clientName: clientRow?.full_name ?? "Unknown",
      clientEmail: clientRow?.email ?? "",
      totalAmount: order.total_amount,
      reason: event.outcome,
    });
  } catch (e) {
    console.error(`${tag} order failed email error`, e);
  }

  return { ok: true, message: `Order marked ${event.outcome}` };
}

// ── Ad ───────────────────────────────────────────────────────────────────────
// paid only — a failed/cancelled ad payment leaves the ad sitting in
// pending_payment with no notification. That matches the pre-existing
// behaviour (there's no sendAdFailedEmail template yet), so it's preserved
// rather than silently changed here.

async function fulfillAd(supabase: SupabaseClient, event: PaymentEvent, tag: string): Promise<FulfillmentResult> {
  if (event.outcome !== "paid") {
    return { ok: true, message: `No action for ad outcome=${event.outcome}` };
  }

  const now = new Date();
  const { data: ad } = await supabase
    .from("ads")
    .select("package, price, partner_id, partner:profiles!partner_id(full_name, email)")
    .eq("id", event.referenceId)
    .eq("status", "pending_payment") // guards a duplicate notification from re-sending the paid email
    .single();

  if (!ad) {
    console.warn(`${tag} ad not found or already processed`, event.referenceId);
    return { ok: true, message: "Already processed or unknown ad" };
  }

  const pkg = ad.package ?? "starter";
  const weeks = WEEKS[pkg] ?? 6;
  const expiresAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  await supabase
    .from("ads")
    .update({
      status: "active",
      starts_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      moderation_status: "scanning",
      ...legacyPayfastColumn(event),
    })
    .eq("id", event.referenceId)
    .eq("status", "pending_payment");

  const partnerRow = Array.isArray(ad.partner) ? ad.partner[0] : ad.partner;
  try {
    await sendAdPaidEmail({
      adId: event.referenceId,
      clientName: (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
      clientEmail: (partnerRow as { email: string } | undefined)?.email ?? "",
      packageName: pkg.charAt(0).toUpperCase() + pkg.slice(1),
      adsCount: AD_COUNTS[pkg] ?? 1,
      durationLabel: DURATION_LABELS[pkg] ?? `${weeks} weeks`,
      amount: ad.price ?? 0,
    });
  } catch (e) {
    console.error(`${tag} ad paid email error`, e);
  }

  return { ok: true, message: "Ad activated" };
}

// ── Product listing ──────────────────────────────────────────────────────────
// Same shape as fulfillAd above — same packages, same durations — just
// updating `products` (+ creating a listing_packages credit bank) instead
// of `ads`. paid only, same rationale as fulfillAd.

async function fulfillProductListing(supabase: SupabaseClient, event: PaymentEvent, tag: string): Promise<FulfillmentResult> {
  if (event.outcome !== "paid") {
    return { ok: true, message: `No action for product_listing outcome=${event.outcome}` };
  }

  const now = new Date();
  const { data: product } = await supabase
    .from("products")
    .select("package, name, partner_id, moderation_status, partner:profiles!partner_id(full_name, email)")
    .eq("id", event.referenceId)
    .eq("listing_status", "pending_payment")
    .single();

  if (!product) {
    console.warn(`${tag} product not found or already processed`, event.referenceId);
    return { ok: true, message: "Already processed or unknown product" };
  }

  const pkg = product.package ?? "starter";
  const weeks = WEEKS[pkg] ?? 6;
  const slotsTotal = LISTING_PACKAGES.find((p) => p.id === pkg)?.ads ?? 1;
  const expiresAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: pkgRow } = await supabase
    .from("listing_packages")
    .insert({
      partner_id: product.partner_id,
      package: pkg,
      weeks,
      slots_total: slotsTotal,
      slots_used: 1, // this payment's product consumes the first slot immediately
      status: "active",
      purchased_at: now.toISOString(),
      ...legacyPayfastColumn(event),
    })
    .select("id")
    .single();

  await supabase
    .from("products")
    .update({
      listing_status: "active",
      listing_package_id: pkgRow?.id ?? null,
      starts_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      is_active: product.moderation_status === "approved",
      ...legacyPayfastColumn(event),
    })
    .eq("id", event.referenceId)
    .eq("listing_status", "pending_payment");

  const partnerRow = Array.isArray(product.partner) ? product.partner[0] : product.partner;
  try {
    await sendProductListingPaidEmail({
      productId: event.referenceId,
      productName: product.name,
      clientName: (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
      clientEmail: (partnerRow as { email: string } | undefined)?.email ?? "",
      packageName: pkg.charAt(0).toUpperCase() + pkg.slice(1),
      durationLabel: DURATION_LABELS[pkg] ?? `${weeks} weeks`,
      slotsTotal,
      amount: LISTING_PACKAGES.find((p) => p.id === pkg)?.price ?? 2000,
    });
  } catch (e) {
    console.error(`${tag} product listing paid email error`, e);
  }

  return { ok: true, message: "Product listing activated" };
}

// ── Salon subscription ───────────────────────────────────────────────────────
// paid only, same rationale as fulfillAd.

async function fulfillSalon(supabase: SupabaseClient, event: PaymentEvent, tag: string): Promise<FulfillmentResult> {
  if (event.outcome !== "paid") {
    return { ok: true, message: `No action for salon outcome=${event.outcome}` };
  }

  const now = new Date();
  const oneYear = new Date(now);
  oneYear.setFullYear(oneYear.getFullYear() + 1);

  const { data: payment } = await supabase
    .from("salon_subscription_payments")
    .update({
      status: "paid",
      ...legacyPayfastColumn(event),
    })
    .eq("id", event.referenceId)
    .eq("status", "pending")
    .select("salon_id, amount, partner:profiles!partner_id(full_name, email)")
    .single();

  if (!payment?.salon_id) {
    console.warn(`${tag} salon payment not found or already processed`, event.referenceId);
    return { ok: true, message: "Already processed or unknown salon payment" };
  }

  await supabase
    .from("partner_salons")
    .update({ subscription_until: oneYear.toISOString() })
    .eq("id", payment.salon_id);

  const { data: salon } = await supabase
    .from("partner_salons")
    .select("name")
    .eq("id", payment.salon_id)
    .single();

  const partnerRow = Array.isArray(payment.partner) ? payment.partner[0] : payment.partner;
  try {
    await sendSalonPaidEmail({
      paymentId: event.referenceId,
      clientName: (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
      clientEmail: (partnerRow as { email: string } | undefined)?.email ?? "",
      salonName: salon?.name ?? "Your salon",
      amount: (payment as { amount?: number }).amount ?? 3500,
      expiresAt: oneYear.toISOString(),
    });
  } catch (e) {
    console.error(`${tag} salon paid email error`, e);
  }

  return { ok: true, message: "Salon subscription activated" };
}
