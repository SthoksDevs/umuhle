// lib/payments/handlers/booking.ts
//
// Fulfillment for "booking" payments. Moved out of the PayFast ITN route —
// this is gateway-agnostic and reacts to a normalised PaymentEvent, not to
// any gateway's own payload shape.
//
//   completed → create the real booking from its booking_intent, record the
//               commission/payout split, send WhatsApp + confirmation email
//   cancelled/failed → mark the intent as such, send the failure email
//               (no booking is ever created for a failed/cancelled intent)
//
// Currently only PayFast sells bookings, but nothing here assumes that —
// any gateway that produces a "booking" PaymentEvent is handled identically.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentEvent, FulfillmentResult } from "../types";
import { recordBookingSplit } from "@/lib/payouts";
import { notifyBookingCreated } from "@/lib/whatsapp";
import { sendBookingConfirmedEmail, sendBookingFailedEmail } from "@/lib/email";

export async function fulfillBooking(
  supabase: SupabaseClient,
  event: PaymentEvent
): Promise<FulfillmentResult> {
  const { paymentId, outcome, gatewayPaymentId } = event;

  if (outcome === "completed") {
    // Fetch the intent (contains all booking data)
    const { data: intent } = await supabase
      .from("booking_intents")
      .select("*")
      .eq("id", paymentId)
      .eq("status", "pending")
      .single();

    if (!intent) {
      console.warn("[fulfillBooking] intent not found or already processed:", paymentId);
      return { ok: true, alreadyProcessed: true, reason: "Booking intent not found or already processed" };
    }

    // Mark intent as completed
    await supabase.from("booking_intents").update({ status: "completed" }).eq("id", paymentId);

    // Create the real booking now that payment is confirmed. The
    // `payfast_payment_id` column predates multi-gateway support — it's
    // really just "gateway reference id" now. See note in lib/payments/handlers/order.ts
    // for the same tradeoff on the orders table (which does have a generic column).
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .insert({
        client_id: intent.client_id,
        artist_id: intent.artist_id,
        service_id: intent.service_id,
        booking_date: intent.booking_date,
        booking_time: intent.booking_time,
        meeting_address: intent.meeting_address,
        status: "confirmed",
        total_amount: intent.total_amount,
        notes: intent.notes,
        client_poc_name: intent.client_poc_name,
        client_poc_phone: intent.client_poc_phone,
        artist_poc_name: intent.artist_poc_name,
        artist_poc_phone: intent.artist_poc_phone,
        payfast_payment_id: gatewayPaymentId ?? null,
      })
      .select(`
        id, booking_date, booking_time, meeting_address, notes, total_amount,
        client:profiles!bookings_client_id_fkey(full_name, phone, email),
        artist:artists!bookings_artist_id_fkey(
          display_name, point_of_contact_name, point_of_contact_phone,
          profile:profiles!artists_profile_id_fkey(phone)
        ),
        service:services(name, duration_minutes)
      `)
      .single();

    if (bookingErr || !booking) {
      console.error("[fulfillBooking] failed to create booking from intent:", bookingErr);
      return { ok: false, reason: bookingErr?.message ?? "Failed to create booking" };
    }

    // Record the 5.5% commission / 94.5% artist payout split now, at the
    // point of sale. This does NOT touch the artist's wallet yet — that
    // only happens once the booking is marked "completed" (see
    // lib/payouts.ts and /api/bookings/[id]/status).
    try {
      await recordBookingSplit(supabase, booking.id, booking.total_amount);
    } catch (e) {
      console.error("[fulfillBooking] Failed to record booking commission split:", e);
    }

    const clientRow = Array.isArray(booking.client) ? booking.client[0] : booking.client;
    const artistRow = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;
    const serviceRow = Array.isArray(booking.service) ? booking.service[0] : booking.service;
    const artistProfileRow = Array.isArray(artistRow?.profile) ? artistRow.profile[0] : artistRow?.profile;

    const clientPhone = clientRow?.phone as string | undefined;
    const artistPhone = artistProfileRow?.phone as string | undefined;

    // WhatsApp notifications (fire-and-forget, don't block)
    if (clientPhone && artistPhone) {
      try {
        await notifyBookingCreated({
          clientName: clientRow.full_name as string,
          clientPhone,
          artistName: artistRow.display_name as string,
          artistPhone,
          date: booking.booking_date,
          time: booking.booking_time,
          serviceName: serviceRow?.name as string,
          meetingAddress: booking.meeting_address ?? undefined,
          expectedDuration: serviceRow?.duration_minutes ?? undefined,
        });
      } catch (e) {
        console.error("[fulfillBooking] WhatsApp notify error:", e);
      }
    }

    // Admin + customer email — MUST be awaited. Vercel kills the function
    // as soon as the caller's POST() returns, so a fire-and-forget promise
    // here never gets to finish its SMTP handshake.
    try {
      await sendBookingConfirmedEmail({
        bookingId: booking.id,
        clientName: (clientRow?.full_name as string) ?? "Unknown",
        clientEmail: (clientRow?.email as string) ?? "",
        artistName: (artistRow?.display_name as string) ?? "Unknown",
        serviceName: (serviceRow?.name as string) ?? "Service",
        date: booking.booking_date,
        time: booking.booking_time,
        amount: booking.total_amount,
        meetingAddress: booking.meeting_address ?? undefined,
      });
    } catch (e) {
      console.error("[fulfillBooking] Booking confirmed email error:", e);
    }

    return { ok: true };
  }

  // ── cancelled / failed ────────────────────────────────────────────────
  // Mark the intent as cancelled/failed — no booking was ever created.
  const reason = outcome === "cancelled" ? "cancelled" : "failed";

  const { data: intent } = await supabase
    .from("booking_intents")
    .update({ status: reason })
    .eq("id", paymentId)
    .eq("status", "pending")
    .select(`
      *,
      client:profiles!booking_intents_client_id_fkey(full_name, email),
      service:services(name)
    `)
    .single();

  if (!intent) {
    return { ok: true, alreadyProcessed: true, reason: "Booking intent not found or already processed" };
  }

  const clientRow = Array.isArray(intent.client) ? intent.client[0] : intent.client;
  const serviceRow = Array.isArray(intent.service) ? intent.service[0] : intent.service;

  try {
    await sendBookingFailedEmail({
      bookingId: paymentId,
      clientName: clientRow?.full_name ?? "Unknown",
      clientEmail: clientRow?.email ?? "",
      serviceName: serviceRow?.name ?? "Service",
      date: intent.booking_date,
      time: intent.booking_time,
      amount: intent.total_amount,
      reason,
    });
  } catch (e) {
    console.error("[fulfillBooking] Booking failed email error:", e);
  }

  return { ok: true };
}
