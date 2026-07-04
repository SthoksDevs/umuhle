// app/api/ozow/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOzowPaymentRequest } from "@/lib/ozow";
import { createPendingOrder } from "@/lib/orders";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get("host")}`;

  const result = await createOzowPaymentRequest({
    transactionReference: orderId,
    // Ozow shows this on the customer's bank statement — keep it short.
    bankReference: `UMUHLE${orderId.replace(/-/g, "").slice(0, 12)}`,
    amountCents: totalAmount,
    cancelUrl: `${baseUrl}/payment/cancel?ref=${orderId}&method=ozow`,
    errorUrl: `${baseUrl}/payment/failed?ref=${orderId}&method=ozow`,
    successUrl: `${baseUrl}/payment/success?ref=${orderId}&method=ozow`,
    notifyUrl: `${baseUrl}/api/ozow/notify?order_id=${orderId}&secret=${webhookSecret}`,
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
