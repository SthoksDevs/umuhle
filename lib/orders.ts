// lib/orders.ts
// Shared helper used by both the PayFast and Ozow initiate routes
// to create a pending order with validated products.

import type { SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import type { PaymentMethod, FulfillmentMethod } from "@/types";
import { createServiceClient } from "@/lib/supabase/server";

interface OrderLine {
  product_id: string;
  quantity: number;
  unit_price: number;
  name: string;
}

interface PendingOrderOptions {
  paymentMethod: PaymentMethod;
  shippingAddress?: string;
  contactName?: string;
  contactWhatsapp?: string;
  // ── Local delivery & provincial sales ──
  // fulfillmentByPartner is keyed by products.partner_id. A partner missing
  // from the map (shouldn't happen — the checkout page seeds every partner
  // present in the cart) defaults to "courier", same as the client-side
  // default in app/checkout/page.tsx.
  fulfillmentByPartner?: Record<string, FulfillmentMethod>;
  shippingAddressLine1?: string;
  shippingAddressLine2?: string;
  shippingSuburb?: string;
  shippingCity?: string;
  shippingProvince?: string;
  shippingPostalCode?: string;
}

type CreateOrderResult =
  | {
      result: {
        orderId: string;
        totalAmount: number;
        lines: OrderLine[];
        /**
         * True only when every line in the cart is Umuhle's own stock
         * (products.is_umuhle_product) — used by
         * lib/payments/eligibility.ts to force this order onto Ozow
         * instead of PayFast, since there's no partner payout to
         * protect with escrow when the money is 100% Umuhle's already.
         */
        isUmuhleProfitOnly: boolean;
      };
    }
  | { error: string };

export async function createPendingOrder(
  supabase: SupabaseClient,
  userId: string,
  items: { productId: string; quantity: number }[],
  opts: PendingOrderOptions
): Promise<CreateOrderResult> {
  if (!items || items.length === 0) {
    return { error: "Cart is empty" };
  }

  const productIds = items.map((i) => i.productId);

  const { data: products, error: productErr } = await supabase
    .from("products")
    .select(
      "id, name, price, stock_count, is_active, moderation_status, expires_at, is_umuhle_product, partner_id, sell_scope, sell_provinces, weight_g, length_cm, width_cm, height_cm"
    )
    .in("id", productIds);

  if (productErr || !products) {
    return { error: "Could not fetch products" };
  }

  // Origin snapshot source for order_shipments, and the sell_scope fallback
  // ("province" scope with nothing ticked in sell_provinces falls back to
  // the seller's own home province — see products.sell_scope's comment).
  // profiles: public read (active) already lets this session read another
  // partner's profile row, so this can use the caller's own client.
  const partnerIds = [...new Set(products.map((p) => p.partner_id).filter(Boolean))];
  const partnerProfiles: Record<
    string,
    { address: string | null; suburb: string | null; city: string | null; province: string | null; postal_code: string | null; latitude: number | null; longitude: number | null }
  > = {};
  if (partnerIds.length > 0) {
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, address, suburb, city, province, postal_code, latitude, longitude")
      .in("id", partnerIds);
    (profilesData ?? []).forEach((p) => { partnerProfiles[p.id] = p; });
  }

  let totalAmount = 0;
  let isUmuhleProfitOnly = true;
  const lines: OrderLine[] = [];

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return { error: `Product ${item.productId} not found` };
    if (!product.is_active) return { error: `${product.name} is no longer available` };
    if (product.moderation_status !== "approved") return { error: `${product.name} is not available` };
    // Belt-and-braces: the shop grid already hides expired listings, but a
    // product sitting in someone's cart since before it expired shouldn't
    // still be purchasable — there's no cron job flipping is_active off.
    if (product.expires_at && new Date(product.expires_at) < new Date()) {
      return { error: `${product.name} is no longer available` };
    }
    if (product.stock_count < item.quantity) return { error: `Insufficient stock for ${product.name}` };

    // Sell_scope enforcement — the authoritative version of the same check
    // app/checkout/page.tsx runs client-side for an inline warning.
    // Collection is exempt: the customer is fetching it in person, so
    // there's no shipping range to restrict.
    const fulfillmentMethod: FulfillmentMethod = opts.fulfillmentByPartner?.[product.partner_id] ?? "courier";
    if (fulfillmentMethod === "courier" && product.sell_scope === "province") {
      const sellProvinces: string[] = product.sell_provinces ?? [];
      const allowed = sellProvinces.length > 0 ? sellProvinces : [partnerProfiles[product.partner_id]?.province].filter((p): p is string => Boolean(p));
      if (!opts.shippingProvince || !allowed.includes(opts.shippingProvince)) {
        return { error: `${product.name} doesn't ship to ${opts.shippingProvince || "your province"}` };
      }
    }

    totalAmount += product.price * item.quantity;
    if (!product.is_umuhle_product) isUmuhleProfitOnly = false;
    lines.push({ product_id: product.id, quantity: item.quantity, unit_price: product.price, name: product.name });
  }

  const orderId = uuidv4();

  const { error: orderErr } = await supabase.from("orders").insert({
    id: orderId,
    client_id: userId,
    total_amount: totalAmount,
    status: "pending_payment",
    payment_method: opts.paymentMethod,
    shipping_address: opts.shippingAddress ?? null,
    shipping_address_line1: opts.shippingAddressLine1 ?? null,
    shipping_address_line2: opts.shippingAddressLine2 ?? null,
    shipping_suburb: opts.shippingSuburb ?? null,
    shipping_city: opts.shippingCity ?? null,
    shipping_province: opts.shippingProvince ?? null,
    shipping_postal_code: opts.shippingPostalCode ?? null,
    contact_name: opts.contactName ?? null,
    contact_whatsapp: opts.contactWhatsapp ?? null,
  });

  if (orderErr) return { error: orderErr.message };

  const { data: insertedItems, error: itemsErr } = await supabase
    .from("order_items")
    .insert(
      lines.map((l) => ({
        order_id: orderId,
        product_id: l.product_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
      }))
    )
    .select("id, product_id");

  if (itemsErr) {
    await supabase.from("orders").delete().eq("id", orderId);
    return { error: itemsErr.message };
  }

  // ── order_shipments — one row per partner, one parcel/waybill ──
  // Group the just-inserted order_items by product.partner_id, aggregate a
  // rough parcel from the group's products, and snapshot origin/destination
  // addresses. Uses the service-role client specifically for this step:
  // after the RLS fix that scoped order_shipments' "service role" policy to
  // `to service_role`, the customer's own session has no insert policy on
  // order_shipments at all (by design — those rows are only ever created
  // server-side), and order_items has no client-side UPDATE policy either.
  type PartnerGroup = { partnerId: string; orderItemIds: string[]; weightSum: number; maxLength: number; maxWidth: number; maxHeight: number };
  const groups = new Map<string, PartnerGroup>();
  for (const item of insertedItems ?? []) {
    const product = products.find((p) => p.id === item.product_id);
    if (!product?.partner_id) continue; // every product has a partner_id — defensive only
    const qty = lines.find((l) => l.product_id === item.product_id)?.quantity ?? 1;
    let group = groups.get(product.partner_id);
    if (!group) {
      group = { partnerId: product.partner_id, orderItemIds: [], weightSum: 0, maxLength: 0, maxWidth: 0, maxHeight: 0 };
      groups.set(product.partner_id, group);
    }
    group.orderItemIds.push(item.id);
    group.weightSum += (product.weight_g ?? 0) * qty;
    // Aggregate parcel dims from the group's products — sum weight, take
    // the max of each dimension across the group. A real courier
    // integration would do proper bin-packing; this is a documented rough
    // approximation, good enough for a hand-entered waybill today.
    group.maxLength = Math.max(group.maxLength, product.length_cm ?? 0);
    group.maxWidth = Math.max(group.maxWidth, product.width_cm ?? 0);
    group.maxHeight = Math.max(group.maxHeight, product.height_cm ?? 0);
  }

  try {
    const serviceClient = await createServiceClient();
    for (const group of groups.values()) {
      const method: FulfillmentMethod = opts.fulfillmentByPartner?.[group.partnerId] ?? "courier";
      const origin = partnerProfiles[group.partnerId];

      const { data: shipment, error: shipmentErr } = await serviceClient
        .from("order_shipments")
        .insert({
          order_id: orderId,
          partner_id: group.partnerId,
          fulfillment_method: method,
          status: "pending",
          origin_address: origin?.address ?? null,
          origin_suburb: origin?.suburb ?? null,
          origin_city: origin?.city ?? null,
          origin_province: origin?.province ?? null,
          origin_postal_code: origin?.postal_code ?? null,
          origin_latitude: origin?.latitude ?? null,
          origin_longitude: origin?.longitude ?? null,
          // Destination is only meaningful for courier — left null for
          // collection, there's nothing to ship anywhere.
          destination_address_line1: method === "courier" ? opts.shippingAddressLine1 ?? null : null,
          destination_address_line2: method === "courier" ? opts.shippingAddressLine2 ?? null : null,
          destination_suburb: method === "courier" ? opts.shippingSuburb ?? null : null,
          destination_city: method === "courier" ? opts.shippingCity ?? null : null,
          destination_province: method === "courier" ? opts.shippingProvince ?? null : null,
          destination_postal_code: method === "courier" ? opts.shippingPostalCode ?? null : null,
          parcel_weight_g: group.weightSum || null,
          parcel_length_cm: group.maxLength || null,
          parcel_width_cm: group.maxWidth || null,
          parcel_height_cm: group.maxHeight || null,
        })
        .select("id")
        .single();

      if (shipmentErr || !shipment) {
        throw new Error(shipmentErr?.message ?? "Failed to create shipment");
      }

      const { error: shipmentUpdateErr } = await serviceClient
        .from("order_items")
        .update({ shipment_id: shipment.id })
        .in("id", group.orderItemIds);

      if (shipmentUpdateErr) throw new Error(shipmentUpdateErr.message);
    }
  } catch (shipmentErr) {
    // Payment hasn't happened yet at this point, so this isn't
    // catastrophic — but a customer shouldn't be left with an order that
    // has items and no shipment to fulfil them, so roll back the same way
    // the order_items insert failure above does.
    console.error("Failed to create order shipments:", shipmentErr);
    await supabase.from("order_items").delete().eq("order_id", orderId);
    await supabase.from("orders").delete().eq("id", orderId);
    return { error: "Could not finalise delivery details for this order. Please try again." };
  }

  return { result: { orderId, totalAmount, lines, isUmuhleProfitOnly } };
}
