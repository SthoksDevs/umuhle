// lib/payments/fulfillment.ts
//
// The "what happens after a payment" decisions for every payment type on
// Umuhle — booking, shop order, ad, salon subscription, product listing,
// store booking deposit.
//
// PayFast and Ozow are the two gateways today (PayFast's short-lived
// escrow experiment was reverted 2026-08 — PayFast is a direct-settlement
// gateway, same as Ozow, so there's no allocation/escrow lifecycle to
// track here anymore). Every payment type routes through one or the other
// (see lib/payments/eligibility.ts for which).
//
// This file is the single version of the truth. Every gateway's webhook
// route does ONLY gateway-specific transport — verify a signature or
// secret, translate that gateway's field names into a PaymentEvent (see
// ./types) — and then calls fulfillPayment() below. Nothing in this file
// imports lib/payfast or lib/ozow for signature/secret checking, and
// nothing in here knows what a HashCheck or a webhook secret is. That's
// what makes a gateway safe to pause (lib/payments/gateways.ts) or
// eventually remove entirely without touching a single decision made in
// here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentEvent, FulfillmentResult } from "./types";
import { recordBookingSplit, recordOrderItemSplits, recordStoreBookingDepositSplit } from "@/lib/payouts";
import { maybeTriggerReferralReward } from "@/lib/referrals";
import { notifyBookingCreated, notifyOrderPaid, notifyPocBookingUpdate } from "@/lib/whatsapp";
import {
  sendBookingConfirmedEmail,
  sendBookingFailedEmail,
  sendOrderPaidEmail,
  sendOrderFailedEmail,
  sendSalonPaidEmail,
} from "@/lib/email";

const WEEKS: Record<string, number> = { starter: 6, growth: 12, business: 16, premium: 24 };
const AD_COUNTS: Record<string, number> = { starter: 1, growth: 3, business: 6, premium: 10 };
const DURATION_LABELS: Record<string, string> = {
  starter: "6 weeks", growth: "3 months", business: "4 months", premium: "6 months",
};

/**
 * `bookings.payfast_payment_id` (and the equivalent on ads/products/
 * listing_packages/salon_subscription_payments) predates multi-gateway
 * support and is still named after PayFast specifically — kept around,
 * frozen, for historical rows already using it. Every gateway from here on
 * (PayFast, Ozow) writes to the gateway-neutral `gateway_order_id`
 * column instead, the pattern `orders` already used before this file
 * existed.
 */
