// app/api/payfast/notify/route.ts
// PayFast Instant Transaction Notification (ITN) handler
import { NextRequest, NextResponse } from "next/server";
import { validateITN } from "@/lib/payfast";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyBookingCreated } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  // Parse URL-encoded body from PayFast
  const text = await req.text();
  const params = Object.fromEntries(new URLSearchParams(text));

  // 1. Validate signature + PayFast server-side confirmation
  const isValid = await validateITN(params);
  if (!isValid) {
    console.error("PayFast ITN: invalid notification");
    return new NextResponse("INVALID", { status: 200 }); // Always 200 to PayFast
  }

  // Only process COMPLETE payments
  if (params.payment_status !== "COMPLETE") {
    return new NextResponse("OK", { status: 200 });
  }

  const supabase = await createServiceClient();
  const paymentId = params.m_payment_id;
  const paymentType = params.custom_str1 as "booking" | "order" | "ad" | "salon" | undefined;
  const payfastPaymentId = params.pf_payment_id;

  try {
    switch (paymentType) {
      case "booking": {
        const { data: booking } = await supabase
          .from("bookings")
          .update({ status: "confirmed", payfast_payment_id: payfastPaymentId })
          .eq("id", paymentId)
          .eq("status", "pending_payment")
          .select(`
            id, booking_date, booking_time, meeting_address, notes,
            client:profiles!bookings_client_id_fkey(full_name, phone),
            artist:artists!bookings_artist_id_fkey(
              display_name, point_of_contact_name, point_of_contact_phone,
              profile:profiles!artists_profile_id_fkey(phone)
            ),
            service:services(name, duration_minutes)
          `)
          .single();

        if (booking) {
          const clientRow = Array.isArray(booking.client) ? booking.client[0] : booking.client;
          const artistRow = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;
          const serviceRow = Array.isArray(booking.service) ? booking.service[0] : booking.service;
          const artistProfileRow = Array.isArray(artistRow?.profile)
            ? artistRow.profile[0]
            : artistRow?.profile;

          const clientPhone = clientRow?.phone as string | undefined;
          const artistPhone = artistProfileRow?.phone as string | undefined;

          if (clientPhone && artistPhone) {
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
          }
        }
        break;
      }

      case "order": {
        // Mark order paid and decrement stock
        const { data: orderItems } = await supabase
          .from("order_items")
          .select("product_id, quantity")
          .eq("order_id", paymentId);

        await supabase
          .from("orders")
          .update({ status: "paid", payfast_payment_id: payfastPaymentId })
          .eq("id", paymentId)
          .eq("status", "pending_payment");

        if (orderItems) {
          for (const item of orderItems) {
            await supabase.rpc("decrement_stock", {
              p_product_id: item.product_id,
              p_qty: item.quantity,
            });
          }
        }
        break;
      }

      case "ad": {
        const now = new Date();
        // Determine expiry from package weeks — fetched from the ad record itself
        const { data: ad } = await supabase
          .from("ads")
          .select("package")
          .eq("id", paymentId)
          .single();

        const WEEKS: Record<string, number> = {
          starter: 6,
          growth: 12,
          business: 16,
          premium: 24,
        };
        const weeks = ad ? (WEEKS[ad.package] ?? 6) : 6;
        const expiresAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

        await supabase
          .from("ads")
          .update({
            status: "active",
            payfast_payment_id: payfastPaymentId,
            starts_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
            moderation_status: "scanning",
          })
          .eq("id", paymentId)
          .eq("status", "pending_payment");
        break;
      }

      case "salon": {
        const now = new Date();
        const oneYear = new Date(now);
        oneYear.setFullYear(oneYear.getFullYear() + 1);

        // Update the subscription payment record
        const { data: payment } = await supabase
          .from("salon_subscription_payments")
          .update({ status: "paid", payfast_payment_id: payfastPaymentId })
          .eq("id", paymentId)
          .eq("status", "pending")
          .select("salon_id")
          .single();

        if (payment?.salon_id) {
          await supabase
            .from("partner_salons")
            .update({ subscription_until: oneYear.toISOString() })
            .eq("id", payment.salon_id);
        }
        break;
      }

      default:
        console.warn("PayFast ITN: unknown payment type", paymentType, "for", paymentId);
    }
  } catch (err) {
    console.error("PayFast ITN processing error:", err);
    // Still return 200 so PayFast doesn't keep retrying with bad data
  }

  return new NextResponse("OK", { status: 200 });
}