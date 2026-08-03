// app/api/cron/review-invites/route.ts
//
// Daily cron: product review requests go out 5 days after delivery was
// confirmed, not immediately (people haven't formed an opinion on day one).
// See lib/review-invites.ts for the token these link to, and
// app/api/order-items/confirm/[token]/route.ts, which used to send this
// immediately and no longer does.
//
// One invite ROW per order_item still (a review targets one order_item at
// a time, and the unique constraint on reviews is per order_item), but
// only one EMAIL and one WhatsApp message per customer per run — grouped
// below by client_id — instead of the old one-per-item behaviour, which
// was spammy for anyone who bought more than one thing. The link in that
// single message points at any one of the customer's pending invite
// tokens; app/api/reviews/invite/[token] resolves and lists ALL of that
// reviewer's not-yet-reviewed product invites, so the page always shows
// their complete pending list even if it's grown since this run.
//
// Idempotent by construction: an order_item is "done" the moment it gets a
// review_invites row, so a missed day (deploy downtime, etc.) is simply
// caught on the next run rather than causing a duplicate or a gap.
//
// Registered in vercel.json alongside the other daily jobs.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createReviewInvite, buildReviewUrl } from "@/lib/review-invites";
import { sendProductReviewDigestEmail } from "@/lib/email";
import { notifyProductReviewDigest } from "@/lib/whatsapp";

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

  type ClientGroup = {
    clientName:   string;
    clientEmail:  string | null;
    clientPhone:  string | null;
    productNames: string[];
    inviteToken:  string; // any one of this client's tokens created this run
  };
  const byClient = new Map<string, ClientGroup>();

  let invitesCreated = 0;
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
      invitesCreated++;

      const productName = product.name ?? "your purchase";
      const existing = byClient.get(order.client_id);
      if (existing) {
        if (!existing.productNames.includes(productName)) existing.productNames.push(productName);
      } else {
        byClient.set(order.client_id, {
          // Prefer the account holder's own profile details over a specific
          // order's delivery contact — this message may now cover several
          // orders at once, so it addresses the customer, not whoever
          // received one particular delivery.
          clientName:   client?.full_name ?? order.contact_name ?? "there",
          clientEmail:  client?.email ?? null,
          clientPhone:  client?.phone ?? order.contact_whatsapp ?? null,
          productNames: [productName],
          inviteToken,
        });
      }
    } catch (e) {
      console.error(`[cron/review-invites] error for order_item ${item.id}:`, e);
    }
  }

  let customersNotified = 0;
  for (const [clientId, group] of byClient) {
    if (group.clientEmail) {
      try {
        await sendProductReviewDigestEmail({
          toEmail:      group.clientEmail,
          toName:       group.clientName,
          productNames: group.productNames,
          inviteToken:  group.inviteToken,
          referenceId:  clientId,
        });
      } catch (e) {
        console.error(`[cron/review-invites] email error for client ${clientId}:`, e);
      }
    }
    if (group.clientPhone) {
      await notifyProductReviewDigest({
        phone:        group.clientPhone,
        name:         group.clientName,
        productNames: group.productNames,
        reviewUrl:    buildReviewUrl(group.inviteToken),
      });
    }
    customersNotified++;
  }

  return NextResponse.json({
    invitesCreated,
    customersNotified,
    skipped: candidates.length - pending.length,
    total: candidates.length,
  });
}
