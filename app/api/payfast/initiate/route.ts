// app/api/payfast/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildPaymentParams, PAYFAST_URL } from "@/lib/payfast";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // 1. Verify user is logged in
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }

    // 2. Parse request body
    const { bookingId, serviceId, artistId, bookingDate, bookingTime, notes } =
      await request.json();

    if (!bookingId || !serviceId || !artistId || !bookingDate || !bookingTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 3. Fetch service to get price
    const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("id, name, price, artist_id")
      .eq("id", serviceId)
      .single();

    if (serviceError || !service) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    // 4. Fetch client profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, email, phone")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // 5. Create or update booking record as pending_payment
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .upsert({
        id: bookingId,
        client_id: user.id,
        artist_id: artistId,
        service_id: serviceId,
        booking_date: bookingDate,
        booking_time: bookingTime,
        status: "pending_payment",
        total_amount: service.price,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (bookingError) {
      console.error("Booking upsert error:", bookingError);
      return NextResponse.json({ error: "Could not create booking" }, { status: 500 });
    }

    // 6. Build PayFast params
    const nameParts = (profile.full_name ?? "").trim().split(" ");
    const firstName = nameParts[0] ?? "Client";
    const lastName = nameParts.slice(1).join(" ") || "Umuhle";

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL!;

    const params = buildPaymentParams({
      paymentId: booking.id,
      amount: service.price,
      itemName: `Umuhle: ${service.name}`,
      itemDescription: `Booking on ${bookingDate} at ${bookingTime}`,
      firstName,
      lastName,
      email: profile.email ?? user.email!,
      baseUrl,
    });

    return NextResponse.json({
      payfastUrl: PAYFAST_URL,
      params,
    });
  } catch (err) {
    console.error("PayFast initiate error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
