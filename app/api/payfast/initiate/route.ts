// app/api/payfast/initiate/route.ts
//
// PayFast covers "booking", "order" and "store_booking_deposit" — every
// payment type that can involve a partner payout (artist, product seller,
// salon). "ad", "product_listing" and "salon" are always 100% Umuhle
// profit and are rejected outright below, same as anything under
// PayFast's R5 minimum — see lib/payments/eligibility.ts, which is the
// single source of truth both this route and the checkout UI
// (app/checkout/page.tsx, app/api/payments/gateways/route.ts) read from.
//
// Unlike PayFast (GraphQL + OAuth + escrow, removed 2026-08), PayFast is
// a direct-settlement gateway: the browser is POSTed straight to PayFast's
// hosted payment page with a signed set of form fields (see
// lib/payfast.ts), and PayFast pays Umuhle's account directly — no
// allocation/escrow lifecycle to track.

import { NextRequest, NextResponse } from "next/server";
import { buildPaymentParams, PAYFAST_URL } from "@/lib/payfast";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createPendingOrder, getOrderMutationClient, type CourierQuoteSelection } from "@/lib/orders";
import { createBookingIntent, getBookingMutationClient } from "@/lib/bookings";
import { isGatewayEnabled, gatewayLabel } from "@/lib/payments/gateways";
import { isGatewayEligible, whyPayFastIneligible } from "@/lib/payments/eligibility";
import { getSplitTarget, singleSellerProfileId } from "@/lib/payments/split";
import { splitCommission } from "@/lib/payouts";
import { isValidEmail } from "@/lib/validation";
import type { PaymentType } from "@/lib/payments/types";
import type { FulfillmentMethod } from "@/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type PFProfile = { email: string; full_name?: string | null; phone?: string | null };

