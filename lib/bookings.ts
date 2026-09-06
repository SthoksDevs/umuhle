// lib/bookings.ts
// Shared helper used by every gateway's initiate route to create a
// booking_intents row — mirrors lib/orders.ts's createPendingOrder() for
// shop orders. Previously this lookup-and-insert logic lived only inline
// inside app/api/payfast/initiate/route.ts, because PayFast was the only
// gateway that sold bookings (PayFast is gone — see the 2026-08 PayFast
// migration). Pulled out here so PayFast and Ozow's initiate routes
// can't drift apart the way the pre-refactor fulfillment logic did (see
// lib/payments/fulfillment.ts).
//
// Guest bookings (2026-09): userId may be null. booking_intents.client_id
// was already nullable and contact_name/contact_email already existed on
// both booking_intents and bookings — schema was ready for this before
// the application code was; see app/page.tsx's BookingDrawer for the
// guest-only name/email fields these come from, and
// lib/payments/fulfillment.ts's fulfillBooking() for how they're used as
// the confirmation-email fallback when there's no logged-in profile to
// join against.

import type { SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { createServiceClient } from "@/lib/supabase/server";

export type BookingPaymentMethod = "payfast" | "ozow";

interface CreateBookingIntentOptions {
  paymentMethod: BookingPaymentMethod;
  serviceId: string;
  artistId: string;
  bookingDate: string;
  bookingTime: string;
  meetingAddress?: string;
  notes?: string;
  clientPocName?: string;
  clientPocPhone?: string;
  // Guest bookings only — see the file header above.
  contactName?: string;
  contactEmail?: string;
}

interface BookingIntentService {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
}

interface BookingIntentArtist {
  display_name: string;
}

type CreateBookingIntentResult =
  | {
      result: {
        intentId: string;
        amount: number; // cents
        service: BookingIntentService;
        artist: BookingIntentArtist | null;
      };
    }
  | { error: string };

export async function createBookingIntent(
  supabase: SupabaseClient,
  userId: string | null, // null = guest booking
  opts: CreateBookingIntentOptions
): Promise<CreateBookingIntentResult> {
  const { data: service } = await supabase
    .from("services")
    .select("id, name, price, duration_minutes, artist_id")
    .eq("id", opts.serviceId)
    .single();

  if (!service) return { error: "Service not found" };

  if (!opts.meetingAddress?.trim()) return { error: "Meeting address is required" };
  if (!opts.clientPocName?.trim() || !opts.clientPocPhone?.trim()) return { error: "Point of contact name and phone are required" };
  if (!userId && !opts.contactEmail?.trim()) return { error: "An email address is required" };

  const { data: artist } = await supabase
    .from("artists")
    .select("display_name, point_of_contact_name, point_of_contact_phone")
    .eq("id", opts.artistId)
    .single();

  const intentId = uuidv4();

  // Service-role client, not the caller's session — for a guest booking
  // (userId null) there's no session at all, so booking_intents' "Client
  // can create own booking intents" RLS policy (client_id = auth.uid())
  // can never pass. Safe here for the same reason it's safe in
  // lib/orders.ts's createPendingOrder: service/artist have already been
  // validated above against trusted data, nothing below is taken as-is
  // from an unvalidated request.
  const mutClient = await createServiceClient();
  const { error: intentErr } = await mutClient.from("booking_intents").insert({
    id:               intentId,
    client_id:        userId,
    artist_id:        opts.artistId,
    service_id:       opts.serviceId,
    booking_date:     opts.bookingDate,
    booking_time:     opts.bookingTime,
    meeting_address:  opts.meetingAddress || null,
    total_amount:     service.price,
    notes:            opts.notes || null,
    client_poc_name:  opts.clientPocName || null,
    client_poc_phone: opts.clientPocPhone || null,
    artist_poc_name:  artist?.point_of_contact_name || null,
    artist_poc_phone: artist?.point_of_contact_phone || null,
    status:           "pending",
    payment_method:   opts.paymentMethod,
    contact_name:     opts.contactName || null,
    contact_email:    opts.contactEmail || null,
  });

  if (intentErr) {
    console.error("booking_intents insert error:", intentErr);
    return { error: "Could not create booking intent" };
  }

  return {
    result: {
      intentId,
      amount: service.price,
      service: { id: service.id, name: service.name, price: service.price, duration_minutes: service.duration_minutes },
      artist: artist ? { display_name: artist.display_name } : null,
    },
  };
}

/**
 * Right client for mutating a booking_intents row after
 * createBookingIntent() has already created it (payout_via, cancelling on
 * ineligibility, webhook secret, etc). Always the service client — same
 * reasoning as lib/orders.ts's getOrderMutationClient: these are
 * server-computed writes, and booking_intents' "client_id = auth.uid()"
 * UPDATE policy can never pass for a guest booking (client_id is null)
 * regardless of who's calling.
 */
export async function getBookingMutationClient() {
  return createServiceClient();
}
