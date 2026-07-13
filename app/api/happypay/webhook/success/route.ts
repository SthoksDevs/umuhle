// app/api/happypay/webhook/success/route.ts
//
// Transport-only: verify the per-checkout secret HappyPay echoes back, then
// hand off to fulfillPayment() (lib/payments/fulfillment.ts) for the
// actual decision. That shared function is what now handles stock
// decrement and the order-paid email/WhatsApp — this route used to do a
// smaller, incomplete version of that itself.
//
// `type` defaults to "order" so an in-flight checkout session started
// before this file's URL format changed still resolves correctly. `id`
// falls back to the legacy `order_id` param name for the same reason.
// HappyPay now initiates both "order" and "booking" (see
// app/api/happypay/initiate/route.ts) — verifyWebhookSecret() looks up
// whichever table `type` actually points to.

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
    // The only two payment types HappyPay initiates today — see
    // app/api/happypay/initiate/route.ts.
    return NextResponse.json({ error: "Unsupported payment type for HappyPay" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  if (!(await verifyWebhookSecret(supabase, type, referenceId, secret))) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const event: PaymentEvent = {
    gateway: "happypay",
    type,
    outcome: "paid",
    referenceId,
  };

  const result = await fulfillPayment(supabase, event);
  return NextResponse.json({ ok: result.ok });
}
