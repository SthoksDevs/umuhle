// app/api/ozow/initiate/route.ts
//
// Ozow is the universal fallback gateway — every payment type Umuhle
// sells goes through here. It's the ONLY gateway for:
//   - anything under PayFast's R5 minimum
//   - anything that's 100% Umuhle profit (salon subscription always;
//     order only when every line is Umuhle's own stock)
// See lib/payments/eligibility.ts for the exact rule. Ads and paid
// product listings used to route through here too — both were removed in
// 2026-08 (see lib/payments/split.ts's file header for how products work
// now: free to list, optionally linked to a service as an upsell).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOzowPaymentRequest } from "@/lib/ozow";
import { createPendingOrder } from "@/lib/orders";
import { createBookingIntent } from "@/lib/bookings";
import { randomUUID } from "crypto";
import { isGatewayEnabled, gatewayLabel } from "@/lib/payments/gateways";
import type { FulfillmentMethod } from "@/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type OzowProfile = { email: string; full_name?: string | null };

type PaymentTypeBody =
  | "booking" | "order" | "salon" | "store_booking_deposit";

export async function POST(req: NextRequest) {
  if (!isGatewayEnabled("ozow")) {
    return NextResponse.json(
      { error: `${gatewayLabel("ozow")} is temporarily unavailable. Please choose a different payment method.` },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone, account_status")
    .eq("id", user.id)
    .single();

  if (!profile || profile.account_status !== "active") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 });
  }

  const body = await req.json();
  const type: PaymentTypeBody = body.type ?? "order";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get("host")}`;

  try {
    switch (type) {
      case "booking":
        return await initiateBooking(supabase, user.id, profile, body, baseUrl);
      case "order":
        return await initiateOrder(supabase, user.id, profile, body, baseUrl);
      case "salon":
        return await initiateSalon(supabase, user.id, profile, body, baseUrl);
      case "store_booking_deposit":
        return await initiateStoreBookingDeposit(supabase, user.id, profile, body, baseUrl);
      default:
        return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    }
  } catch (err) {
    console.error("Ozow initiate error:", err);
    return NextResponse.json({ error: "Failed to initiate payment" }, { status: 500 });
  }
}

// ── Booking ───────────────────────────────────────────────────────────────────

async function initiateBooking(
  supabase: SupabaseServerClient,
  userId: string,
  profile: OzowProfile,
  body: Record<string, string>,
  baseUrl: string
) {
  const { serviceId, artistId, bookingDate, bookingTime, notes, meetingAddress, clientPocName, clientPocPhone } = body;

  const created = await createBookingIntent(supabase, userId, {
    paymentMethod: "ozow",
    serviceId, artistId, bookingDate, bookingTime, meetingAddress, notes, clientPocName, clientPocPhone,
  });
  if ("error" in created) {
    const status = created.error === "Service not found" ? 404 : created.error.includes("required") ? 400 : 500;
    return NextResponse.json({ error: created.error }, { status });
  }
  const { intentId, amount } = created.result;

  // Per-checkout-attempt secret embedded in the notify URL so we can
  // confirm a notification actually targets this attempt (same pattern
  // used for shop orders below).
  const webhookSecret = randomUUID();
  await supabase.from("booking_intents").update({ gateway_webhook_secret: webhookSecret }).eq("id", intentId);

  const result = await createOzowPaymentRequest({
    transactionReference: intentId,
    // Ozow shows this on the customer's bank statement — keep it short.
    bankReference: `UMUHLE${intentId.replace(/-/g, "").slice(0, 12)}`,
    amountCents: amount,
    cancelUrl: `${baseUrl}/payment/cancelled?ref=${intentId}&type=booking&method=ozow`,
    errorUrl: `${baseUrl}/payment/failed?ref=${intentId}&type=booking&method=ozow`,
    successUrl: `${baseUrl}/payment/success?ref=${intentId}&type=booking&method=ozow`,
    notifyUrl: `${baseUrl}/api/ozow/notify?type=booking&id=${intentId}&secret=${webhookSecret}`,
  });

  if (!result.success || !result.redirectUrl) {
    await supabase.from("booking_intents").update({ status: "cancelled" }).eq("id", intentId);
    return NextResponse.json(
      { error: result.errorMessage ?? "Ozow could not start this booking" },
      { status: 502 }
    );
  }

  if (result.ozowTransactionId) {
    await supabase.from("booking_intents").update({ gateway_order_id: result.ozowTransactionId }).eq("id", intentId);
  }

  return NextResponse.json({ redirectUrl: result.redirectUrl });
}

// ── Order (shop / marketplace products) ──────────────────────────────────────

async function initiateOrder(
  supabase: SupabaseServerClient,
  userId: string,
  profile: OzowProfile,
  body: Record<string, unknown>,
  baseUrl: string
) {
  const {
    items, shippingAddress, contactName, contactWhatsapp,
    fulfillmentByPartner, shippingAddressLine1, shippingAddressLine2,
    shippingSuburb, shippingCity, shippingProvince, shippingPostalCode,
  } = body as {
    items: { productId: string; quantity: number }[];
    shippingAddress: string;
    contactName?: string;
    contactWhatsapp?: string;
    fulfillmentByPartner?: Record<string, FulfillmentMethod>;
    shippingAddressLine1?: string;
    shippingAddressLine2?: string;
    shippingSuburb?: string;
    shippingCity?: string;
    shippingProvince?: string;
    shippingPostalCode?: string;
  };

  const created = await createPendingOrder(supabase, userId, items, {
    paymentMethod: "ozow",
    shippingAddress,
    contactName,
    contactWhatsapp,
    fulfillmentByPartner,
    shippingAddressLine1,
    shippingAddressLine2,
    shippingSuburb,
    shippingCity,
    shippingProvince,
    shippingPostalCode,
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 400 });
  const { orderId, totalAmount } = created.result;

  // Per-order secret embedded in the notify URL so we can confirm a
  // notification actually targets this checkout attempt.
  const webhookSecret = randomUUID();
  await supabase.from("orders").update({ gateway_webhook_secret: webhookSecret }).eq("id", orderId);

  const result = await createOzowPaymentRequest({
    transactionReference: orderId,
    // Ozow shows this on the customer's bank statement — keep it short.
    bankReference: `UMUHLE${orderId.replace(/-/g, "").slice(0, 12)}`,
    amountCents: totalAmount,
    cancelUrl: `${baseUrl}/payment/cancelled?ref=${orderId}&type=order&method=ozow`,
    errorUrl: `${baseUrl}/payment/failed?ref=${orderId}&type=order&method=ozow`,
    successUrl: `${baseUrl}/payment/success?ref=${orderId}&type=order&method=ozow`,
    notifyUrl: `${baseUrl}/api/ozow/notify?type=order&id=${orderId}&secret=${webhookSecret}`,
  });

  if (!result.success || !result.redirectUrl) {
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId);
    return NextResponse.json(
      { error: result.errorMessage ?? "Ozow could not start this order" },
      { status: 502 }
    );
  }

  if (result.ozowTransactionId) {
    await supabase.from("orders").update({ gateway_order_id: result.ozowTransactionId }).eq("id", orderId);
  }

  return NextResponse.json({ redirectUrl: result.redirectUrl });
}

async function initiateStoreBookingDeposit(
  supabase: SupabaseServerClient,
  userId: string,
  profile: OzowProfile,
  body: Record<string, string>,
  baseUrl: string
) {
  const { salonId, branchId, employeeId, clientName, clientPhone, serviceId, bookingDate, bookingTime, notes } = body;

  if (!salonId || !clientName || !clientPhone || !serviceId || !bookingDate || !bookingTime) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  const { data: salon } = await supabase
    .from("partner_salons")
    .select("id, name")
    .eq("id", salonId)
    .single();

  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });

  // The deposit lives on the specific service, not the salon — a R150
  // haircut and a R450 colour can (and usually will) need different
  // deposits. serviceId is trusted from the client for which service was
  // picked, but its price/deposit are always re-read here, and its
  // salon_id cross-checked against salonId, rather than trusting anything
  // money-related the client sent.
  const { data: service } = await supabase
    .from("salon_services")
    .select("id, name, price, deposit_amount")
    .eq("id", serviceId)
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .single();

  if (!service) return NextResponse.json({ error: "That service is no longer available." }, { status: 404 });
  if (!service.deposit_amount || service.deposit_amount <= 0) {
    return NextResponse.json({ error: "This service doesn't take a deposit." }, { status: 400 });
  }

  const webhookSecret = randomUUID();

  const { data: booking, error } = await supabase
    .from("store_bookings")
    .insert({
      salon_id: salonId,
      branch_id: branchId || null,
      branch_employee_id: employeeId || null,
      client_id: userId,
      client_name: clientName,
      client_phone: clientPhone,
      service: service.name,
      service_id: service.id,
      service_price: service.price,
      booking_date: bookingDate,
      booking_time: bookingTime,
      notes: notes || null,
      status: "pending",
      deposit_amount: service.deposit_amount,
      deposit_status: "pending",
      payment_method: "ozow",
      gateway_webhook_secret: webhookSecret,
    })
    .select("id")
    .single();

  if (error || !booking) {
    console.error("Failed to create store booking for deposit:", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }

  const result = await createOzowPaymentRequest({
    transactionReference: booking.id,
    bankReference: `UMUHLEDEP${booking.id.replace(/-/g, "").slice(0, 11)}`,
    amountCents: service.deposit_amount,
    cancelUrl: `${baseUrl}/payment/cancelled?ref=${booking.id}&type=store_booking_deposit&method=ozow`,
    errorUrl: `${baseUrl}/payment/failed?ref=${booking.id}&type=store_booking_deposit&method=ozow`,
    successUrl: `${baseUrl}/payment/success?ref=${booking.id}&type=store_booking_deposit&method=ozow`,
    notifyUrl: `${baseUrl}/api/ozow/notify?type=store_booking_deposit&id=${booking.id}&secret=${webhookSecret}`,
  });

  if (!result.success || !result.redirectUrl) {
    await supabase.from("store_bookings").delete().eq("id", booking.id);
    return NextResponse.json({ error: result.errorMessage ?? "Ozow could not start this payment" }, { status: 502 });
  }

  if (result.ozowTransactionId) {
    await supabase.from("store_bookings").update({ gateway_order_id: result.ozowTransactionId }).eq("id", booking.id);
  }

  return NextResponse.json({ redirectUrl: result.redirectUrl });
}

// ── Salon ─────────────────────────────────────────────────────────────────────
// Always 100% Umuhle revenue — see lib/payments/eligibility.ts.

async function initiateSalon(
  supabase: SupabaseServerClient,
  userId: string,
  profile: OzowProfile,
  body: Record<string, string>,
  baseUrl: string
) {
  const { salonId } = body;
  const SALON_PRICE = 3500; // R35 in cents

  const paymentId = randomUUID();
  const webhookSecret = randomUUID();

  await supabase.from("salon_subscription_payments").insert({
    id:         paymentId,
    salon_id:   salonId,
    partner_id: userId,
    amount:     SALON_PRICE,
    status:     "pending",
    gateway_webhook_secret: webhookSecret,
  });

  const result = await createOzowPaymentRequest({
    transactionReference: paymentId,
    bankReference: `UMUHLESUB${paymentId.replace(/-/g, "").slice(0, 11)}`,
    amountCents: SALON_PRICE,
    cancelUrl: `${baseUrl}/payment/cancelled?ref=${paymentId}&type=salon&method=ozow`,
    errorUrl: `${baseUrl}/payment/failed?ref=${paymentId}&type=salon&method=ozow`,
    successUrl: `${baseUrl}/payment/success?ref=${paymentId}&type=salon&method=ozow`,
    notifyUrl: `${baseUrl}/api/ozow/notify?type=salon&id=${paymentId}&secret=${webhookSecret}`,
  });

  if (!result.success || !result.redirectUrl) {
    await supabase.from("salon_subscription_payments").delete().eq("id", paymentId);
    return NextResponse.json({ error: result.errorMessage ?? "Ozow could not start this payment" }, { status: 502 });
  }

  if (result.ozowTransactionId) {
    await supabase.from("salon_subscription_payments").update({ gateway_order_id: result.ozowTransactionId }).eq("id", paymentId);
  }

  return NextResponse.json({ redirectUrl: result.redirectUrl });
}
