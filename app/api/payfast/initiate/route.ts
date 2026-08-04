// app/api/payfast/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildPaymentParams, PAYFAST_URL } from "@/lib/payfast";
import { createClient } from "@/lib/supabase/server";
import { AD_PACKAGES, LISTING_PACKAGES } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { createPendingOrder } from "@/lib/orders";
import { createBookingIntent } from "@/lib/bookings";
import { isGatewayEnabled, gatewayLabel } from "@/lib/payments/gateways";

export async function POST(req: NextRequest) {
  if (!isGatewayEnabled("payfast")) {
    return NextResponse.json(
      { error: `${gatewayLabel("payfast")} is temporarily unavailable. Please choose a different payment method.` },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone, account_status")
    .eq("id", user.id)
    .single();

  if (!profile || profile.account_status !== "active") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 });
  }

  const body = await req.json();
  const type: "booking" | "order" | "ad" | "salon" | "product_listing" | "store_booking_deposit" = body.type ?? "booking";

  // Prefer the explicit env var; fall back to the request host so it also
  // works on preview deployments without re-setting the env var.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    `https://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;

  const [firstName, ...rest] = (profile.full_name ?? "").split(" ");
  const lastName = rest.join(" ") || "User";

  try {
    switch (type) {
      case "booking":
        return await initiateBooking(supabase, user.id, profile, firstName, lastName, body, baseUrl);
      case "order":
        return await initiateOrder(supabase, user.id, profile, firstName, lastName, body, baseUrl);
      case "ad":
        return await initiateAd(supabase, user.id, profile, firstName, lastName, body, baseUrl);
      case "product_listing":
        return await initiateProductListing(supabase, user.id, profile, firstName, lastName, body, baseUrl);
      case "salon":
        return await initiateSalon(supabase, user.id, profile, firstName, lastName, body, baseUrl);
      case "store_booking_deposit":
        return await initiateStoreBookingDeposit(supabase, user.id, profile, firstName, lastName, body, baseUrl);
      default:
        return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    }
  } catch (err) {
    console.error("PayFast initiate error:", err);
    return NextResponse.json({ error: "Failed to initiate payment" }, { status: 500 });
  }
}

// ── Booking ───────────────────────────────────────────────────────────────────
// CHANGED: no longer inserts into `bookings` here.
// Instead creates a `booking_intents` row. The ITN handler creates the real
// booking only once PayFast confirms COMPLETE, preventing orphaned rows.

