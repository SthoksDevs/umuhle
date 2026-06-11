// app/api/payfast/notify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { validateITN } from "@/lib/payfast";
import {
  notifyBookingConfirmed,
  notifyArtistNewBooking,
} from "@/lib/whatsapp";

export async function POST(request: NextRequest) {
  try {
    // 1. Parse ITN form body
    const text = await request.text();
    const params: Record<string, string> = {};
    new URLSearchParams(text).forEach((v, k) => {
      params[k] = v;
    });

    console.log("PayFast ITN received:", params);

    // 2. Validate ITN (signature + PayFast server confirmation)
    const isValid = await validateITN(params);
    if (!isValid) {
      console.error("PayFast ITN validation failed");
      return new NextResponse("Invalid ITN", { status: 400 });
    }

    // 3. Check payment status
    if (params.payment_status !== "COMPLETE") {
      console.log("PayFast ITN: non-complete status:", params.payment_status);
      return new NextResponse("OK", { status: 200 }); // acknowledge but do nothing
    }

    const bookingId = params.m_payment_id;
    const payfastPaymentId = params.pf_payment_id;

    // 4. Update booking in Supabase
    const supabase = createAdminClient();

    const { data: booking, error } = await supabase
      .from("bookings")
      .update({
        status: "confirmed",
        payfast_payment_id: payfastPaymentId,
      })
      .eq("id", bookingId)
      .select(
        `
        id, booking_date, booking_time,
        client:profiles!bookings_client_id_fkey(full_name, phone),
        artist:artists!bookings_artist_id_fkey(
          display_name,
          profile:profiles!artists_profile_id_fkey(phone)
        ),
        service:services(name)
      `
      )
      .single();

    if (error) {
      console.error("Booking update error:", error);
      return new NextResponse("DB error", { status: 500 });
    }

    // 5. Send WhatsApp notifications (fire & forget — don't block the response)
    if (booking) {
      const b = booking as any;
      const clientPhone = b.client?.phone;
      const artistPhone = b.artist?.profile?.phone;

      if (clientPhone) {
        notifyBookingConfirmed({
          clientPhone,
          clientName: b.client?.full_name ?? "there",
          artistName: b.artist?.display_name ?? "your artist",
          date: b.booking_date,
          time: b.booking_time,
          serviceName: b.service?.name ?? "beauty service",
        }).catch(console.error);
      }

      if (artistPhone) {
        notifyArtistNewBooking({
          artistPhone,
          clientName: b.client?.full_name ?? "A client",
          date: b.booking_date,
          time: b.booking_time,
          serviceName: b.service?.name ?? "beauty service",
        }).catch(console.error);
      }
    }

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("PayFast notify route error:", err);
    return new NextResponse("Error", { status: 500 });
  }
}
