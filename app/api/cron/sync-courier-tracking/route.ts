// app/api/cron/sync-courier-tracking/route.ts
//
// Periodic tracking refresh for every booked-but-not-yet-resolved courier
// shipment, via lib/shiplogic.getTracking. Driven by a Supabase pg_cron
// job ("courier-tracking-sync", every 30 min, via pg_net) — same pattern
// as the existing "booking-reminders" job (app/api/notifications/route.ts):
// net.http_get with the shared cron_secret pulled from Supabase Vault, so
// the secret never sits in the job definition as plaintext.
//
// Deliberately does NOT touch order_items.delivered_at or trigger payout
// logic — see app/api/vendor/shipments/[id]/track's comment; that stays
// gated on the customer's own confirm-receipt click no matter what the
// courier reports.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTracking } from "@/lib/shiplogic";

// Once a shipment reaches one of these, there's nothing left to poll for.
const RESOLVED_STATUSES = ["delivered", "cancelled"];

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  const { data: shipments, error } = await supabase
    .from("order_shipments")
    .select("id, courier_reference, courier_provider, courier_booked_at, status")
    .eq("fulfillment_method", "courier")
    .not("waybill_number", "is", null)
    .not("status", "in", `(${RESOLVED_STATUSES.join(",")})`);

  if (error) {
    console.error("[cron/sync-courier-tracking] fetch error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let synced = 0;
  let failed = 0;

  for (const shipment of shipments ?? []) {
    if (!shipment.courier_reference) continue;
    try {
      const isMock = (shipment.courier_provider ?? "").includes("mock");
      const update = await getTracking({
        trackingReference: shipment.courier_reference,
        isMock,
        bookedAt: shipment.courier_booked_at,
      });

      // Skip the write entirely if nothing's actually changed — this runs
      // every 30 min against every in-flight shipment, so an unnecessary
      // UPDATE on every tick adds up.
      if (update.status === shipment.status && !update.deliveredAt && !update.collectedAt) {
        synced++;
        continue;
      }

      const patch: Record<string, unknown> = {
        courier_status: update.courierStatusRaw,
        courier_synced_at: new Date().toISOString(),
        status: update.status,
      };
      if (update.collectedAt) patch.collected_at = update.collectedAt;
      if (update.deliveredAt) patch.delivered_at = update.deliveredAt;

      const { error: updateErr } = await supabase.from("order_shipments").update(patch).eq("id", shipment.id);
      if (updateErr) throw new Error(updateErr.message);
      synced++;
    } catch (err) {
      failed++;
      console.error(`[cron/sync-courier-tracking] failed for shipment ${shipment.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, checked: shipments?.length ?? 0, synced, failed });
}
