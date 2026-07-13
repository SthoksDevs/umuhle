// app/api/ozow/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOzowPaymentRequest } from "@/lib/ozow";
import { createPendingOrder } from "@/lib/orders";
import { createBookingIntent } from "@/lib/bookings";
import { randomUUID } from "crypto";
import { isGatewayEnabled, gatewayLabel } from "@/lib/payments/gateways";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type OzowProfile = { email: string; full_name?: string | null };

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
  const type: "booking" | "order" = body.type === "booking" ? "booking" : "order";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get("host")}`;

  return type === "booking"
    ? initiateBooking(supabase, user.id, profile, body, baseUrl)
    : initiateOrder(supabase, user.id, profile, body, baseUrl);
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
    const status = created.error === "Service not found" ? 404 : 500;
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
// Unchanged behaviour from before this file gained a booking branch.

async function initiateOrder(
  supabase: SupabaseServerClient,
  userId: string,
  profile: OzowProfile,
  body: Record<string, unknown>,
  baseUrl: string
) {
  const { items, shippingAddress, contactName, contactWhatsapp } = body as {
    items: { productId: string; quantity: number }[];
    shippingAddress: string;
    contactName?: string;
    contactWhatsapp?: string;
  };

  const created = await createPendingOrder(supabase, userId, items, {
    paymentMethod: "ozow",
    shippingAddress,
    contactName,
    contactWhatsapp,
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 400 });
  const { orderId, totalAmount } = created.result;

  // Per-order secret embedded in the notify URL so we can confirm a
  // notification actually targets this checkout attempt (same pattern used
  // for HappyPay's webhook URLs).
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
