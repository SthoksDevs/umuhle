// app/api/admin/orders/[id]/status/route.ts
//
// Admin-only order status transitions. Replaces the direct client-side
// `supabase.from("orders").update({ status })` call that used to live in
// app/admin/orders/[id]/page.tsx — moving it server-side is what lets us
// safely credit partner payouts in the same request: the moment an order
// is marked "delivered", every partner in that order gets their 94.5% share
// (5.5% Umuhle commission already deducted) credited to their wallet,
// pending the standard payout hold window. See lib/payouts.ts.
//
// Uses the same Bearer-token admin auth pattern as
// app/api/admin/email-log/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { creditOrderPayouts } from "@/lib/payouts";

const ORDER_STATUSES = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled"] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return null;

  const { data: profile } = await service
    .from("profiles")
    .select("is_admin, account_status")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin || profile?.account_status !== "active") return null;

  return service;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const orderId = params.id;
  const service = await requireAdmin(req);
  if (!service) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const status = body?.status as OrderStatus | undefined;
  if (!status || !ORDER_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { data: order, error } = await service
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .select("id, status")
    .single();

  if (error || !order) {
    return NextResponse.json({ error: error?.message ?? "Order not found" }, { status: 404 });
  }

  let payout: { creditedItems: number; skipped: number } | null = null;
  if (status === "delivered") {
    try {
      payout = await creditOrderPayouts(service, orderId);
    } catch (e) {
      console.error("[admin/orders/status] payout crediting error:", e);
    }
  }

  return NextResponse.json({ ok: true, order, payout });
}
