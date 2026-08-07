// app/api/store-bookings/[id]/status/route.ts
//
// Server-side status transitions for salon/store bookings. Mirrors
// app/api/bookings/[id]/status/route.ts for artist bookings — direct
// client-side writes to `store_bookings.status` should go through here
// instead, the same reasoning as that route: otherwise side effects (the
// salon review invite, the deposit payout, and TradeSafe's escrow release
// below) never get triggered. Deposits belong to the salon, not Umuhle
// (confirmed 2026-08-06) — see recordStoreBookingDepositSplit /
// creditStoreBookingDepositPayout in lib/payouts.ts.
//
// Callable by the salon's own owner (partner_salons.partner_id), via a
// Bearer token — same auth pattern as
// app/api/vendor/order-items/[id]/ship/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createReviewInvite, buildReviewUrl } from "@/lib/review-invites";
import { sendReviewInviteEmail } from "@/lib/email";
import { notifyReviewInvite } from "@/lib/whatsapp";
import { creditStoreBookingDepositPayout } from "@/lib/payouts";
import { acceptAllocationDelivery } from "@/lib/tradesafe";

const STORE_BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
type StoreBookingStatusValue = typeof STORE_BOOKING_STATUSES[number];

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const bookingId = params.id;

  const body = await req.json().catch(() => null);
  const status = body?.status as StoreBookingStatusValue | undefined;
  if (!status || !STORE_BOOKING_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: booking, error: bookingError } = await service
    .from("store_bookings")
    .select("id, salon_id, client_id, client_name, client_phone, salon:partner_salons(id, name, partner_id)")
    .eq("id", bookingId)
    .single();

  const salonRow = Array.isArray(booking?.salon) ? booking?.salon[0] : booking?.salon;
  if (bookingError || !booking || salonRow?.partner_id !== user.id) {
    // Same response whether it doesn't exist or isn't yours — no need to
    // reveal which to a caller probing ids that aren't theirs.
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const { data: updated, error } = await service
    .from("store_bookings")
    .update({ status })
    .eq("id", bookingId)
    .select("id, status, payment_method, tradesafe_allocation_id, tradesafe_released_at")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Booking not found" }, { status: 404 });
  }

  if (status === "completed") {
    // Credits the salon owner's wallet with their 94.5% of the deposit —
    // own try/catch, independent of everything else here. Safe to call
    // repeatedly (creditStoreBookingDepositPayout no-ops once already
    // credited).
    try {
      const result = await creditStoreBookingDepositPayout(service, bookingId);
      if (!result.credited) {
        console.log(`[store-bookings/status] deposit payout not credited: ${result.reason}`);
      }
    } catch (e) {
      console.error("[store-bookings/status] deposit payout error:", e);
    }

    // TradeSafe holds this deposit in escrow rather than paying Umuhle
    // directly — "completed" is also the right moment to release it, since
    // the service has actually been rendered. Best-effort, independent of
    // the payout above.
    if (updated.payment_method === "tradesafe" && updated.tradesafe_allocation_id && !updated.tradesafe_released_at) {
      try {
        await acceptAllocationDelivery(updated.tradesafe_allocation_id);
        await service
          .from("store_bookings")
          .update({ tradesafe_released_at: new Date().toISOString() })
          .eq("id", bookingId);
      } catch (e) {
        console.error("[store-bookings/status] TradeSafe allocationAcceptDelivery failed:", e);
      }
    }
  }

  // Salon review invite (client_to_salon) — only when the booking is tied
  // to a real profile. Guest store bookings (client_id null — the store
  // booking form doesn't require login) have no profile to attribute a
  // review to, since reviews.reviewer_id is NOT NULL and references
  // profiles(id); there's no automated review link for those today. Own
  // try/catch, independent of the status update above.
  if (status === "completed" && booking.client_id) {
    try {
      const { data: clientProfile } = await service
        .from("profiles")
        .select("full_name, phone, email")
        .eq("id", booking.client_id)
        .single();

      if (salonRow?.id && salonRow?.partner_id) {
        const inviteToken = await createReviewInvite(service, {
          reviewType: "client_to_salon",
          reviewerId: booking.client_id,
          reviewedId: salonRow.partner_id,
          salonId: salonRow.id,
        });

        if (inviteToken) {
          const url = buildReviewUrl(inviteToken);
          const clientName = clientProfile?.full_name ?? booking.client_name ?? "there";
          const clientEmail = clientProfile?.email ?? null;
          const clientPhone = clientProfile?.phone ?? booking.client_phone ?? null;

          if (clientEmail) {
            try {
              await sendReviewInviteEmail({
                reviewType:  "client_to_salon",
                toEmail:     clientEmail,
                toName:      clientName,
                targetName:  salonRow.name ?? "the salon",
                inviteToken,
                referenceId: bookingId,
              });
            } catch (e) {
              console.error("[store-bookings/status] review-invite email error:", e);
            }
          }
          if (clientPhone) {
            await notifyReviewInvite({
              phone:      clientPhone,
              name:       clientName,
              targetName: salonRow.name ?? "the salon",
              reviewUrl:  url,
              kind:       "salon",
            });
          }
        }
      }
    } catch (e) {
      console.error("[store-bookings/status] review invite error:", e);
    }
  }

  return NextResponse.json({ ok: true, booking: updated });
}