async function initiateBooking(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  userId: string,
  profile: { email: string; full_name: string },
  firstName: string,
  lastName: string,
  body: Record<string, string>,
  baseUrl: string
) {
  const { serviceId, artistId, bookingDate, bookingTime, notes, meetingAddress, clientPocName, clientPocPhone } = body;

  const created = await createBookingIntent(supabase, userId, {
    paymentMethod: "payfast",
    serviceId, artistId, bookingDate, bookingTime, meetingAddress, notes, clientPocName, clientPocPhone,
  });
  if ("error" in created) {
    const status = created.error === "Service not found" ? 404 : created.error.includes("required") ? 400 : 500;
    return NextResponse.json({ error: created.error }, { status });
  }
  const { intentId, amount, service, artist } = created.result;

  const params = buildPaymentParams({
    paymentId:       intentId,
    amount,
    itemName:        `Booking: ${service.name}`,
    itemDescription: `${artist?.display_name ?? ""} — ${bookingDate} at ${bookingTime}`,
    firstName,
    lastName,
    email:           profile.email,
    baseUrl,
    customStr1:      "booking",
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}

// ── Order ─────────────────────────────────────────────────────────────────────
// Unchanged — orders table already uses pending_payment status correctly

async function initiateOrder(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  userId: string,
  profile: { email: string },
  firstName: string,
  lastName: string,
  body: Record<string, unknown>,
  baseUrl: string
) {
  const { items, shippingAddress, contactName, contactWhatsapp } = body as {
    items: { productId: string; quantity: number }[];
    shippingAddress: string;
    contactName?: string;
    contactWhatsapp?: string;
  };

  const created = await createPendingOrder(supabase, userId, items, {
    paymentMethod: "payfast",
    shippingAddress,
    contactName,
    contactWhatsapp,
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 400 });
  const { orderId, totalAmount, lines } = created.result;

  const params = buildPaymentParams({
    paymentId:       orderId,
    amount:          totalAmount,
    itemName:        `Umuhle Shop Order`,
    itemDescription: `${lines.length} item(s)`,
    firstName,
    lastName,
    email:           profile.email,
    baseUrl,
    customStr1:      "order",
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}

// ── Ad ────────────────────────────────────────────────────────────────────────

async function initiateAd(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  userId: string,
  profile: { email: string; is_partner?: boolean },
  firstName: string,
  lastName: string,
  body: Record<string, string>,
  baseUrl: string
) {
  const { packageId, title, description, imageUrl, linkUrl, category } = body;

  const pkg = AD_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) return NextResponse.json({ error: "Invalid package" }, { status: 400 });

  const adId = uuidv4();

  await supabase.from("ads").insert({
    id:                adId,
    partner_id:        userId,
    title,
    description:       description || null,
    image_url:         imageUrl || null,
    link_url:          linkUrl || null,
    category:          category || "general",
    package:           packageId,
    ads_count:         pkg.ads,
    price:             pkg.price,
    status:            "pending_payment",
    moderation_status: "draft",
  });

  const params = buildPaymentParams({
    paymentId:       adId,
    amount:          pkg.price,
    itemName:        `Umuhle Ad — ${pkg.name} Package`,
    itemDescription: `${pkg.ads} ad(s) for ${pkg.label}`,
    firstName,
    lastName,
    email:           profile.email,
    baseUrl,
    customStr1:      "ad",
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}

// ── Product listing ───────────────────────────────────────────────────────────
// The product row already exists at this point (ProductForm inserted it with
// listing_status: "pending_payment" before handing off here) — this just
// attaches a package + amount to it and builds the PayFast redirect, mirroring
// initiateAd() above. Reuses products.id as the PayFast m_payment_id, same as
// initiateAd reuses the ad's own id.

async function initiateProductListing(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  userId: string,
  profile: { email: string },
  firstName: string,
  lastName: string,
  body: Record<string, string>,
  baseUrl: string
) {
  const { productId, packageId } = body;

  const pkg = LISTING_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) return NextResponse.json({ error: "Invalid package" }, { status: 400 });

  const { data: product } = await supabase
    .from("products")
    .select("id, name, partner_id, listing_status")
    .eq("id", productId)
    .eq("partner_id", userId)
    .single();

  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!["pending_payment", "expired"].includes(product.listing_status ?? "")) {
    return NextResponse.json({ error: "This product isn't awaiting payment" }, { status: 400 });
  }

  await supabase
    .from("products")
    .update({ package: packageId, listing_status: "pending_payment" })
    .eq("id", productId);

  const params = buildPaymentParams({
    paymentId:       productId,
    amount:          pkg.price,
    itemName:        `Umuhle Listing — ${pkg.name} Package`,
    itemDescription: `"${product.name}" — ${pkg.ads} listing slot(s) for ${pkg.label}`,
    firstName,
    lastName,
    email:           profile.email,
    baseUrl,
    customStr1:      "product_listing",
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}

// ── Store booking deposit ──────────────────────────────────────────────────────
// Requires login (the account-active check at the top of this route already
// enforces that) — unlike the salon's free/no-deposit "Request booking" flow
// on the store page itself, which stays guest-friendly and never touches
// this route. The store_bookings row is inserted here, up front, mirroring
// initiateAd()/initiateSalon() above; the PayFast ITN (fulfillStoreBookingDeposit
// in lib/payments/fulfillment.ts) flips it to deposit_status "paid" /
// status "confirmed" once payment completes.

async function initiateStoreBookingDeposit(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  userId: string,
  profile: { email: string },
  firstName: string,
  lastName: string,
  body: Record<string, string>,
  baseUrl: string
) {
  const { salonId, branchId, employeeId, clientName, clientPhone, service, bookingDate, bookingTime, notes } = body;

  if (!salonId || !clientName || !clientPhone || !service || !bookingDate || !bookingTime) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  const { data: salon } = await supabase
    .from("partner_salons")
    .select("id, name, deposit_amount")
    .eq("id", salonId)
    .single();

  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  if (!salon.deposit_amount || salon.deposit_amount <= 0) {
    return NextResponse.json({ error: "This salon doesn't take deposits." }, { status: 400 });
  }

  const { data: booking, error } = await supabase
    .from("store_bookings")
    .insert({
      salon_id: salonId,
      branch_id: branchId || null,
      branch_employee_id: employeeId || null,
      client_id: userId,
      client_name: clientName,
      client_phone: clientPhone,
      service,
      booking_date: bookingDate,
      booking_time: bookingTime,
      notes: notes || null,
      status: "pending",
      deposit_amount: salon.deposit_amount,
      deposit_status: "pending",
      payment_method: "payfast",
    })
    .select("id")
    .single();

  if (error || !booking) {
    console.error("Failed to create store booking for deposit:", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }

  const params = buildPaymentParams({
    paymentId:       booking.id,
    amount:          salon.deposit_amount,
    itemName:        `Booking deposit — ${salon.name}`,
    itemDescription: `${service} on ${bookingDate} at ${bookingTime}`,
    firstName,
    lastName,
    email:           profile.email,
    baseUrl,
    customStr1:      "store_booking_deposit",
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}

// ── Salon ─────────────────────────────────────────────────────────────────────

async function initiateSalon(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  userId: string,
  profile: { email: string },
  firstName: string,
  lastName: string,
  body: Record<string, string>,
  baseUrl: string
) {
  const { salonId } = body;
  const SALON_PRICE = 3500; // R35 in cents

  const paymentId = uuidv4();

  await supabase.from("salon_subscription_payments").insert({
    id:         paymentId,
    salon_id:   salonId,
    partner_id: userId,
    amount:     SALON_PRICE,
    status:     "pending",
  });

  const params = buildPaymentParams({
    paymentId,
    amount:          SALON_PRICE,
    itemName:        "Umuhle Salon Listing — Annual Subscription",
    itemDescription: "12-month salon listing on Umuhle",
    firstName,
    lastName,
    email:           profile.email,
    baseUrl,
    customStr1:      "salon",
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}
