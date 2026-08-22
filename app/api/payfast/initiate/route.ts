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
import { createClient } from "@/lib/supabase/server";
import { createPendingOrder } from "@/lib/orders";
import { createBookingIntent } from "@/lib/bookings";
import { isGatewayEnabled, gatewayLabel } from "@/lib/payments/gateways";
import { isGatewayEligible, whyPayFastIneligible } from "@/lib/payments/eligibility";
import { getSplitTarget, singleSellerProfileId } from "@/lib/payments/split";
import { splitCommission } from "@/lib/payouts";
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
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone, account_status")
    .eq("id", user.id)
    .single();

  if (!profile || profile.account_status !== "active") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 });
  }

  const body = await req.json();
  const type: PaymentType = body.type ?? "order";

  // Prefer the explicit env var; fall back to the request host so it also
  // works on preview deployments without re-setting the env var.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    `https://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;

  const [firstName, ...rest] = (profile.full_name ?? "").split(" ");
  const lastName = rest.join(" ") || "Customer";

  try {
    switch (type) {
      case "booking":
        return await initiateBooking(supabase, user.id, profile, firstName, lastName, body, baseUrl);
      case "order":
        return await initiateOrder(supabase, user.id, profile, firstName, lastName, body, baseUrl);
      case "store_booking_deposit":
        return await initiateStoreBookingDeposit(supabase, user.id, profile, firstName, lastName, body, baseUrl);
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
  userId: string,
  profile: PFProfile,
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

  if (!isGatewayEligible("payfast", { type: "booking", amountCents: amount })) {
    await supabase.from("booking_intents").update({ status: "cancelled" }).eq("id", intentId);
    return NextResponse.json(
      { error: whyPayFastIneligible({ type: "booking", amountCents: amount }), code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
  }

  // If eligible, persist the decision onto the intent NOW — fulfillBooking
  // (lib/payments/fulfillment.ts) reads intent.payout_via when it creates
  // the final `bookings` row, so this has to be settled before the
  // customer ever reaches PayFast, not decided again later.
  const { payoutCents } = splitCommission(amount);
  const split = artistId ? await getSplitTargetForArtist(supabase, artistId, payoutCents) : null;
  if (split) {
    await supabase.from("booking_intents").update({ payout_via: "instant_split" }).eq("id", intentId);
  }

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
  userId: string,
  profile: PFProfile,
  firstName: string,
  lastName: string,
  body: Record<string, unknown>,
  baseUrl: string
) {
  const {
    items, shippingAddress, contactName, contactWhatsapp,
    fulfillmentByPartner, shippingAddressLine1, shippingAddressLine2,
    shippingSuburb, shippingCity, shippingProvince, shippingPostalCode,
  } = body as {
    items: { productId: string; quantity: number }[];
    shippingAddress: string;
    contactName?: string;
    contactWhatsapp?: string;
    fulfillmentByPartner?: Record<string, FulfillmentMethod>;
    shippingAddressLine1?: string;
    shippingAddressLine2?: string;
    shippingSuburb?: string;
    shippingCity?: string;
    shippingProvince?: string;
    shippingPostalCode?: string;
  };

  const created = await createPendingOrder(supabase, userId, items, {
    paymentMethod: "payfast",
    shippingAddress,
    contactName,
    contactWhatsapp,
    fulfillmentByPartner,
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
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId);
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
  const split = await getSplitTargetForOrder(supabase, orderId);
  if (split) {
    await supabase.from("orders").update({ payout_via: "instant_split" }).eq("id", orderId);
  }

  const params = buildPaymentParams({
    paymentId:       orderId,
    amount:          totalAmount,
    itemName:        "Umuhle Shop Order",
    itemDescription: `${lines.length} item(s)`,
    firstName,
    lastName,
    email:           profile.email,
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
 */
async function getSplitTargetForOrder(supabase: SupabaseServerClient, orderId: string) {
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
  userId: string,
  profile: PFProfile,
  firstName: string,
  lastName: string,
  body: Record<string, string>,
  baseUrl: string
) {
  const { salonId, branchId, employeeId, clientName, clientPhone, clientEmail, serviceId, bookingDate, bookingTime, notes } = body;

  if (!salonId || !clientName || !clientPhone || !clientEmail || !serviceId || !bookingDate || !bookingTime) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
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
  if (!service.deposit_amount || service.deposit_amount <= 0) {
    return NextResponse.json({ error: "This service doesn't take a deposit." }, { status: 400 });
  }

  if (!isGatewayEligible("payfast", { type: "store_booking_deposit", amountCents: service.deposit_amount })) {
    return NextResponse.json(
      { error: whyPayFastIneligible({ type: "store_booking_deposit", amountCents: service.deposit_amount }), code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
  }

  const { payoutCents } = splitCommission(service.deposit_amount);
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
      deposit_amount: service.deposit_amount,
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
    amount:          service.deposit_amount,
    itemName:        `Booking deposit — ${salon.name}`,
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
