// app/api/vendor/shipments/[id]/book/route.ts
//
// Books a real Ship Logic (The Courier Guy) shipment for one
// order_shipments row — one parcel per partner per order, see
// lib/orders.ts. This is the "Book with Courier Guy" action in
// app/dashboard/page.tsx's ShipmentsManager; manual waybill entry there
// still works as a fallback/override (e.g. the partner arranged their own
// courier outside the platform).
//
// A shipment can bundle several order_items (a partner's whole order, not
// just one line) — unlike app/api/vendor/order-items/[id]/ship, which
// dispatches one line at a time, booking here is necessarily all-or-
// nothing: Ship Logic returns ONE waybill covering the whole parcel, so
// every order_item riding in it gets marked shipped (and notified)
// together, in the same loop as the per-item route uses.
//
// Idempotent: calling this again on an already-booked shipment just
// returns the existing waybill — no second Ship Logic booking, no
// duplicate notifications.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  getRates, createShipment, buildAddress, buildParcel,
  COURIER_PROVIDER_LABEL, COURIER_PROVIDER_LABEL_MOCK,
} from "@/lib/shiplogic";
import { sendOrderItemShippedEmail } from "@/lib/email";
import { notifyOrderItemShipped } from "@/lib/whatsapp";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Same set app/api/vendor/order-items/[id]/ship uses — a shipment on an
// unpaid or cancelled order has nothing to book.
const SHIPPABLE_ORDER_STATUSES = ["paid", "processing", "shipped"];

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const shipmentId = params.id;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: shipment, error: shipmentError } = await service
    .from("order_shipments")
    .select(`
      id, order_id, partner_id, fulfillment_method, status,
      origin_address, origin_suburb, origin_city, origin_province, origin_postal_code, origin_latitude, origin_longitude,
      destination_address_line1, destination_address_line2, destination_suburb, destination_city, destination_province, destination_postal_code,
      parcel_weight_g, parcel_length_cm, parcel_width_cm, parcel_height_cm,
      service_level_code, waybill_number,
      order:orders(id, status, client_id, contact_name, contact_whatsapp)
    `)
    .eq("id", shipmentId)
    .single();

  if (shipmentError || !shipment) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  if (shipment.partner_id !== user.id) {
    // Same response for "doesn't exist" and "exists but isn't yours".
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }
  if (shipment.fulfillment_method !== "courier") {
    return NextResponse.json({ error: "This parcel is a collection, not a courier shipment." }, { status: 400 });
  }

  const order = Array.isArray(shipment.order) ? shipment.order[0] : shipment.order;
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!SHIPPABLE_ORDER_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: `Can't book a shipment on an order that's "${order.status}"` }, { status: 400 });
  }

  // Already booked — idempotent no-op.
  if (shipment.waybill_number) {
    return NextResponse.json({ ok: true, alreadyBooked: true, shipment });
  }

  const { data: partnerProfile } = await service
    .from("profiles")
    .select("full_name, phone")
    .eq("id", shipment.partner_id)
    .single();

  const collection = buildAddress({
    company: partnerProfile?.full_name ?? undefined,
    streetAddress: shipment.origin_address,
    suburb: shipment.origin_suburb,
    city: shipment.origin_city,
    province: shipment.origin_province,
    postalCode: shipment.origin_postal_code,
    isBusiness: true,
  });
  const delivery = buildAddress({
    streetAddress: shipment.destination_address_line1,
    suburb: shipment.destination_suburb,
    city: shipment.destination_city,
    province: shipment.destination_province,
    postalCode: shipment.destination_postal_code,
  });
  const parcels = [buildParcel({
    weightG: shipment.parcel_weight_g,
    lengthCm: shipment.parcel_length_cm,
    widthCm: shipment.parcel_width_cm,
    heightCm: shipment.parcel_height_cm,
  })];

  // Declared value — sum of the order_items riding in this shipment,
  // fetched alongside so the same query also gives us who to notify below.
  const { data: shipmentItems } = await service
    .from("order_items")
    .select(`
      id, quantity, unit_price, shipped_at, confirm_token,
      product:products(id, name)
    `)
    .eq("shipment_id", shipmentId);

  const declaredValueCents = (shipmentItems ?? []).reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  // Honour the service level quoted at checkout if we have one; otherwise
  // (an order predating this feature, or the quote step failed at
  // checkout) fetch fresh rates now and take the cheapest.
  let serviceLevelCode = shipment.service_level_code;
  if (!serviceLevelCode) {
    try {
      const { rates } = await getRates({ collection, delivery, parcels, declaredValueCents });
      if (rates.length === 0) {
        return NextResponse.json({ error: "No courier rates available for this route — enter a waybill manually instead." }, { status: 502 });
      }
      serviceLevelCode = rates.reduce((a, b) => (b.rateCents < a.rateCents ? b : a)).serviceLevelCode;
    } catch (err) {
      console.error(`[vendor/shipments/${shipmentId}/book] rate fallback failed:`, err);
      return NextResponse.json({ error: "Couldn't reach the courier for a rate — enter a waybill manually instead." }, { status: 502 });
    }
  }

  let booked;
  try {
    booked = await createShipment({
      collection,
      delivery,
      parcels,
      declaredValueCents,
      serviceLevelCode,
      reference: shipmentId,
      collectionContactName: partnerProfile?.full_name ?? null,
      collectionContactPhone: partnerProfile?.phone ?? null,
      deliveryContactName: order.contact_name ?? null,
      deliveryContactPhone: order.contact_whatsapp ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Booking failed";
    await service.from("order_shipments").update({ courier_error: message.slice(0, 500) }).eq("id", shipmentId);
    console.error(`[vendor/shipments/${shipmentId}/book] booking failed:`, err);
    return NextResponse.json({ error: "Couldn't book with the courier — enter a waybill manually instead, or try again shortly." }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const { data: updatedShipment, error: updateErr } = await service
    .from("order_shipments")
    .update({
      courier_provider: booked.isMock ? COURIER_PROVIDER_LABEL_MOCK : COURIER_PROVIDER_LABEL,
      waybill_number: booked.waybillNumber,
      tracking_url: booked.trackingUrl,
      courier_reference: booked.shiplogicShipmentId,
      courier_booked_at: nowIso,
      status: "booked",
      courier_status: "booked",
      courier_synced_at: nowIso,
      courier_error: null,
    })
    .eq("id", shipmentId)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Mark every not-yet-shipped item in this parcel dispatched, and notify
  // the customer once per item — same helpers/shape as the per-item ship
  // route. A shipment bundling several products means several
  // notifications for what's physically one parcel; a consolidated
  // "your order shipped" template covering the whole parcel would read
  // better, but that's a template-level follow-up, not blocking here.
  const { data: client } = await service
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", order.client_id)
    .single();

  const clientName = order.contact_name ?? client?.full_name ?? "there";
  const clientPhone = order.contact_whatsapp ?? client?.phone ?? null;

  for (const item of shipmentItems ?? []) {
    if (item.shipped_at) continue;
    const product = Array.isArray(item.product) ? item.product[0] : item.product;
    const confirmToken = item.confirm_token ?? randomUUID();

    const { error: itemUpdateErr } = await service
      .from("order_items")
      .update({ shipped_at: nowIso, confirm_token: confirmToken })
      .eq("id", item.id)
      .is("shipped_at", null);
    if (itemUpdateErr) {
      console.error(`[vendor/shipments/${shipmentId}/book] item update error for ${item.id}:`, itemUpdateErr);
      continue;
    }

    try {
      if (client?.email && product) {
        await sendOrderItemShippedEmail({
          orderId: order.id, clientName, clientEmail: client.email,
          productName: product.name, quantity: item.quantity, confirmToken,
        });
      }
      if (clientPhone && product) {
        await notifyOrderItemShipped({
          clientName, clientPhone, orderId: order.id,
          productName: product.name, quantity: item.quantity, confirmToken,
        });
      }
    } catch (e) {
      console.error(`[vendor/shipments/${shipmentId}/book] notification error for item ${item.id}:`, e);
    }
  }

  return NextResponse.json({ ok: true, alreadyBooked: false, shipment: updatedShipment });
}
