// app/api/happypay/webhook/failure/route.ts
//
// This route's only job is HappyPay-specific: verify the per-order secret,
// then hand off to the shared fulfillment path — same "cancelled" outcome
// PayFast and Ozow produce for a failed order, so the order gets the same
// failure email every other gateway sends.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { processPaymentEvent } from "@/lib/payments/fulfillment";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("order_id");
  const secret = searchParams.get("secret");

  if (!orderId || !secret) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, gateway_webhook_secret")
    .eq("id", orderId)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.gateway_webhook_secret !== secret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const result = await processPaymentEvent(supabase, {
    type: "order",
    paymentId: orderId,
    outcome: "cancelled",
    gateway: "happypay",
  });

  if (!result.ok) {
    console.error("[HappyPay webhook] Fulfillment error:", result.reason);
  }

  return NextResponse.json({ ok: true });
}
