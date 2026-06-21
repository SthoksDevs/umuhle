// app/api/happypay/webhook/success/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("order_id");
  const secret  = searchParams.get("secret");

  if (!orderId || !secret) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // Verify the per-order webhook secret
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, gateway_webhook_secret, client_id, total_amount")
    .eq("id", orderId)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.gateway_webhook_secret !== secret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }
  if (order.status === "paid") {
    // Idempotent — already processed
    return NextResponse.json({ ok: true });
  }

  await supabase
    .from("orders")
    .update({ status: "paid" })
    .eq("id", orderId);

  // Send WhatsApp confirmation
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", order.client_id)
      .single();

    if (profile?.phone) {
      const { sendTextMessage } = await import("@/lib/whatsapp");
      await sendTextMessage(
        profile.phone,
        `*Order Confirmed!*\n\nHi ${profile.full_name ?? "there"}, your Umuhle order has been confirmed via HappyPay.\n\nOrder ID: ${orderId}\nTotal: R${(order.total_amount / 100).toFixed(0)}\n\nWe'll send you delivery updates here. Thank you! 💜`
      );
    }
  } catch (err) {
    console.error("WhatsApp notify error:", err);
  }

  return NextResponse.json({ ok: true });
}
