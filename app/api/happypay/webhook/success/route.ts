// app/api/happypay/webhook/success/route.ts
//
// This route's only job is HappyPay-specific: verify the per-order secret,
// then hand off to the shared fulfillment path. Previously this route had
// its own hand-rolled copy of "mark the order paid" that had drifted from
// PayFast/Ozow's — it never decremented stock and never sent the order
// confirmation email. Going through processPaymentEvent() fixes both, for
// free, by construction (there's only one "order paid" implementation now).

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

  // Verify the per-order webhook secret
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
    outcome: "completed",
    gateway: "happypay",
  });

  if (!result.ok) {
    console.error("[HappyPay webhook] Fulfillment error:", result.reason);
  }

  return NextResponse.json({ ok: true });
}
