// app/api/vendor/shipments/[id]/track/route.ts
//
// Manual "Sync tracking" button in ShipmentsManager — pulls the latest
// status for one already-booked shipment from Ship Logic and updates
// order_shipments.status/courier_status. See also
// app/api/cron/sync-courier-tracking, which does the same thing for every
// in-flight shipment on a schedule; this route exists for an immediate,
// single-parcel refresh a partner triggers by hand.
//
// Deliberately does NOT touch order_items.delivered_at or trigger any
// payout logic, even when the courier reports "delivered" — that stays
// gated on the customer's own confirm-receipt click
// (app/confirm-receipt/[token]/page.tsx), by design, so a courier's
// delivery scan alone can never release a partner's payout.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTracking } from "@/lib/shiplogic";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const shipmentId = params.id;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: shipment, error: shipmentError } = await service
    .from("order_shipments")
    .select("id, partner_id, courier_reference, courier_provider, courier_booked_at, waybill_number")
    .eq("id", shipmentId)
    .single();

  if (shipmentError || !shipment) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  if (shipment.partner_id !== user.id) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  if (!shipment.waybill_number || !shipment.courier_reference) {
    return NextResponse.json({ error: "Nothing booked with the courier yet for this parcel." }, { status: 400 });
  }

  try {
    const isMock = (shipment.courier_provider ?? "").includes("mock");
    const update = await getTracking({
      trackingReference: shipment.courier_reference,
      isMock,
      bookedAt: shipment.courier_booked_at,
    });

    const patch: Record<string, unknown> = {
      courier_status: update.courierStatusRaw,
      courier_synced_at: new Date().toISOString(),
      status: update.status,
    };
    if (update.collectedAt) patch.collected_at = update.collectedAt;
    if (update.deliveredAt) patch.delivered_at = update.deliveredAt;

    const { data: updated, error: updateErr } = await service
      .from("order_shipments")
      .update(patch)
      .eq("id", shipmentId)
      .select()
      .single();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, shipment: updated });
  } catch (err) {
    console.error(`[vendor/shipments/${shipmentId}/track] error:`, err);
    return NextResponse.json({ error: "Couldn't reach the courier for a tracking update." }, { status: 502 });
  }
}
