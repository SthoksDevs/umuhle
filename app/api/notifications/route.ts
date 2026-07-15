// app/api/notifications/route.ts
//
// Booking reminder cron — was previously a POST handler, which Vercel Cron
// can never actually trigger (it only ever sends GET requests to the paths
// listed in vercel.json). There was also no vercel.json in this repo at
// all, so this route had no scheduler wired to it yet either way. Both are
// fixed now: this is GET, and it's registered in vercel.json to run once a
// day. That's a safe default on any Vercel plan — Hobby rejects the entire
// deploy if any cron schedule fires more than once/day, so this defaults
// conservatively. If this project is on Pro/Enterprise and you want tighter
// coverage of the 12–24h reminder window, feel free to bump this one
// schedule (only this one) to e.g. every 6 hours.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyBookingReminder } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
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
      client:profiles!bookings_client_id_fkey(full_name, phone),
      artist:artists!bookings_artist_id_fkey(
        display_name,
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
    // Supabase returns joined rows as arrays when using foreign keys
    const clientRow = Array.isArray(booking.client) ? booking.client[0] : booking.client;
    const artistRow = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;
    const serviceRow = Array.isArray(booking.service) ? booking.service[0] : booking.service;
    const artistProfileRow = Array.isArray(artistRow?.profile) ? artistRow.profile[0] : artistRow?.profile;

    const clientPhone = clientRow?.phone as string | undefined;
    const artistPhone = artistProfileRow?.phone as string | undefined;

    if (!clientPhone || !artistPhone) continue;

    await notifyBookingReminder({
      clientName: clientRow.full_name as string,
      clientPhone,
      artistName: artistRow.display_name as string,
      artistPhone,
      date: booking.booking_date,
      time: booking.booking_time,
      serviceName: serviceRow?.name as string,
      clientPocPhone: booking.client_poc_phone ?? undefined,
      artistPocPhone: artistRow?.point_of_contact_phone as string | undefined,
    });

    await supabase
      .from("bookings")
      .update({ reminder_sent: true })
      .eq("id", booking.id);

    sent++;
  }

  return NextResponse.json({ sent });
}