// app/api/notifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendTextMessage } from "@/lib/whatsapp";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // Only authenticated users (partners / admin) can send manual notifications
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }

    const { type, bookingId } = await request.json();

    if (type === "reminder" && bookingId) {
      const admin = createAdminClient();

      const { data: booking, error } = await admin
        .from("bookings")
        .select(
          `
          booking_date, booking_time,
          client:profiles!bookings_client_id_fkey(full_name, phone),
          artist:artists!bookings_artist_id_fkey(display_name),
          service:services(name)
        `
        )
        .eq("id", bookingId)
        .single();

      if (error || !booking) {
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }

      const b = booking as any;

      if (!b.client?.phone) {
        return NextResponse.json({ error: "Client has no phone number" }, { status: 400 });
      }

      const text =
        `⏰ *Appointment Reminder*\n\n` +
        `Hi ${b.client.full_name}! Your appointment with *${b.artist.display_name}* ` +
        `is *tomorrow at ${b.booking_time}*.\n` +
        `💅 ${b.service.name}\n\nSee you soon! 💜`;

      await sendTextMessage(b.client.phone, text);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
  } catch (err) {
    console.error("Notifications route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
