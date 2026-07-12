// app/api/happypay/webhook/success/route.ts
//
// Transport-only: verify the per-order secret HappyPay echoes back, then
// hand off to fulfillPayment() (lib/payments/fulfillment.ts) for the
// actual decision. That shared function is what now handles stock
// decrement and the order-paid email/WhatsApp — this route used to do a
// smaller, incomplete version of that itself.
//
// `type` defaults to "order" — the only payment type HappyPay initiates
// today (see app/api/happypay/initiate/route.ts) — so an in-flight
// checkout session started before this file's URL format changed still
// resolves correctly. `id` falls back to the legacy `order_id` param name
// for the same reason.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import type { PaymentEvent, PaymentType } from "@/lib/payments/types";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const referenceId = searchParams.get("id") ?? searchParams.get("order_id");
  const secret = searchParams.get("secret");
  const type = (searchParams.get("type") ?? "order") as PaymentType;

  if (!referenceId || !secret) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  if (type !== "order") {
    // Only "order" has a gateway_webhook_secret column to check against
    // today — see the note in lib/payments/gateways.ts about HappyPay only
    // selling shop orders for now.
    return NextResponse.json({ error: "Unsupported payment type for HappyPay" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // Verify the per-order webhook secret
  const { data: order } = await supabase
    .from("orders")
    .select("id, gateway_webhook_secret")
    .eq("id", referenceId)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.gateway_webhook_secret !== secret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const event: PaymentEvent = {
    gateway: "happypay",
    type: "order",
    outcome: "paid",
    referenceId,
  };

  const result = await fulfillPayment(supabase, event);
  return NextResponse.json({ ok: result.ok });
}
