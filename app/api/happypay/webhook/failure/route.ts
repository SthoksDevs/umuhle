// app/api/happypay/webhook/failure/route.ts
//
// Transport-only — mirrors webhook/success/route.ts. Previously this route
// silently cancelled the order with no customer email at all; routing it
// through fulfillPayment() fixes that gap the same way it fixed stock
// decrement on the success side. Now also covers bookings — see the note
// in webhook/success/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import { verifyWebhookSecret } from "@/lib/payments/webhook-secret";
import type { PaymentEvent, PaymentType } from "@/lib/payments/types";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const referenceId = searchParams.get("id") ?? searchParams.get("order_id");
  const secret = searchParams.get("secret");
  const type = (searchParams.get("type") ?? "order") as PaymentType;

  if (!referenceId || !secret) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  if (type !== "order" && type !== "booking") {
    return NextResponse.json({ error: "Unsupported payment type for HappyPay" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  if (!(await verifyWebhookSecret(supabase, type, referenceId, secret))) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const event: PaymentEvent = {
    gateway: "happypay",
    type,
    outcome: "failed",
    referenceId,
  };

  const result = await fulfillPayment(supabase, event);
  return NextResponse.json({ ok: result.ok });
}
