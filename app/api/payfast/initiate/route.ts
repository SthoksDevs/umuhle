// app/api/payfast/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildPaymentParams, PAYFAST_URL } from "@/lib/payfast";
import { createClient } from "@/lib/supabase/server";
import { AD_PACKAGES, LISTING_PACKAGES } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { createPendingOrder } from "@/lib/orders";
import { isGatewayEnabled, GATEWAY_DISABLED_MESSAGE } from "@/lib/payments/gateways";

export async function POST(req: NextRequest) {
  if (!isGatewayEnabled("payfast")) {
    return NextResponse.json({ error: GATEWAY_DISABLED_MESSAGE }, { status: 503 });
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
  const type: "booking" | "order" | "ad" | "salon" | "product_listing" = body.type ?? "booking";

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

  const { data: service } = await supabase
    .from("services")
    .select("id, name, price, duration_minutes, artist_id")
    .eq("id", serviceId)
    .single();

  if (!service) return NextResponse.json({ error: "Service not found" }, { status: 404 });

  const { data: artist } = await supabase
    .from("artists")
    .select("display_name, point_of_contact_name, point_of_contact_phone")
    .eq("id", artistId)
    .single();

  // Use a fresh UUID as the payment ID — this is stored in booking_intents,
  // NOT in the bookings table yet.
  const intentId = uuidv4();

  const { error: intentErr } = await supabase.from("booking_intents").insert({
    id:               intentId,
    client_id:        userId,
    artist_id:        artistId,
    service_id:       serviceId,
    booking_date:     bookingDate,
    booking_time:     bookingTime,
    meeting_address:  meetingAddress || null,
    total_amount:     service.price,
    notes:            notes || null,
    client_poc_name:  clientPocName || null,
    client_poc_phone: clientPocPhone || null,
    artist_poc_name:  artist?.point_of_contact_name || null,
    artist_poc_phone: artist?.point_of_contact_phone || null,
    status:           "pending",
  });

  if (intentErr) {
    console.error("booking_intents insert error:", intentErr);
    return NextResponse.json({ error: "Could not create booking intent" }, { status: 500 });
  }

  const params = buildPaymentParams({
    paymentId:       intentId,
    amount:          service.price,
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
