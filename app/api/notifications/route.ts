// app/api/notifications/route.ts
//
// Booking reminder cron. Originally triggered once/day by Vercel Cron (see
// vercel.json), which only ever put bookings in a coarse 12–24h lookahead
// window. It's now driven by a Supabase pg_cron job ("booking-reminders",
// every 15 min, via pg_net) that hits this route far more often, so the
// check below can be a precise "starts within the next 2 hours" window.
//
// Covers both booking tables: `bookings` (artist) and `store_bookings`
// (salon). WhatsApp (umuhle_booking_reminder template) is the primary
// client-facing channel — email (sendBookingReminderEmail) only fires if
// that WhatsApp send fails.
//
// reminder_sent flips to true after one attempt on each channel, success or
// not — with a 15-min cron cadence, retrying a persistently-failing number
// forever would just mean a fallback email every 15 min until the booking.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyBookingReminder, notifyStoreBookingReminder } from "@/lib/whatsapp";
import { sendBookingReminderEmail } from "@/lib/email";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// SAST (Africa/Johannesburg) is UTC+2 year-round — no DST — so hardcoding
// this offset is safe when combining booking_date + booking_time into a
// real instant to compare against `now`.
function bookingDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}+02:00`);
}

function isDueWithinTwoHours(date: string, time: string, now: Date): boolean {
  const dt = bookingDateTime(date, time).getTime();
  const nowMs = now.getTime();
  // hasn't started yet, and starts within the next 2 hours.
  return dt > nowMs && dt - nowMs <= TWO_HOURS_MS;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const now = new Date();

  // Cast a wide net (today + tomorrow, UTC) so we never miss a booking near
  // a date boundary — the precise check happens in JS above.
  const today    = now.toISOString().split("T")[0];
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  let artistSent = 0;
  let storeSent  = 0;

  // ── Artist bookings ────────────────────────────────────────────────────
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_date,
      booking_time,
      meeting_address,
      client_poc_phone,
      client:profiles!bookings_client_id_fkey(full_name, email, phone, whatsapp_comms_enabled),
      artist:artists!bookings_artist_id_fkey(
        display_name,
        point_of_contact_phone,
        profile:profiles!artists_profile_id_fkey(phone)
      ),
      service:services(name)
    `)
    .eq("status", "confirmed")
    .eq("reminder_sent", false)
    .gte("booking_date", today)
    .lte("booking_date", tomorrow);

  if (bookingsError) console.error("Reminder query error (bookings):", bookingsError);

  for (const booking of bookings ?? []) {
    if (!isDueWithinTwoHours(booking.booking_date, booking.booking_time, now)) continue;

    const clientRow = Array.isArray(booking.client) ? booking.client[0] : booking.client;
    const artistRow = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;
    const serviceRow = Array.isArray(booking.service) ? booking.service[0] : booking.service;
    const artistProfileRow = Array.isArray(artistRow?.profile) ? artistRow.profile[0] : artistRow?.profile;

    const clientPhone = clientRow?.phone as string | undefined;
    const artistPhone = artistProfileRow?.phone as string | undefined;

    try {
      if (clientPhone) {
        // Email is the default channel now — notifyBookingReminder only
        // actually sends the client-facing WhatsApp template when
        // clientWhatsappEnabled is true; when it's false, clientSent comes
        // back false and the email branch below fires instead. Artist/POC
        // messages inside notifyBookingReminder are NOT gated by the
        // client's own preference, so they still go out either way.
        const { clientSent } = await notifyBookingReminder({
          clientName: clientRow.full_name as string,
          clientPhone,
          artistName: artistRow.display_name as string,
          artistPhone: artistPhone ?? "",
          date: booking.booking_date,
          time: booking.booking_time,
          serviceName: serviceRow?.name as string,
          clientPocPhone: booking.client_poc_phone ?? undefined,
          artistPocPhone: artistRow?.point_of_contact_phone as string | undefined,
          clientWhatsappEnabled: clientRow?.whatsapp_comms_enabled ?? false,
        });

        if (!clientSent && clientRow?.email) {
          await sendBookingReminderEmail({
            bookingId: booking.id,
            clientName: clientRow.full_name as string,
            clientEmail: clientRow.email as string,
            providerName: artistRow.display_name as string,
            serviceName: serviceRow?.name as string,
            date: booking.booking_date,
            time: booking.booking_time,
            meetingAddress: booking.meeting_address ?? undefined,
            viewUrl: `https://umuhle.co.za/track/booking/${booking.id}`,
          });
        }
      } else if (clientRow?.email) {
        await sendBookingReminderEmail({
          bookingId: booking.id,
          clientName: clientRow.full_name as string,
          clientEmail: clientRow.email as string,
          providerName: artistRow?.display_name as string,
          serviceName: serviceRow?.name as string,
          date: booking.booking_date,
          time: booking.booking_time,
          meetingAddress: booking.meeting_address ?? undefined,
          viewUrl: `https://umuhle.co.za/track/booking/${booking.id}`,
        });
      }
    } catch (e) {
      console.error("Artist booking reminder error:", e);
    }

    await supabase.from("bookings").update({ reminder_sent: true }).eq("id", booking.id);
    artistSent++;
  }

  // ── Store (salon) bookings ─────────────────────────────────────────────
  const { data: storeBookings, error: storeError } = await supabase
    .from("store_bookings")
    .select(`
      id,
      client_id,
      client_name,
      client_phone,
      client_email,
      service,
      booking_date,
      booking_time,
      salon:partner_salons(name),
      client:profiles!client_id(whatsapp_comms_enabled)
    `)
    .eq("status", "confirmed")
    .eq("reminder_sent", false)
    .gte("booking_date", today)
    .lte("booking_date", tomorrow);

  if (storeError) console.error("Reminder query error (store_bookings):", storeError);

  for (const booking of storeBookings ?? []) {
    if (!isDueWithinTwoHours(booking.booking_date, booking.booking_time, now)) continue;

    const salonRow = Array.isArray(booking.salon) ? booking.salon[0] : booking.salon;
    // Guest/no-account bookings (client_id null) have no comms preference
    // to respect — those keep the original WhatsApp-primary behaviour.
    // Registered accounts default to email unless they've opted in.
    const clientProfileRow = Array.isArray(booking.client) ? booking.client[0] : booking.client;
    const whatsappAllowed = !booking.client_id || (clientProfileRow?.whatsapp_comms_enabled ?? false);

    try {
      if (booking.client_phone && whatsappAllowed) {
        const { clientSent } = await notifyStoreBookingReminder({
          clientName: booking.client_name,
          clientPhone: booking.client_phone,
          salonName: salonRow?.name ?? "your salon",
          date: booking.booking_date,
          time: booking.booking_time,
          serviceName: booking.service,
        });

        if (!clientSent && booking.client_email) {
          await sendBookingReminderEmail({
            bookingId: booking.id,
            clientName: booking.client_name,
            clientEmail: booking.client_email,
            providerName: salonRow?.name ?? "your salon",
            serviceName: booking.service,
            date: booking.booking_date,
            time: booking.booking_time,
            viewUrl: `https://umuhle.co.za/dashboard?tab=bookings`,
          });
        }
      } else if (booking.client_email) {
        await sendBookingReminderEmail({
          bookingId: booking.id,
          clientName: booking.client_name,
          clientEmail: booking.client_email,
          providerName: salonRow?.name ?? "your salon",
          serviceName: booking.service,
          date: booking.booking_date,
          time: booking.booking_time,
          viewUrl: `https://umuhle.co.za/dashboard?tab=bookings`,
        });
      }
    } catch (e) {
      console.error("Store booking reminder error:", e);
    }

    await supabase.from("store_bookings").update({ reminder_sent: true }).eq("id", booking.id);
    storeSent++;
  }

  return NextResponse.json({ artistSent, storeSent });
}