function gatewayReferenceColumns(event: PaymentEvent): { gateway_order_id: string | null } {
  return { gateway_order_id: event.gatewayPaymentId ?? null };
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
      case "salon":
        return await fulfillSalon(supabase, event, tag);
      case "store_booking_deposit":
        return await fulfillStoreBookingDeposit(supabase, event, tag);
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
        payment_method: event.gateway,
        payout_via: intent.payout_via ?? "wallet",
        ...gatewayReferenceColumns(event),
      })
      .select(`
        id, booking_date, booking_time, meeting_address, notes, total_amount,
        client_poc_name, client_poc_phone,
        client:profiles!bookings_client_id_fkey(full_name, phone, email, whatsapp_comms_enabled),
        artist:artists!bookings_artist_id_fkey(
          display_name, point_of_contact_name, point_of_contact_phone,
          profile:profiles!artists_profile_id_fkey(phone, whatsapp_comms_enabled)
        ),
        service:services(name, duration_minutes)
      `)
      .single();

    if (bookingErr || !booking) {
      console.error(`${tag} failed to create booking from intent`, bookingErr);
      return { ok: false, message: "Failed to create booking from intent" };
    }

    // Record the Umuhle service fee / artist payout split now, at the
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
          // Email is the default channel now — WhatsApp only for accounts
          // that opted in (whatsapp_comms_enabled). Booking confirmation
          // email is sent unconditionally just below regardless.
          clientWhatsappEnabled: clientRow?.whatsapp_comms_enabled ?? false,
          artistWhatsappEnabled: artistProfileRow?.whatsapp_comms_enabled ?? false,
        });
      } catch (e) {
        console.error(`${tag} WhatsApp notify error`, e);
      }
    }

    // Point-of-contact booking update — NOT gated by whatsapp_comms_enabled.
    // The POC isn't the account holder (often isn't an Umuhle user at all),
    // so there's no comms preference of theirs to respect here — this is
    // one of the three always-on WABA categories.
    if (booking.client_poc_phone) {
      try {
        await notifyPocBookingUpdate({
          clientName: clientRow.full_name as string,
          clientPhone: clientPhone ?? "",
          artistName: artistRow.display_name as string,
          artistPhone: artistPhone ?? "",
          date: booking.booking_date,
          time: booking.booking_time,
          serviceName: serviceRow?.name as string,
          clientPocName: booking.client_poc_name ?? undefined,
          clientPocPhone: booking.client_poc_phone,
        });
      } catch (e) {
        console.error(`${tag} WhatsApp POC notify error`, e);
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
      id, status, total_amount, shipping_address, created_at,
      client:profiles!orders_client_id_fkey(full_name, email, phone, whatsapp_comms_enabled)
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
      .select("product_id, quantity, unit_price, product:products(name, partner_id, partner:profiles!partner_id(full_name, email, phone))")
      .eq("order_id", event.referenceId);

    const paidAt = new Date().toISOString();

    await supabase
      .from("orders")
      .update({
        status: "paid",
        paid_at: paidAt,
        ...(event.gatewayPaymentId ? { gateway_order_id: event.gatewayPaymentId } : {}),
        ...gatewayReferenceColumns(event),
      })
      .eq("id", event.referenceId)
      .eq("status", "pending_payment");

    if (orderItems) {
      for (const item of orderItems) {
        await supabase.rpc("decrement_stock", { p_product_id: item.product_id, p_qty: item.quantity });
      }
    }

    // Record each item's Umuhle service fee / partner payout split now
    // that payment has cleared. Wallets aren't credited until the order is
    // later marked "delivered" — see lib/payouts.ts.
    try {
      await recordOrderItemSplits(supabase, event.referenceId);
    } catch (e) {
      console.error(`${tag} failed to record order commission split`, e);
    }

    try {
      const sellersByPartnerId = new Map<string, { name: string; email: string; phone: string | null }>();
      for (const item of orderItems ?? []) {
        const product = Array.isArray(item.product) ? item.product[0] : item.product;
        const partner = product && (Array.isArray(product.partner) ? product.partner[0] : product.partner);
        if (product?.partner_id && partner && !sellersByPartnerId.has(product.partner_id)) {
          sellersByPartnerId.set(product.partner_id, {
            name: partner.full_name ?? "Unknown seller",
            email: partner.email ?? "",
            phone: partner.phone ?? null,
          });
        }
      }

      await sendOrderPaidEmail({
        orderId: event.referenceId,
        clientName: clientRow?.full_name ?? "Unknown",
        clientEmail: clientRow?.email ?? "",
        clientPhone: clientRow?.phone ?? null,
        totalAmount: order.total_amount,
        shippingAddress: order.shipping_address ?? undefined,
        paymentGateway: event.gateway,
        orderPlacedAt: order.created_at,
        paidAt,
        sellers: Array.from(sellersByPartnerId.values()),
        items: (orderItems ?? []).map((i) => ({
          name: (Array.isArray(i.product) ? i.product[0] : i.product)?.name ?? "Product",
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
    } catch (e) {
      console.error(`${tag} order paid email error`, e);
    }

    if (clientRow?.phone && clientRow?.whatsapp_comms_enabled) {
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

// paid only — a failed/cancelled subscription payment leaves the salon's
// subscription sitting unpaid with no notification, matching pre-existing
// behaviour.

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
      ...gatewayReferenceColumns(event),
    })
    .eq("id", event.referenceId)
    .eq("status", "pending")
    .select("id, amount, partner_id, partner:profiles!partner_id(full_name, email)")
    .single();

  if (!payment?.id) {
    console.warn(`${tag} salon payment not found or already processed`, event.referenceId);
    return { ok: true, message: "Already processed or unknown salon payment" };
  }

  // A payment can cover one salon or a whole CSV batch (cliff-tier bulk
  // registration — see lib/salon-pricing.ts). Always resolve via the join
  // table rather than a single salon_id column, so this is one code path
  // for both cases.
  const { data: links } = await supabase
    .from("salon_subscription_payment_salons")
    .select("salon_id")
    .eq("payment_id", payment.id);

  const salonIds = (links ?? []).map((l) => l.salon_id);
  if (salonIds.length === 0) {
    console.warn(`${tag} salon payment has no linked salons`, event.referenceId);
    return { ok: true, message: "Salon payment had no linked salons" };
  }

  await supabase
    .from("partner_salons")
    .update({ subscription_until: oneYear.toISOString() })
    .in("id", salonIds);

  const { data: salons } = await supabase
    .from("partner_salons")
    .select("name")
    .in("id", salonIds);

  await maybeTriggerReferralReward(supabase, {
    referredPartnerId: payment.partner_id,
    sourceType: "salon",
    sourceId: event.referenceId,
    commissionBaseCents: (payment as { amount?: number }).amount ?? 3500,
  });

  const partnerRow = Array.isArray(payment.partner) ? payment.partner[0] : payment.partner;
  const salonNames = (salons ?? []).map((s) => s.name).filter(Boolean);
  const salonLabel = salonNames.length === 1 ? salonNames[0] : `${salonIds.length} salons`;
  try {
    await sendSalonPaidEmail({
      paymentId: event.referenceId,
      clientName: (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
      clientEmail: (partnerRow as { email: string } | undefined)?.email ?? "",
      salonName: salonLabel || "Your salon",
      amount: (payment as { amount?: number }).amount ?? 3500,
      expiresAt: oneYear.toISOString(),
    });
  } catch (e) {
    console.error(`${tag} salon paid email error`, e);
  }

  return { ok: true, message: `Salon subscription activated for ${salonIds.length} salon(s)` };
}

// ── Store booking deposit ────────────────────────────────────────────────────
// Unlike the artist "booking" flow above, there's no separate intent table —
// the store_bookings row already exists at this point (the initiate route
// inserts it up front with status "pending", deposit_status "pending", the
// same way initiateAd()/initiateSalon() insert their row before redirecting).
// paid    → flip the deposit to "paid" and the booking straight to
//           "confirmed" — a paid deposit IS the confirmation for this flow.
// cancelled/failed → leave `status` alone (still "pending"). The booking
//           itself is still a real, useful lead for the salon — visible in
//           their bookings inbox exactly like a free/no-deposit request —
//           it just never got secured with a deposit.

async function fulfillStoreBookingDeposit(supabase: SupabaseClient, event: PaymentEvent, tag: string): Promise<FulfillmentResult> {
  if (event.outcome === "paid") {
    const { data: booking, error } = await supabase
      .from("store_bookings")
      .update({
        deposit_status: "paid",
        status: "confirmed",
        ...gatewayReferenceColumns(event),
        deposit_paid_at: new Date().toISOString(),
      })
      .eq("id", event.referenceId)
      .eq("deposit_status", "pending") // guards a duplicate notification from re-applying this
      .select("id, deposit_amount")
      .single();

    if (error || !booking) {
      console.warn(`${tag} store booking not found or already processed`, event.referenceId);
      return { ok: true, message: "Already processed or unknown booking" };
    }

    // The deposit belongs to the salon, not Umuhle (confirmed 2026-08-06)
    // — record the split now, same as recordBookingSplit for artist
    // bookings. Doesn't touch the wallet yet — that's
    // creditStoreBookingDepositPayout(), called once the salon marks the
    // booking "completed" (app/api/store-bookings/[id]/status/route.ts).
    try {
      await recordStoreBookingDepositSplit(supabase, booking.id, booking.deposit_amount);
    } catch (e) {
      console.error(`${tag} failed to record store booking deposit split`, e);
    }

    return { ok: true, message: "Store booking deposit confirmed" };
  }

  await supabase
    .from("store_bookings")
    .update({ deposit_status: "failed" })
    .eq("id", event.referenceId)
    .eq("deposit_status", "pending");

  return { ok: true, message: `Store booking deposit ${event.outcome}` };
}
