// lib/bookings.ts
// Shared helper used by every gateway's initiate route to create a
// booking_intents row — mirrors lib/orders.ts's createPendingOrder() for
// shop orders. Previously this lookup-and-insert logic lived only inline
// inside app/api/payfast/initiate/route.ts, because PayFast was the only
// gateway that sold bookings. Now that HappyPay and Ozow do too, it's
// pulled out here so the three initiate routes can't drift apart the way
// the pre-refactor fulfillment logic did (see lib/payments/fulfillment.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

export type BookingPaymentMethod = "payfast" | "happypay" | "ozow";

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
  userId: string,
  opts: CreateBookingIntentOptions
): Promise<CreateBookingIntentResult> {
  const { data: service } = await supabase
    .from("services")
    .select("id, name, price, duration_minutes, artist_id")
    .eq("id", opts.serviceId)
    .single();

  if (!service) return { error: "Service not found" };

  const { data: artist } = await supabase
    .from("artists")
    .select("display_name, point_of_contact_name, point_of_contact_phone")
    .eq("id", opts.artistId)
    .single();

  const intentId = uuidv4();

  const { error: intentErr } = await supabase.from("booking_intents").insert({
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