export async function POST(req: NextRequest) {
  if (!isGatewayEnabled("payfast")) {
    return NextResponse.json(
      { error: `${gatewayLabel("payfast")} is temporarily unavailable. Please choose a different payment method.`, code: "GATEWAY_DISABLED" },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const body = await req.json();
  const type: PaymentType = body.type ?? "order";

  // Guest checkout (2026-09) covers shop orders, artist bookings, and
  // store booking deposits — see lib/orders.ts / lib/bookings.ts for how
  // each handles a null userId, and app/page.tsx / app/stores/[id]/page.tsx
  // for the guest-only contact fields each collects. Salon registration
  // (a business partner subscribing a salon to Umuhle) is a business
  // action, not a customer purchase, so it's the one type still gated
  // behind a real, active account.
  let profile: PFProfile | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, email, phone, account_status")
      .eq("id", user.id)
      .single();

    if (!data || data.account_status !== "active") {
      return NextResponse.json({ error: "Account not active" }, { status: 403 });
    }
    profile = data;
  } else if (type === "salon") {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Prefer the explicit env var; fall back to the request host so it also
  // works on preview deployments without re-setting the env var.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    `https://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;

  // Guests have no profile.full_name — fall back to whichever contact
  // field this payment type collects: "contactName" for orders and
  // artist bookings, "clientName" for store bookings (that form's own
  // field name, always collected regardless of login — see
  // initiateStoreBookingDeposit below).
  const [firstName, ...rest] = (
    profile?.full_name ?? (body.contactName as string | undefined) ?? (body.clientName as string | undefined) ?? ""
  ).split(" ");
  const lastName = rest.join(" ") || "Customer";

  try {
    switch (type) {
      case "booking":
        return await initiateBooking(supabase, user?.id ?? null, profile, firstName, lastName, body, baseUrl);
      case "order":
        return await initiateOrder(supabase, user?.id ?? null, profile, firstName, lastName, body, baseUrl);
      case "store_booking_deposit":
        return await initiateStoreBookingDeposit(supabase, user?.id ?? null, profile, firstName, lastName, body, baseUrl);
      default:
        // ad / product_listing / salon are always Umuhle-profit-only —
        // PayFast is never eligible for them. See lib/payments/eligibility.ts.
        return NextResponse.json(
          { error: whyPayFastIneligible({ type, amountCents: 0, isUmuhleProfitOnly: true }) ?? "Please use Ozow for this payment.", code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("PayFast initiate error:", err);
    return NextResponse.json({ error: "Failed to initiate payment" }, { status: 500 });
  }
}

// ── Booking ───────────────────────────────────────────────────────────────────

async function initiateBooking(
  supabase: SupabaseServerClient,
  userId: string | null,
  profile: PFProfile | null,
  firstName: string,
  lastName: string,
  body: Record<string, unknown>,
  baseUrl: string
) {
  const { serviceId, artistId, bookingDate, bookingTime, notes, meetingAddress, clientPocName, clientPocPhone, contactName, contactEmail } =
    body as Record<string, string>;
  // Upsell products added during this booking (2026-09) — paid together
  // with the booking itself in one transaction. See
  // bundled_booking_upsell_payments migration and lib/bookings.ts's
  // createBookingIntent for the vendor-match rule this enables.
  const upsellItems = body.upsellItems as { productId: string; quantity: number }[] | undefined;

  // Guests have no profile.email — PayFast needs a real email address to
  // charge a card, and it's also fulfillBooking()'s (lib/payments/
  // fulfillment.ts) fallback identity for the booking confirmation email
  // when there's no logged-in profile to join against. See app/page.tsx's
  // BookingDrawer for the guest-only email field this comes from.
  //
  // Trimmed + format-checked here (not just presence-checked) because an
  // untrimmed or malformed address used to sail straight through to
  // PayFast's hosted checkout form, which validates email_address itself
  // and rejects the whole POST with a 400 "malformed email" error — a
  // dead end on PayFast's own page instead of a message back in the app.
  // createBookingIntent() below re-checks format too (see lib/bookings.ts)
  // so Ozow's guest booking path — which shares this same helper — is
  // covered as well, but rejecting early here also skips a wasted
  // booking_intents insert for a request that can't succeed anyway.
  const email = (profile?.email ?? contactEmail ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "Please provide an email address to pay with PayFast." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "That email address doesn't look right — please double-check it and try again." }, { status: 400 });
  }

  const created = await createBookingIntent(supabase, userId, {
    paymentMethod: "payfast",
    serviceId, artistId, bookingDate, bookingTime, meetingAddress, notes, clientPocName, clientPocPhone,
    contactName, contactEmail: email,
    upsellItems,
  });
  if ("error" in created) {
    const status = created.error === "Service not found" ? 404 : created.error.includes("required") ? 400 : 500;
    return NextResponse.json({ error: created.error }, { status });
  }
  const { intentId, amountDue, vendorMismatch, service, artist } = created.result;

  // PayFast can only split one transaction to one merchant — a bundled
  // payment where an upsell item belongs to a different seller than the
  // artist can never be that artist's own instant split, so it isn't
  // offered PayFast at all. This is a NEW rule specific to bundled
  // booking+upsell payments, checked here rather than folded into
  // lib/payments/eligibility.ts — that file stays the single source of
  // truth for every other payment type, unaffected by this one.
  if (vendorMismatch) {
    const mutClient = await getBookingMutationClient();
    await mutClient.from("booking_intents").update({ status: "cancelled" }).eq("id", intentId);
    return NextResponse.json(
      { error: "One of the upsell items belongs to a different seller than the artist, so this payment can only go through Ozow.", code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
  }

  if (!isGatewayEligible("payfast", { type: "booking", amountCents: amountDue })) {
    const mutClient = await getBookingMutationClient();
    await mutClient.from("booking_intents").update({ status: "cancelled" }).eq("id", intentId);
    return NextResponse.json(
      { error: whyPayFastIneligible({ type: "booking", amountCents: amountDue }), code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
  }

  // If eligible, persist the decision onto the intent NOW — fulfillBooking
  // (lib/payments/fulfillment.ts) reads intent.payout_via when it creates
  // the final `bookings` row, so this has to be settled before the
  // customer ever reaches PayFast, not decided again later. Uses the
  // service client — booking_intents' UPDATE policy is client_id =
  // auth.uid(), which can never pass for a guest booking (client_id null)
  // regardless of who's calling.
  //
  // Split against amountDue (service + any upsells), not the service price
  // alone — vendorMismatch is already false by this point, so every
  // upsell item (if any) belongs to this same artist, and PayFast is
  // splitting ONE lump sum covering both to their one merchant account.
  const { payoutCents } = splitCommission(amountDue);
  const split = artistId ? await getSplitTargetForArtist(supabase, artistId, payoutCents) : null;
  if (split) {
    const mutClient = await getBookingMutationClient();
    await mutClient.from("booking_intents").update({ payout_via: "instant_split" }).eq("id", intentId);
  }

  const params = buildPaymentParams({
    paymentId:       intentId,
    amount:          amountDue,
    itemName:        `Booking: ${service.name}`,
    itemDescription: `${artist?.display_name ?? ""} — ${bookingDate} at ${bookingTime}`,
    firstName,
    lastName,
    email,
    baseUrl,
    customStr1:      "booking",
    split:           split ?? undefined,
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}

/**
 * Resolves an artist's profile_id and checks split eligibility in one
 * step — see lib/payments/split.ts for the actual eligibility rule
 * (merchant ID on file AND admin-approved).
 */
async function getSplitTargetForArtist(supabase: SupabaseServerClient, artistId: string, payoutCents: number) {
  const { data: artist } = await supabase.from("artists").select("profile_id").eq("id", artistId).single();
  if (!artist?.profile_id) return null;
  return getSplitTarget(supabase, artist.profile_id, payoutCents);
}

// ── Order ─────────────────────────────────────────────────────────────────────

async function initiateOrder(
  supabase: SupabaseServerClient,
  userId: string | null,
  profile: PFProfile | null,
  firstName: string,
  lastName: string,
  body: Record<string, unknown>,
  baseUrl: string
) {
  const {
    items, shippingAddress, contactName, contactWhatsapp, contactEmail,
    fulfillmentByPartner, shippingAddressLine1, shippingAddressLine2,
    shippingSuburb, shippingCity, shippingProvince, shippingPostalCode,
    courierQuotes,
  } = body as {
    items: { productId: string; quantity: number }[];
    shippingAddress: string;
    contactName?: string;
    contactWhatsapp?: string;
    // Guest checkout only — PayFast requires a real email address and a
    // guest has no profile.email to fall back to. See email lookup below.
    contactEmail?: string;
    fulfillmentByPartner?: Record<string, FulfillmentMethod>;
    shippingAddressLine1?: string;
    shippingAddressLine2?: string;
    shippingSuburb?: string;
    shippingCity?: string;
    shippingProvince?: string;
    shippingPostalCode?: string;
    // Live Ship Logic quote per courier partner, fetched by the checkout
    // page via POST /api/checkout/courier-rates just before submit — see
    // CourierQuoteSelection in lib/orders.ts.
    courierQuotes?: Record<string, CourierQuoteSelection>;
  };

  const email = (profile?.email ?? contactEmail ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "Please provide an email address to pay with PayFast." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "That email address doesn't look right — please double-check it and try again." }, { status: 400 });
  }

  const created = await createPendingOrder(supabase, userId, items, {
    paymentMethod: "payfast",
    shippingAddress,
    contactName,
    contactWhatsapp,
    contactEmail: email,
    fulfillmentByPartner,
    courierQuotesByPartner: courierQuotes,
    shippingAddressLine1,
    shippingAddressLine2,
    shippingSuburb,
    shippingCity,
    shippingProvince,
    shippingPostalCode,
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 400 });
  const { orderId, totalAmount, lines, isUmuhleProfitOnly } = created.result;

  if (!isGatewayEligible("payfast", { type: "order", amountCents: totalAmount, isUmuhleProfitOnly })) {
    const mutClient = await getOrderMutationClient();
    await mutClient.from("orders").update({ status: "cancelled" }).eq("id", orderId);
    return NextResponse.json(
      { error: whyPayFastIneligible({ type: "order", amountCents: totalAmount, isUmuhleProfitOnly }), code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
  }

  // Only offered when every non-Umuhle line in the cart belongs to the
  // SAME seller — PayFast can only split one transaction to one secondary
  // merchant (see lib/payments/split.ts). A cart mixing Umuhle's own
  // stock with one partner's products is still fine; Umuhle just keeps
  // its own share automatically since it's the primary account.
  const split = await getSplitTargetForOrder(orderId);
  if (split) {
    const mutClient = await getOrderMutationClient();
    await mutClient.from("orders").update({ payout_via: "instant_split" }).eq("id", orderId);
  }

  const params = buildPaymentParams({
    paymentId:       orderId,
    amount:          totalAmount,
    itemName:        "Umuhle Shop Order",
    itemDescription: `${lines.length} item(s)`,
    firstName,
    lastName,
    email,
    baseUrl,
    customStr1:      "order",
    split:           split ?? undefined,
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}

/**
 * Resolves whether this order can split to a single partner, and how
 * much. Excludes Umuhle-owned lines (products.is_umuhle_product) from
 * both the seller-uniqueness check and the payout total — see the
 * comment above this function's call site.
 *
 * Always runs on the service client — this is an internal computation
 * over data this same request already created moments ago (orderId), not
 * something that should be filtered by whoever's session happens to be
 * attached to the request (including no session at all, for a guest
 * checkout — order_items' RLS read policy is client_id-scoped same as
 * orders', so a guest's own anon session would just see zero rows here).
 */
async function getSplitTargetForOrder(orderId: string) {
  const supabase = await createServiceClient();
  const { data: items } = await supabase
    .from("order_items")
    .select("unit_price, quantity, product:products(partner_id, is_umuhle_product)")
    .eq("order_id", orderId);
  if (!items || items.length === 0) return null;

  type Row = { unit_price: number; quantity: number; product: { partner_id: string | null; is_umuhle_product: boolean } | { partner_id: string | null; is_umuhle_product: boolean }[] | null };
  const partnerLines = (items as Row[])
    .map((i) => ({ ...i, product: Array.isArray(i.product) ? i.product[0] : i.product }))
    .filter((i) => i.product && !i.product.is_umuhle_product);

  const sellerId = singleSellerProfileId(partnerLines.map((i) => i.product?.partner_id));
  if (!sellerId) return null;

  const partnerTotal = partnerLines
    .filter((i) => i.product?.partner_id === sellerId)
    .reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const { payoutCents } = splitCommission(partnerTotal);
  return getSplitTarget(supabase, sellerId, payoutCents);
}

// ── Store booking deposit ──────────────────────────────────────────────────────
// Deposits secure a customer's slot at a salon and belong to the salon,
// not Umuhle — same eligibility treatment as a full booking. The salon's
// payout fires from app/api/store-bookings/[id]/status/route.ts when the
// salon marks the booking "completed" — see recordStoreBookingDepositSplit /
// creditStoreBookingDepositPayout in lib/payouts.ts (both gateway-agnostic,
// unchanged by this migration).

async function initiateStoreBookingDeposit(
  supabase: SupabaseServerClient,
  userId: string | null,
  profile: PFProfile | null,
  firstName: string,
  lastName: string,
  body: Record<string, string>,
  baseUrl: string
) {
  const { salonId, branchId, employeeId, clientName, clientPhone, serviceId, bookingDate, bookingTime, notes } = body;
  const clientEmail = body.clientEmail?.trim();

  if (!salonId || !clientName || !clientPhone || !clientEmail || !serviceId || !bookingDate || !bookingTime) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }
  if (!isValidEmail(clientEmail)) {
    return NextResponse.json({ error: "That email address doesn't look right — please double-check it and try again." }, { status: 400 });
  }

  const { data: salon } = await supabase.from("partner_salons").select("id, name").eq("id", salonId).single();
  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });

  const { data: service } = await supabase
    .from("salon_services")
    .select("id, name, price, deposit_amount")
    .eq("id", serviceId)
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .single();

  if (!service) return NextResponse.json({ error: "That service is no longer available." }, { status: 404 });

  // Every service requires payment to book — the configured deposit if
  // the partner set one, otherwise the full service price. No more
  // free/no-payment booking path.
  const amountDue = service.deposit_amount && service.deposit_amount > 0 ? service.deposit_amount : service.price;
  const isFullPayment = !service.deposit_amount || service.deposit_amount <= 0;

  if (!isGatewayEligible("payfast", { type: "store_booking_deposit", amountCents: amountDue })) {
    return NextResponse.json(
      { error: whyPayFastIneligible({ type: "store_booking_deposit", amountCents: amountDue }), code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
  }

  const { payoutCents } = splitCommission(amountDue);
  const split = await getSplitTargetForSalon(supabase, salonId, payoutCents);

  const { data: booking, error } = await supabase
    .from("store_bookings")
    .insert({
      salon_id: salonId,
      branch_id: branchId || null,
      branch_employee_id: employeeId || null,
      client_id: userId,
      client_name: clientName,
      client_phone: clientPhone,
      client_email: clientEmail,
      service: service.name,
      service_id: service.id,
      service_price: service.price,
      booking_date: bookingDate,
      booking_time: bookingTime,
      notes: notes || null,
      status: "pending",
      deposit_amount: amountDue,
      deposit_status: "pending",
      payment_method: "payfast",
      payout_via: split ? "instant_split" : "wallet",
    })
    .select("id")
    .single();

  if (error || !booking) {
    console.error("Failed to create store booking for deposit:", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }

  const params = buildPaymentParams({
    paymentId:       booking.id,
    amount:          amountDue,
    itemName:        isFullPayment ? `Booking payment — ${salon.name}` : `Booking deposit — ${salon.name}`,
    itemDescription: `${service.name} on ${bookingDate} at ${bookingTime}`,
    firstName,
    lastName,
    email:           clientEmail,
    baseUrl,
    customStr1:      "store_booking_deposit",
    split:           split ?? undefined,
  });

  return NextResponse.json({ payfastUrl: PAYFAST_URL, params });
}

/** Resolves a salon's owner profile_id and checks split eligibility. */
async function getSplitTargetForSalon(supabase: SupabaseServerClient, salonId: string, payoutCents: number) {
  const { data: salon } = await supabase.from("partner_salons").select("partner_id").eq("id", salonId).single();
  if (!salon?.partner_id) return null;
  return getSplitTarget(supabase, salon.partner_id, payoutCents);
}
