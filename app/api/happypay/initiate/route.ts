// app/api/happypay/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createHappyPayOrder } from "@/lib/happypay";
import { createPendingOrder } from "@/lib/orders";
import { randomUUID } from "crypto";
import { isGatewayEnabled, gatewayLabel } from "@/lib/payments/gateways";

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
  const { items, shippingAddress, contactName, contactWhatsapp } = body as {
    items: { productId: string; quantity: number }[];
    shippingAddress: string;
    contactName?: string;
    contactWhatsapp?: string;
  };

  const created = await createPendingOrder(supabase, user.id, items, {
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get("host")}`;

  const happyPayResult = await createHappyPayOrder({
    orderId,
    totalCents: totalAmount,
    products: lines.map((l) => ({ quantity: l.quantity, price: l.unit_price / 100, name: l.name })),
    successWebhook: `${baseUrl}/api/happypay/webhook/success?type=order&id=${orderId}&secret=${webhookSecret}`,
    failureWebhook: `${baseUrl}/api/happypay/webhook/failure?type=order&id=${orderId}&secret=${webhookSecret}`,
    successReturnUrl: `${baseUrl}/payment/success?ref=${orderId}&method=happypay`,
    failReturnUrl: `${baseUrl}/payment/cancel?ref=${orderId}&method=happypay`,
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