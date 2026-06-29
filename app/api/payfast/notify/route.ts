// app/api/payfast/notify/route.ts
// PayFast Instant Transaction Notification (ITN) handler
//
// Flow for bookings:
//   COMPLETE  → create real booking from booking_intent, send WhatsApp + admin email
//   CANCELLED → mark intent cancelled, send admin failure email
// Flow for orders:
//   COMPLETE  → mark paid, decrement stock, send admin email
//   CANCELLED → mark cancelled, send admin failure email

import { NextRequest, NextResponse } from "next/server";
import { validateITN } from "@/lib/payfast";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyBookingCreated } from "@/lib/whatsapp";
import {
  sendBookingConfirmedEmail,
  sendBookingFailedEmail,
  sendOrderPaidEmail,
  sendOrderFailedEmail,
  sendAdPaidEmail,
  sendSalonPaidEmail,
} from "@/lib/email";

export async function POST(req: NextRequest) {
  const text = await req.text();
  const params = Object.fromEntries(new URLSearchParams(text));

  // 1. Validate signature + PayFast server-side confirmation
  const isValid = await validateITN(params);
  if (!isValid) {
    console.error("PayFast ITN: invalid notification");
    return new NextResponse("INVALID", { status: 200 }); // Always 200 to PayFast
  }

  const supabase       = await createServiceClient();
  const paymentId      = params.m_payment_id;
  const paymentType    = params.custom_str1 as "booking" | "order" | "ad" | "salon" | undefined;
  const paymentStatus  = params.payment_status; // "COMPLETE" | "CANCELLED" | "FAILED" | "PENDING"
  const pfPaymentId    = params.pf_payment_id;

  try {
    switch (paymentType) {

      // ── BOOKING ─────────────────────────────────────────────────────────────
      case "booking": {
        if (paymentStatus === "COMPLETE") {
          // Fetch the intent (contains all booking data)
          const { data: intent } = await supabase
            .from("booking_intents")
            .select("*")
            .eq("id", paymentId)
            .eq("status", "pending")
            .single();

          if (!intent) {
            console.warn("PayFast ITN: booking intent not found or already processed", paymentId);
            break;
          }

          // Mark intent as completed
          await supabase
            .from("booking_intents")
            .update({ status: "completed" })
            .eq("id", paymentId);

          // Create the real booking now that payment is confirmed
          const { data: booking, error: bookingErr } = await supabase
            .from("bookings")
            .insert({
              client_id:        intent.client_id,
              artist_id:        intent.artist_id,
              service_id:       intent.service_id,
              booking_date:     intent.booking_date,
              booking_time:     intent.booking_time,
              meeting_address:  intent.meeting_address,
              status:           "confirmed",
              total_amount:     intent.total_amount,
              notes:            intent.notes,
              client_poc_name:  intent.client_poc_name,
              client_poc_phone: intent.client_poc_phone,
              artist_poc_name:  intent.artist_poc_name,
              artist_poc_phone: intent.artist_poc_phone,
              payfast_payment_id: pfPaymentId,
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
            console.error("PayFast ITN: failed to create booking from intent", bookingErr);
            break;
          }

          const clientRow  = Array.isArray(booking.client)  ? booking.client[0]  : booking.client;
          const artistRow  = Array.isArray(booking.artist)  ? booking.artist[0]  : booking.artist;
          const serviceRow = Array.isArray(booking.service) ? booking.service[0] : booking.service;
          const artistProfileRow = Array.isArray(artistRow?.profile)
            ? artistRow.profile[0]
            : artistRow?.profile;

          const clientPhone = clientRow?.phone  as string | undefined;
          const artistPhone = artistProfileRow?.phone as string | undefined;

          // WhatsApp notifications (fire-and-forget, don't block)
          if (clientPhone && artistPhone) {
            notifyBookingCreated({
              clientName:       clientRow.full_name as string,
              clientPhone,
              artistName:       artistRow.display_name as string,
              artistPhone,
              date:             booking.booking_date,
              time:             booking.booking_time,
              serviceName:      serviceRow?.name as string,
              meetingAddress:   booking.meeting_address ?? undefined,
              expectedDuration: serviceRow?.duration_minutes ?? undefined,
            }).catch(e => console.error("WhatsApp notify error:", e));
          }

         console.log("======================================");
        console.log("[PAYMENT] Payment callback received");
        console.log("[PAYMENT] Status:", paymentStatus);
        console.log("[PAYMENT] Payment ID:", paymentId);

        console.log("[PAYMENT] Booking ID:", booking.id);
        console.log("[PAYMENT] Customer email:", clientRow?.email);
        console.log("[PAYMENT] Admin email:", process.env.ADMIN_EMAIL);

        console.log("[PAYMENT] Calling sendBookingConfirmedEmail()...");

        try {
          await sendBookingConfirmedEmail({
            bookingId: booking.id,
            clientName: clientRow?.full_name as string ?? "Unknown",
            clientEmail: clientRow?.email as string ?? "",
            artistName: artistRow?.display_name as string ?? "Unknown",
            serviceName: serviceRow?.name as string ?? "Service",
            date: booking.booking_date,
            time: booking.booking_time,
            amount: booking.total_amount,
            meetingAddress: booking.meeting_address ?? undefined,
          });

          console.log("[PAYMENT] sendBookingConfirmedEmail() completed successfully.");
        } catch (e) {
          console.error("[PAYMENT] sendBookingConfirmedEmail() FAILED:");
          console.error(e);
        }

      // ── ORDER ────────────────────────────────────────────────────────────────
      case "order": {
        console.log("[PAYMENT] Received payment status:", paymentStatus);
        if (paymentStatus === "COMPLETE") {
          // Fetch order items before updating (need them for email)
          const { data: orderItems } = await supabase
            .from("order_items")
            .select("product_id, quantity, unit_price, product:products(name)")
            .eq("order_id", paymentId);

          const { data: order } = await supabase
            .from("orders")
            .update({ status: "paid", payfast_payment_id: pfPaymentId })
            .eq("id", paymentId)
            .eq("status", "pending_payment")
            .select("total_amount, shipping_address, client:profiles!orders_client_id_fkey(full_name, email)")
            .single();

          if (orderItems) {
            for (const item of orderItems) {
              await supabase.rpc("decrement_stock", {
                p_product_id: item.product_id,
                p_qty:        item.quantity,
              });
            }
          }

          if (order) {
            const clientRow = Array.isArray(order.client) ? order.client[0] : order.client;
            sendOrderPaidEmail({
              orderId:         paymentId,
              clientName:      clientRow?.full_name      ?? "Unknown",
              clientEmail:     clientRow?.email          ?? "",
              totalAmount:     order.total_amount,
              shippingAddress: order.shipping_address    ?? undefined,
              items: (orderItems ?? []).map(i => ({
                name:       (Array.isArray(i.product) ? i.product[0] : i.product)?.name ?? "Product",
                quantity:   i.quantity,
                unit_price: i.unit_price,
              })),
            }).catch(e => console.error("Admin order email error:", e));
          }

        } else if (paymentStatus === "CANCELLED" || paymentStatus === "FAILED") {
          const reason = paymentStatus === "CANCELLED" ? "cancelled" : "failed";

          const { data: order } = await supabase
            .from("orders")
            .update({ status: "cancelled" })
            .eq("id", paymentId)
            .eq("status", "pending_payment")
            .select("total_amount, client:profiles!orders_client_id_fkey(full_name, email)")
            .single();

          if (order) {
            const clientRow = Array.isArray(order.client) ? order.client[0] : order.client;
            sendOrderFailedEmail({
              orderId:     paymentId,
              clientName:  clientRow?.full_name ?? "Unknown",
              clientEmail: clientRow?.email     ?? "",
              totalAmount: order.total_amount,
              reason,
            }).catch(e => console.error("Admin order failed email error:", e));
          }
        }
        break;
      }

      // ── AD ───────────────────────────────────────────────────────────────────
      case "ad": {
        if (paymentStatus !== "COMPLETE") break;

        const now = new Date();
        const { data: ad } = await supabase
          .from("ads")
          .select("package, price, partner_id, partner:profiles!partner_id(full_name, email)")
          .eq("id", paymentId)
          .single();

        const WEEKS: Record<string, number> = {
          starter: 6, growth: 12, business: 16, premium: 24,
        };
        const AD_COUNTS: Record<string, number> = {
          starter: 1, growth: 3, business: 6, premium: 10,
        };
        const DURATION_LABELS: Record<string, string> = {
          starter: "6 weeks", growth: "3 months", business: "4 months", premium: "6 months",
        };
        const pkg       = ad?.package ?? "starter";
        const weeks     = WEEKS[pkg] ?? 6;
        const expiresAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

        await supabase
          .from("ads")
          .update({
            status:             "active",
            payfast_payment_id: pfPaymentId,
            starts_at:          now.toISOString(),
            expires_at:         expiresAt.toISOString(),
            moderation_status:  "scanning",
          })
          .eq("id", paymentId)
          .eq("status", "pending_payment");

        if (ad) {
          const partnerRow = Array.isArray(ad.partner) ? ad.partner[0] : ad.partner;
          sendAdPaidEmail({
            adId:          paymentId,
            clientName:    (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
            clientEmail:   (partnerRow as { email: string } | undefined)?.email ?? "",
            packageName:   pkg.charAt(0).toUpperCase() + pkg.slice(1),
            adsCount:      AD_COUNTS[pkg] ?? 1,
            durationLabel: DURATION_LABELS[pkg] ?? `${weeks} weeks`,
            amount:        ad.price ?? 0,
          }).catch(e => console.error("Ad paid email error:", e));
        }
        break;
      }

      // ── SALON ─────────────────────────────────────────────────────────────────
      case "salon": {
        if (paymentStatus !== "COMPLETE") break;

        const now     = new Date();
        const oneYear = new Date(now);
        oneYear.setFullYear(oneYear.getFullYear() + 1);

        const { data: payment } = await supabase
          .from("salon_subscription_payments")
          .update({ status: "paid", payfast_payment_id: pfPaymentId })
          .eq("id", paymentId)
          .eq("status", "pending")
          .select("salon_id, amount, partner:profiles!partner_id(full_name, email)")
          .single();

        if (payment?.salon_id) {
          await supabase
            .from("partner_salons")
            .update({ subscription_until: oneYear.toISOString() })
            .eq("id", payment.salon_id);

          // Fetch salon name for the email
          const { data: salon } = await supabase
            .from("partner_salons")
            .select("name")
            .eq("id", payment.salon_id)
            .single();

          const partnerRow = Array.isArray(payment.partner) ? payment.partner[0] : payment.partner;
          sendSalonPaidEmail({
            paymentId,
            clientName:  (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
            clientEmail: (partnerRow as { email: string } | undefined)?.email ?? "",
            salonName:   salon?.name ?? "Your salon",
            amount:      (payment as { amount?: number }).amount ?? 3500,
            expiresAt:   oneYear.toISOString(),
          }).catch(e => console.error("Salon paid email error:", e));
        }
        break;
      }

      default:
        console.warn("PayFast ITN: unknown payment type", paymentType, "for", paymentId);
    }
  } catch (err) {
    console.error("PayFast ITN processing error:", err);
    // Still return 200 — PayFast will retry on non-200 forever
  }

  return new NextResponse("OK", { status: 200 });
}
