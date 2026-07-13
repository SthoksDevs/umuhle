// app/api/happypay/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createHappyPayOrder } from "@/lib/happypay";
import { createPendingOrder } from "@/lib/orders";
import { createBookingIntent } from "@/lib/bookings";
import { randomUUID } from "crypto";
import { isGatewayEnabled, gatewayLabel } from "@/lib/payments/gateways";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type HappyPayProfile = { email: string; full_name?: string | null };

export async function POST(req: NextRequest) {
  if (!isGatewayEnabled("happypay")) {
    return NextResponse.json(
      { error: `${gatewayLabel("happypay")} is temporarily unavailable. Please choose a different payment method.` },
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
  profile: HappyPayProfile,
  body: Record<string, string>,
  baseUrl: string
) {
  const { serviceId, artistId, bookingDate, bookingTime, notes, meetingAddress, clientPocName, clientPocPhone } = body;

  const created = await createBookingIntent(supabase, userId, {
    paymentMethod: "happypay",
    serviceId, artistId, bookingDate, bookingTime, meetingAddress, notes, clientPocName, clientPocPhone,
  });
  if ("error" in created) {
    const status = created.error === "Service not found" ? 404 : 500;
    return NextResponse.json({ error: created.error }, { status });
  }
  const { intentId, amount, service, artist } = created.result;

  // Per-checkout-attempt secret embedded in the webhook URLs so we can
  // confirm a success/failure callback actually came from this attempt —
  // same pattern used for shop orders below.
  const webhookSecret = randomUUID();
  await supabase.from("booking_intents").update({ gateway_webhook_secret: webhookSecret }).eq("id", intentId);

  const happyPayResult = await createHappyPayOrder({
    orderId: intentId,
    totalCents: amount,
    products: [{
      quantity: 1,
      price: amount / 100,
      name: `Booking: ${service.name}${artist ? ` with ${artist.display_name}` : ""}`,
    }],
    successWebhook: `${baseUrl}/api/happypay/webhook/success?type=booking&id=${intentId}&secret=${webhookSecret}`,
    failureWebhook: `${baseUrl}/api/happypay/webhook/failure?type=booking&id=${intentId}&secret=${webhookSecret}`,
    successReturnUrl: `${baseUrl}/payment/success?ref=${intentId}&type=booking&method=happypay`,
    failReturnUrl: `${baseUrl}/payment/failed?ref=${intentId}&type=booking&method=happypay`,
  });

  if (!happyPayResult.success || !happyPayResult.redirectUrl) {
    await supabase.from("booking_intents").update({ status: "cancelled" }).eq("id", intentId);
    return NextResponse.json(
      { error: happyPayResult.errorMessage ?? "HappyPay could not start this booking" },
      { status: 502 }
    );
  }

  await supabase.from("booking_intents").update({ gateway_order_id: happyPayResult.happyPayOrderId }).eq("id", intentId);

  return NextResponse.json({ redirectUrl: happyPayResult.redirectUrl });
}

// ── Order (shop / marketplace products) ──────────────────────────────────────
// Unchanged behaviour from before this file gained a booking branch.

async function initiateOrder(
  supabase: SupabaseServerClient,
  userId: string,
  profile: HappyPayProfile,
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
    paymentMethod: "happypay",
    shippingAddress,
    contactName,
    contactWhatsapp,
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 400 });
  const { orderId, totalAmount, lines } = created.result;

  // Per-order secret embedded in the webhook URLs so we can confirm a
  // success/failure callback actually came from this checkout attempt.
  const webhookSecret = randomUUID();
  await supabase.from("orders").update({ gateway_webhook_secret: webhookSecret }).eq("id", orderId);

  const happyPayResult = await createHappyPayOrder({
    orderId,
    totalCents: totalAmount,
    products: lines.map((l) => ({ quantity: l.quantity, price: l.unit_price / 100, name: l.name })),
    successWebhook: `${baseUrl}/api/happypay/webhook/success?type=order&id=${orderId}&secret=${webhookSecret}`,
    failureWebhook: `${baseUrl}/api/happypay/webhook/failure?type=order&id=${orderId}&secret=${webhookSecret}`,
    successReturnUrl: `${baseUrl}/payment/success?ref=${orderId}&type=order&method=happypay`,
    failReturnUrl: `${baseUrl}/payment/failed?ref=${orderId}&type=order&method=happypay`,
  });

  if (!happyPayResult.success || !happyPayResult.redirectUrl) {
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId);
    return NextResponse.json(
      { error: happyPayResult.errorMessage ?? "HappyPay could not start this order" },
      { status: 502 }
    );
  }

  await supabase.from("orders").update({ gateway_order_id: happyPayResult.happyPayOrderId }).eq("id", orderId);

  return NextResponse.json({ redirectUrl: happyPayResult.redirectUrl });
}
