// app/api/happypay/webhook/failure/route.ts
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

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, gateway_webhook_secret")
    .eq("id", orderId)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.gateway_webhook_secret !== secret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  if (order.status === "pending_payment") {
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId);
  }

  return NextResponse.json({ ok: true });
}
