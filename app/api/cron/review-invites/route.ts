// app/api/cron/review-invites/route.ts
//
// Daily cron: product review requests go out 5 days after delivery was
// confirmed, not immediately (people haven't formed an opinion on day one).
// See lib/review-invites.ts for the token these link to, and
// app/api/order-items/confirm/[token]/route.ts, which used to send this
// immediately and no longer does.
//
// Idempotent by construction: an order_item is "done" the moment it gets a
// review_invites row, so a missed day (deploy downtime, etc.) is simply
// caught on the next run rather than causing a duplicate or a gap.
//
// Registered in vercel.json alongside the other daily jobs.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createReviewInvite, buildReviewUrl } from "@/lib/review-invites";
import { sendReviewInviteEmail } from "@/lib/email";
import { notifyReviewInvite } from "@/lib/whatsapp";

const DELAY_DAYS = 5;
const BATCH_LIMIT = 200;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const service = serviceClient();
  const cutoff = new Date(Date.now() - DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Candidates: delivered at least 5 days ago. No upper bound — the "already
  // invited" filter below is what makes this safe to run indefinitely
  // without re-processing anything.
  const { data: candidates, error: candidatesError } = await service
    .from("order_items")
    .select(`
      id,
      delivered_at,
      product:products(id, name, partner_id),
      order:orders(client_id, contact_name, contact_whatsapp, client:profiles!client_id(full_name, phone, email))
    `)
    .not("delivered_at", "is", null)
    .lte("delivered_at", cutoff)
    .order("delivered_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (candidatesError) {
    console.error("[cron/review-invites] candidates query error:", candidatesError);
    return NextResponse.json({ error: candidatesError.message }, { status: 500 });
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, total: 0 });
  }

  const { data: already, error: alreadyError } = await service
    .from("review_invites")
    .select("order_item_id")
    .in("order_item_id", candidates.map((c) => c.id));

  if (alreadyError) {
    console.error("[cron/review-invites] existing-invites query error:", alreadyError);
    return NextResponse.json({ error: alreadyError.message }, { status: 500 });
  }
  const alreadyInvited = new Set((already ?? []).map((r) => r.order_item_id));

  const pending = candidates.filter((c) => !alreadyInvited.has(c.id));

  let sent = 0;
  for (const item of pending) {
    const product = Array.isArray(item.product) ? item.product[0] : item.product;
    const order = Array.isArray(item.order) ? item.order[0] : item.order;
    const client = order ? (Array.isArray(order.client) ? order.client[0] : order.client) : null;

    if (!product?.partner_id || !order?.client_id) continue;

    try {
      const inviteToken = await createReviewInvite(service, {
        reviewType: "client_to_product",
        reviewerId: order.client_id,
        reviewedId: product.partner_id,
        orderItemId: item.id,
      });
      if (!inviteToken) continue;

      const url = buildReviewUrl(inviteToken);
      const clientName = order.contact_name ?? client?.full_name ?? "there";
      const clientPhone = order.contact_whatsapp ?? client?.phone ?? null;

      if (client?.email) {
        try {
          await sendReviewInviteEmail({
            reviewType:  "client_to_product",
            toEmail:     client.email,
            toName:      clientName,
            targetName:  product.name ?? "your purchase",
            inviteToken,
            referenceId: item.id,
          });
        } catch (e) {
          console.error(`[cron/review-invites] email error for order_item ${item.id}:`, e);
        }
      }
      if (clientPhone) {
        await notifyReviewInvite({
          phone:      clientPhone,
          name:       clientName,
          targetName: product.name ?? "your purchase",
          reviewUrl:  url,
          kind:       "product",
        });
      }
      sent++;
    } catch (e) {
      console.error(`[cron/review-invites] error for order_item ${item.id}:`, e);
    }
  }

  return NextResponse.json({ sent, skipped: candidates.length - pending.length, total: candidates.length });
}
