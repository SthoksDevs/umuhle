// app/api/orders/google-pay/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createPendingOrder } from "@/lib/orders";
import { notifyOrderPaid } from "@/lib/whatsapp";

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

  const { orderId, totalAmount } = created.result;

  if (isTest) {
    // In test mode: immediately mark paid (token is not a real payment)
    const adminSupabase = await createServiceClient();
    await adminSupabase
      .from("orders")
      .update({ status: "paid", gateway_order_id: `gp_test_${token.slice(0, 12)}` })
      .eq("id", orderId);
  } else {
    // TODO: In production, decrypt the Google Pay token using your payment gateway
    // (e.g. Peach Payments) and charge the card before marking paid.
    // For now we record the token and mark processing.
    await supabase
      .from("orders")
      .update({ status: "processing", gateway_order_id: token.slice(0, 64) })
      .eq("id", orderId);
  }

  // WhatsApp confirmation — same umuhle_order template used by the other gateways
  const notifyPhone = contactWhatsapp ?? profile.phone;
  if (notifyPhone) {
    await notifyOrderPaid({
      clientName: contactName ?? profile.full_name ?? "there",
      clientPhone: notifyPhone,
      orderId,
      itemCount: items.length,
      totalAmount,
      paymentMethod: "google_pay",
    });
  }

  return NextResponse.json({ orderId });
}
