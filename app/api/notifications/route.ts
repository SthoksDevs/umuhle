// app/api/notifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyBookingReminder } from "@/lib/whatsapp";

// Called by a cron job (e.g. Vercel Cron or external scheduler) every hour.
// Sends WhatsApp reminders for bookings starting in 12-24 hours that haven't been reminded yet.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  const now = new Date();
  const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_date,
      booking_time,
      client_poc_phone,
      artist_poc_phone,
      client:profiles!bookings_client_id_fkey(full_name, phone),
      artist:artists!bookings_artist_id_fkey(
        display_name,
        point_of_contact_name,
        point_of_contact_phone,
        profile:profiles!artists_profile_id_fkey(phone)
      ),
      service:services(name, duration_minutes)
    `)
    .eq("status", "confirmed")
    .eq("reminder_sent", false)
    .gte("booking_date", in12h.toISOString().split("T")[0])
    .lte("booking_date", in24h.toISOString().split("T")[0]);

  if (error) {
    console.error("Reminder query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;

  for (const booking of bookings ?? []) {
    const clientPhone = (booking.client as { phone?: string })?.phone;
    const artistPhone = (booking.artist as { profile?: { phone?: string } })?.profile?.phone;

    if (!clientPhone || !artistPhone) continue;

    const artist = booking.artist as { display_name: string; point_of_contact_phone?: string };
    const client = booking.client as { full_name: string };
    const service = booking.service as { name: string; duration_minutes: number };

    await notifyBookingReminder({
      clientName: client.full_name,
      clientPhone,
      artistName: artist.display_name,
      artistPhone,
      date: booking.booking_date,
      time: booking.booking_time,
      serviceName: service.name,
      clientPocPhone: booking.client_poc_phone ?? undefined,
      artistPocPhone: artist.point_of_contact_phone ?? undefined,
    });

    await supabase
      .from("bookings")
      .update({ reminder_sent: true })
      .eq("id", booking.id);

    sent++;
  }

  return NextResponse.json({ sent });
}