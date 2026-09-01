// app/api/store-bookings/[id]/status/route.ts
//
// Server-side status transitions for salon/store bookings. Mirrors
// app/api/bookings/[id]/status/route.ts for artist bookings — direct
// client-side writes to `store_bookings.status` should go through here
// instead, the same reasoning as that route: otherwise side effects (the
// salon review invite, the deposit payout, and PayFast's escrow release
// below) never get triggered. Deposits belong to the salon, not Umuhle
// (confirmed 2026-08-06) — see recordStoreBookingDepositSplit /
// creditStoreBookingDepositPayout in lib/payouts.ts.
//
// Callable by the salon's own owner (partner_salons.partner_id), via a
// Bearer token — same auth pattern as
// app/api/vendor/order-items/[id]/ship/route.ts. Also callable by the
// specific employee a booking is assigned to (branch_employees.profile_id,
// see supabase/migrations/20260830_role_based_dashboards.sql) acting on
// their own booking — see components/dashboard/EmployeeDashboard.tsx. This
// is intentionally narrower than the branch-wide calendar (can_manage_calendar,
// not yet wired to any UI): an employee can act on a booking assigned to
// them without needing that grant.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createReviewInvite, buildReviewUrl } from "@/lib/review-invites";
import { sendReviewInviteEmail } from "@/lib/email";
import { notifyReviewInvite } from "@/lib/whatsapp";
import { creditStoreBookingDepositPayout } from "@/lib/payouts";
import { isLateCancellation } from "@/lib/reliability";

const STORE_BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"] as const;
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
    .select("id, salon_id, branch_id, branch_employee_id, client_id, client_name, client_phone, booking_date, booking_time, salon:partner_salons(id, name, partner_id)")
    .eq("id", bookingId)
    .single();

  const salonRow = Array.isArray(booking?.salon) ? booking?.salon[0] : booking?.salon;
  const isOwner = !!booking && salonRow?.partner_id === user.id;

  let isAssignedEmployee = false;
  if (!!booking && !isOwner && booking.branch_employee_id) {
    const { data: employeeRow } = await service
      .from("branch_employees")
      .select("id")
      .eq("id", booking.branch_employee_id)
      .eq("profile_id", user.id)
      .eq("invite_status", "active")
      .maybeSingle();
    isAssignedEmployee = !!employeeRow;
  }

  if (bookingError || !booking || (!isOwner && !isAssignedEmployee)) {
    // Same response whether it doesn't exist or isn't yours — no need to
    // reveal which to a caller probing ids that aren't theirs.
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  // Only the salon owner or the assigned employee can call this route (see
  // the auth check above). A cancellation made through it is therefore
  // provider-initiated by definition (owner or the staff member handling
  // it), and any no-show reported through it is necessarily the
  // customer's — neither party travels anywhere to fail to show up. See
  // the 20260827_store_booking_reliability migration for the reasoning.
  const now = new Date();
  const cancelledBy = status === "cancelled" ? "salon" : null;
  const lateCancellation = status === "cancelled" ? isLateCancellation(booking.booking_date, booking.booking_time, now) : null;

  const { data: updated, error } = await service
    .from("store_bookings")
    .update({
      status,
      ...(status === "cancelled" ? { cancelled_by: cancelledBy, cancelled_at: now.toISOString(), late_cancellation: lateCancellation } : {}),
      ...(status === "no_show" ? { no_show_at: now.toISOString() } : {}),
    })
    .eq("id", bookingId)
    .select("id, status, payment_method")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Booking not found" }, { status: 404 });
  }

  // Reliability tracking (see lib/reliability.ts) — best-effort, same as
  // the mobile-artist status route.
  try {
    if (status === "completed") {
      await service.rpc("record_salon_booking_outcome", { p_salon_id: booking.salon_id, p_outcome: "completed" });
      if (booking.client_id) await service.rpc("record_client_booking_outcome", { p_client_id: booking.client_id, p_outcome: "completed" });
    } else if (status === "cancelled") {
      await service.rpc("record_salon_booking_outcome", { p_salon_id: booking.salon_id, p_outcome: lateCancellation ? "late_cancelled" : "cancelled" });
    } else if (status === "no_show") {
      await service.rpc("record_salon_booking_outcome", { p_salon_id: booking.salon_id, p_outcome: "no_show" });
      if (booking.client_id) await service.rpc("record_client_booking_outcome", { p_client_id: booking.client_id, p_outcome: "no_show" });
    }
  } catch (e) {
    console.error("[store-bookings/status] reliability recording error:", e);
  }

  if (status === "completed") {
    // Credits the salon owner's wallet with the deposit less Umuhle's
    // service fee — own try/catch, independent of everything else here. Safe to call
    // repeatedly (creditStoreBookingDepositPayout no-ops once already
    // credited, including when it was already settled instantly via a
    // PayFast split — see lib/payouts.ts).
    try {
      const result = await creditStoreBookingDepositPayout(service, bookingId);
      if (!result.credited) {
        console.log(`[store-bookings/status] deposit payout not credited: ${result.reason}`);
      }
    } catch (e) {
      console.error("[store-bookings/status] deposit payout error:", e);
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
        .select("full_name, phone, email, whatsapp_comms_enabled")
        .eq("id", booking.client_id)
        .single();

      // branch_id should always be set on any booking made through the
      // current (branch-aware) store booking flow — this guard only
      // matters for legacy bookings that predate store_branches shipping,
      // which can't get a valid review invite under the new per-branch
      // constraint (reviews_target_shape_check requires branch_id).
      if (salonRow?.id && salonRow?.partner_id && booking.branch_id) {
        const inviteToken = await createReviewInvite(service, {
          reviewType: "client_to_salon",
          reviewerId: booking.client_id,
          reviewedId: salonRow.partner_id,
          salonId: salonRow.id,
          storeBookingId: booking.id,
          branchId: booking.branch_id,
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
          if (clientPhone && (clientProfile?.whatsapp_comms_enabled ?? false)) {
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
