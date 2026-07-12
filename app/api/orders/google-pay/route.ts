// app/api/orders/google-pay/route.ts
//
// NOTE ON PRODUCTION READINESS: in test mode (NEXT_PUBLIC_GOOGLE_PAY_ENV
// != "PRODUCTION"), this route treats ANY token as a successful payment —
// there is no real charge happening. That's fine for development but is a
// live "free order" exploit if this ever runs in test mode against
// production data. Before going live, the "processing" branch below needs
// a real gateway integration (e.g. decrypt the token via Peach Payments,
// charge the card, and only THEN call processPaymentEvent from that
// gateway's own webhook/confirmation callback — exactly like PayFast/
// HappyPay/Ozow do). Flagging this prominently rather than fixing it
// silently, since it needs a real payment processor account to close out.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createPendingOrder } from "@/lib/orders";
import { processPaymentEvent } from "@/lib/payments/fulfillment";
import { isGatewayEnabled, GATEWAY_DISABLED_MESSAGE } from "@/lib/payments/gateways";

export async function POST(req: NextRequest) {
  if (!isGatewayEnabled("google_pay")) {
    return NextResponse.json({ error: GATEWAY_DISABLED_MESSAGE }, { status: 503 });
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
  const { token, items, shippingAddress, contactName, contactWhatsapp } = body as {
    token: string;
    items: { productId: string; quantity: number }[];
    shippingAddress: string;
    contactName?: string;
    contactWhatsapp?: string;
  };

  // In test mode, token is a dummy — we still create and mark the order paid
  const isTest = process.env.NEXT_PUBLIC_GOOGLE_PAY_ENV !== "PRODUCTION";

  const created = await createPendingOrder(supabase, user.id, items, {
    paymentMethod: "google_pay",
    shippingAddress,
    contactName,
    contactWhatsapp,
  });

  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: 400 });
  }

  const { orderId } = created.result;

  if (isTest) {
    // In test mode: immediately treat this as a completed payment (token is
    // not a real charge) and run it through the same fulfillment path every
    // other gateway uses — this is what makes stock decrement, commission
    // splits, the paid email, and the WhatsApp confirmation all happen for
    // Google Pay orders too, instead of the bespoke (and incomplete) inline
    // update this route used to do.
    const adminSupabase = await createServiceClient();
    const result = await processPaymentEvent(adminSupabase, {
      type: "order",
      paymentId: orderId,
      outcome: "completed",
      gateway: "google_pay",
      gatewayPaymentId: `gp_test_${token.slice(0, 12)}`,
    });
    if (!result.ok) {
      console.error("[Google Pay] Fulfillment error:", result.reason);
    }
  } else {
    // TODO: In production, decrypt the Google Pay token using your payment
    // gateway (e.g. Peach Payments) and charge the card before marking
    // paid. For now we record the token and mark processing — no
    // fulfillment runs until a real gateway confirms the charge.
    await supabase
      .from("orders")
      .update({ status: "processing", gateway_order_id: token.slice(0, 64) })
      .eq("id", orderId);
  }

  return NextResponse.json({ orderId });
}
