// app/api/tradesafe/initiate/route.ts
//
// TradeSafe covers "booking", "order" and "store_booking_deposit" — every
// payment type that can involve a partner payout (artist, product seller,
// salon). "ad", "product_listing" and "salon" are always 100% Umuhle
// profit and are rejected outright below, same as anything under
// TradeSafe's R50 minimum — see lib/payments/eligibility.ts, which is the
// single source of truth both this route and the checkout UI
// (app/checkout/page.tsx, app/api/payments/gateways/route.ts) read from.
//
// This mirrors the shape of the old app/api/payfast/initiate/route.ts, but
// the mechanics are entirely different — see lib/tradesafe.ts's file header
// for why (GraphQL + escrow vs PayFast's form-post).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { initiateTradeSafeTransaction, buildReference } from "@/lib/tradesafe";
import { createPendingOrder } from "@/lib/orders";
import { createBookingIntent } from "@/lib/bookings";
import { isGatewayEnabled, gatewayLabel } from "@/lib/payments/gateways";
import { isGatewayEligible, whyTradeSafeIneligible } from "@/lib/payments/eligibility";
import type { PaymentType } from "@/lib/payments/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type TSProfile = { email: string; full_name?: string | null; phone?: string | null };

export async function POST(req: NextRequest) {
  if (!isGatewayEnabled("tradesafe")) {
    return NextResponse.json(
      { error: `${gatewayLabel("tradesafe")} is temporarily unavailable. Please choose a different payment method.`, code: "GATEWAY_DISABLED" },
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

  const [firstName, ...rest] = (profile.full_name ?? "").split(" ");
  const lastName = rest.join(" ") || "Customer";
  const buyer = { firstName: firstName || "Umuhle", lastName, email: profile.email, mobile: profile.phone ?? "" };

  try {
    switch (type) {
      case "booking":
        return await initiateBooking(supabase, user.id, profile, buyer, body);
      case "order":
        return await initiateOrder(supabase, user.id, profile, buyer, body);
      case "store_booking_deposit":
        return await initiateStoreBookingDeposit(supabase, user.id, profile, buyer, body);
      default:
        // ad / product_listing / salon are always Umuhle-profit-only —
        // TradeSafe is never eligible for them. See lib/payments/eligibility.ts.
        return NextResponse.json(
          { error: whyTradeSafeIneligible({ type, amountCents: 0, isUmuhleProfitOnly: true }) ?? "Please use Ozow for this payment.", code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("TradeSafe initiate error:", err);
    return NextResponse.json({ error: "Failed to initiate payment" }, { status: 500 });
  }
}

// ── Booking ───────────────────────────────────────────────────────────────────

async function initiateBooking(
  supabase: SupabaseServerClient,
  userId: string,
  profile: TSProfile,
  buyer: { firstName: string; lastName: string; email: string; mobile: string },
  body: Record<string, string>
) {
  const { serviceId, artistId, bookingDate, bookingTime, notes, meetingAddress, clientPocName, clientPocPhone } = body;

  const created = await createBookingIntent(supabase, userId, {
    paymentMethod: "tradesafe",
    serviceId, artistId, bookingDate, bookingTime, meetingAddress, notes, clientPocName, clientPocPhone,
  });
  if ("error" in created) {
    const status = created.error === "Service not found" ? 404 : created.error.includes("required") ? 400 : 500;
    return NextResponse.json({ error: created.error }, { status });
  }
  const { intentId, amount, service, artist } = created.result;

  if (!isGatewayEligible("tradesafe", { type: "booking", amountCents: amount })) {
    await supabase.from("booking_intents").update({ status: "cancelled" }).eq("id", intentId);
    return NextResponse.json(
      { error: whyTradeSafeIneligible({ type: "booking", amountCents: amount }), code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
  }

  const created_tx = await initiateTradeSafeTransaction({
    reference: buildReference("booking", intentId),
    title: `Booking: ${service.name}`,
    description: `${artist?.display_name ?? ""} — ${bookingDate} at ${bookingTime}`,
    amountCents: amount,
    buyer,
    daysToDeliver: 1,
    daysToInspect: 3,
  });

  await supabase
    .from("booking_intents")
    .update({ gateway_order_id: created_tx.transactionId, tradesafe_allocation_id: created_tx.allocationId })
    .eq("id", intentId);

  return NextResponse.json({ redirectUrl: created_tx.checkoutUrl });
}

// ── Order ─────────────────────────────────────────────────────────────────────

async function initiateOrder(
  supabase: SupabaseServerClient,
  userId: string,
  profile: TSProfile,
  buyer: { firstName: string; lastName: string; email: string; mobile: string },
  body: Record<string, unknown>
) {
  const { items, shippingAddress, contactName, contactWhatsapp } = body as {
    items: { productId: string; quantity: number }[];
    shippingAddress: string;
    contactName?: string;
    contactWhatsapp?: string;
  };

  const created = await createPendingOrder(supabase, userId, items, {
    paymentMethod: "tradesafe",
    shippingAddress,
    contactName,
    contactWhatsapp,
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 400 });
  const { orderId, totalAmount, lines, isUmuhleProfitOnly } = created.result;

  if (!isGatewayEligible("tradesafe", { type: "order", amountCents: totalAmount, isUmuhleProfitOnly })) {
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId);
    return NextResponse.json(
      { error: whyTradeSafeIneligible({ type: "order", amountCents: totalAmount, isUmuhleProfitOnly }), code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
  }

  const created_tx = await initiateTradeSafeTransaction({
    reference: buildReference("order", orderId),
    title: "Umuhle Shop Order",
    description: `${lines.length} item(s)`,
    amountCents: totalAmount,
    buyer,
    daysToDeliver: 14,
    daysToInspect: 7,
  });

  await supabase
    .from("orders")
    .update({
      gateway_order_id: created_tx.transactionId,
      tradesafe_transaction_id: created_tx.transactionId,
      tradesafe_allocation_id: created_tx.allocationId,
    })
    .eq("id", orderId);

  return NextResponse.json({ redirectUrl: created_tx.checkoutUrl });
}

// ── Store booking deposit ──────────────────────────────────────────────────────
// Deposits secure a customer's slot at a salon and belong to the salon,
// not Umuhle (confirmed 2026-08-06) — same eligibility treatment as a full
// booking. Escrow releases (and the salon's payout) fire from
// app/api/store-bookings/[id]/status/route.ts when the salon marks the
// booking "completed" — see recordStoreBookingDepositSplit /
// creditStoreBookingDepositPayout in lib/payouts.ts.

async function initiateStoreBookingDeposit(
  supabase: SupabaseServerClient,
  userId: string,
  profile: TSProfile,
  buyer: { firstName: string; lastName: string; email: string; mobile: string },
  body: Record<string, string>
) {
  const { salonId, branchId, employeeId, clientName, clientPhone, serviceId, bookingDate, bookingTime, notes } = body;

  if (!salonId || !clientName || !clientPhone || !serviceId || !bookingDate || !bookingTime) {
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

  if (!isGatewayEligible("tradesafe", { type: "store_booking_deposit", amountCents: service.deposit_amount })) {
    return NextResponse.json(
      { error: whyTradeSafeIneligible({ type: "store_booking_deposit", amountCents: service.deposit_amount }), code: "GATEWAY_INELIGIBLE", fallback: "ozow" },
      { status: 400 }
    );
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
      service: service.name,
      service_id: service.id,
      service_price: service.price,
      booking_date: bookingDate,
      booking_time: bookingTime,
      notes: notes || null,
      status: "pending",
      deposit_amount: service.deposit_amount,
      deposit_status: "pending",
      payment_method: "tradesafe",
    })
    .select("id")
    .single();

  if (error || !booking) {
    console.error("Failed to create store booking for deposit:", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }

  const created_tx = await initiateTradeSafeTransaction({
    reference: buildReference("store_booking_deposit", booking.id),
    title: `Booking deposit — ${salon.name}`,
    description: `${service.name} on ${bookingDate} at ${bookingTime}`,
    amountCents: service.deposit_amount,
    buyer,
    daysToDeliver: 1,
    daysToInspect: 3,
  });

  await supabase
    .from("store_bookings")
    .update({ gateway_order_id: created_tx.transactionId, tradesafe_allocation_id: created_tx.allocationId })
    .eq("id", booking.id);

  return NextResponse.json({ redirectUrl: created_tx.checkoutUrl });
}

