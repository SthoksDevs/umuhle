// app/api/bookings/[id]/status/route.ts
//
// Server-side booking status transitions. This is the hook point for
// booking payouts: the moment a booking is marked "completed", the artist's
// 94.5% share (5.5% Umuhle commission already deducted) is credited to
// their wallet, pending the standard payout hold window. See lib/payouts.ts.
//
// Callable by:
//   - an admin, via the same Bearer-token pattern used elsewhere in /api/admin/*
//   - the artist who owns the booking, via their normal cookie session
//
// Direct client-side writes to `bookings.status` should go through this
// route instead of `supabase.from("bookings").update(...)`, the same way
// order status changes now go through /api/admin/orders/[id]/status —
// otherwise payouts never get triggered.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createSessionClient, createServiceClient } from "@/lib/supabase/server";
import { creditBookingPayout } from "@/lib/payouts";
import { createReviewInvite, buildReviewUrl } from "@/lib/review-invites";
import { sendReviewInviteEmail } from "@/lib/email";
import { notifyReviewInvite } from "@/lib/whatsapp";

const BOOKING_STATUSES = ["confirmed", "in_progress", "completed", "cancelled", "no_show"] as const;
type BookingStatusValue = typeof BOOKING_STATUSES[number];

function adminServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function tryAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  const service = adminServiceClient();
  const { data: { user }, error } = await service.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await service
    .from("profiles")
    .select("is_admin, account_status")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin || profile?.account_status !== "active") return null;
  return service;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const bookingId = params.id;

  const body = await req.json().catch(() => null);
  const status = body?.status as BookingStatusValue | undefined;
  if (!status || !BOOKING_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Try admin (Bearer token) first, then fall back to the owning artist's
  // own cookie session.
  let service = await tryAdmin(req);

  if (!service) {
    const session = await createSessionClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Identity is already verified above via auth.getUser() (cookie-backed,
    // doesn't depend on table RLS). The lookup below only needs to read the
    // booking to check ownership in application code, so it uses the
    // service client rather than the caller's own session — otherwise this
    // check would silently fail for a legitimate artist if `bookings` RLS
    // doesn't happen to permit reading a booking where they're the artist
    // but not the client.
    service = await createServiceClient();

    const { data: booking } = await service
      .from("bookings")
      .select("id, artist:artists(profile_id)")
      .eq("id", bookingId)
      .single();

    const artistRow = Array.isArray(booking?.artist) ? booking?.artist[0] : booking?.artist;
    if (!booking || artistRow?.profile_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { data: updated, error } = await service
    .from("bookings")
    .update({
      status,
      ...(status === "in_progress" ? { started_at: new Date().toISOString() } : {}),
      ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", bookingId)
    .select("id, status, payment_method")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Booking not found" }, { status: 404 });
  }

  let payout: { credited: boolean; reason?: string } | null = null;
  if (status === "completed") {
    try {
      payout = await creditBookingPayout(service, bookingId);
    } catch (e) {
      console.error("[bookings/status] payout crediting error:", e);
    }

    // Review invites — one link for the client to rate the artist, one for
    // the artist to rate the client (see lib/review-invites.ts). Own
    // try/catch, deliberately independent of payout crediting above, so a
    // notification hiccup never affects the response or the payout.
    try {
      const { data: full } = await service
        .from("bookings")
        .select(`
          id,
          service:services(name),
          client:profiles!bookings_client_id_fkey(id, full_name, phone, email, whatsapp_comms_enabled),
          artist:artists!bookings_artist_id_fkey(
            id, display_name, profile_id,
            profile:profiles!artists_profile_id_fkey(full_name, phone, email, whatsapp_comms_enabled)
          )
        `)
        .eq("id", bookingId)
        .single();

      const clientRow = Array.isArray(full?.client) ? full?.client[0] : full?.client;
      const artistRow = Array.isArray(full?.artist) ? full?.artist[0] : full?.artist;
      const artistProfileRow = Array.isArray(artistRow?.profile) ? artistRow?.profile[0] : artistRow?.profile;

      if (clientRow?.id && artistRow?.profile_id) {
        const artistDisplayName = artistRow.display_name ?? "your artist";
        const clientDisplayName = clientRow.full_name ?? "your client";

        // Client -> rate the artist
        const clientToken = await createReviewInvite(service, {
          reviewType: "client_to_artist",
          reviewerId: clientRow.id,
          reviewedId: artistRow.profile_id,
          bookingId,
        });
        if (clientToken) {
          try {
            await sendReviewInviteEmail({
              reviewType:  "client_to_artist",
              toEmail:     clientRow.email ?? "",
              toName:      clientRow.full_name ?? "there",
              targetName:  artistDisplayName,
              inviteToken: clientToken,
              referenceId: bookingId,
            });
          } catch (e) {
            console.error("[bookings/status] client review-invite email error:", e);
          }
          if (clientRow.phone && (clientRow.whatsapp_comms_enabled ?? false)) {
            await notifyReviewInvite({
              phone:      clientRow.phone,
              name:       clientRow.full_name ?? "there",
              targetName: artistDisplayName,
              reviewUrl:  buildReviewUrl(clientToken),
              kind:       "artist",
            });
          }
        }

        // Artist -> rate the client
        const artistToken = await createReviewInvite(service, {
          reviewType: "artist_to_client",
          reviewerId: artistRow.profile_id,
          reviewedId: clientRow.id,
          bookingId,
        });
        if (artistToken) {
          const artistName = artistProfileRow?.full_name ?? artistDisplayName;
          try {
            await sendReviewInviteEmail({
              reviewType:  "artist_to_client",
              toEmail:     artistProfileRow?.email ?? "",
              toName:      artistName,
              targetName:  clientDisplayName,
              inviteToken: artistToken,
              referenceId: bookingId,
            });
          } catch (e) {
            console.error("[bookings/status] artist review-invite email error:", e);
          }
          if (artistProfileRow?.phone && (artistProfileRow?.whatsapp_comms_enabled ?? false)) {
            await notifyReviewInvite({
              phone:      artistProfileRow.phone,
              name:       artistName,
              targetName: clientDisplayName,
              reviewUrl:  buildReviewUrl(artistToken),
              kind:       "client",
            });
          }
        }
      }
    } catch (e) {
      console.error("[bookings/status] review invite error:", e);
    }
  }

  return NextResponse.json({ ok: true, booking: updated, payout });
}
