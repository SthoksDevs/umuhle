// lib/orders.ts
// Shared helper used by both PayFast and HappyPay initiate routes
// to create a pending order with validated products.

import type { SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import type { PaymentMethod } from "@/types";

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
}

type CreateOrderResult =
  | { result: { orderId: string; totalAmount: number; lines: OrderLine[] } }
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
    .select("id, name, price, stock_count, is_active, moderation_status")
    .in("id", productIds);

  if (productErr || !products) {
    return { error: "Could not fetch products" };
  }

  let totalAmount = 0;
  const lines: OrderLine[] = [];

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return { error: `Product ${item.productId} not found` };
    if (!product.is_active) return { error: `${product.name} is no longer available` };
    if (product.moderation_status !== "approved") return { error: `${product.name} is not available` };
    if (product.stock_count < item.quantity) return { error: `Insufficient stock for ${product.name}` };
    totalAmount += product.price * item.quantity;
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
    contact_name: opts.contactName ?? null,
    contact_whatsapp: opts.contactWhatsapp ?? null,
  });

  if (orderErr) return { error: orderErr.message };

  const { error: itemsErr } = await supabase.from("order_items").insert(
    lines.map((l) => ({
      order_id: orderId,
      product_id: l.product_id,
      quantity: l.quantity,
      unit_price: l.unit_price,
    }))
  );

  if (itemsErr) {
    await supabase.from("orders").delete().eq("id", orderId);
    return { error: itemsErr.message };
  }

  return { result: { orderId, totalAmount, lines } };
}
