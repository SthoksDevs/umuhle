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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
    .select("id, status")
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
  }

  return NextResponse.json({ ok: true, booking: updated, payout });
}
