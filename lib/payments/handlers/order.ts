// lib/payments/handlers/order.ts
//
// Fulfillment for "order" payments (Umuhle Shop purchases). This is the
// biggest consolidation: PayFast, HappyPay, Ozow and Google Pay ALL sell
// orders, and previously each had its own copy of "what happens when an
// order is paid for" — which had quietly drifted out of sync (HappyPay's
// copy never decremented stock or sent a confirmation email; Google Pay's
// copy skipped payment verification entirely). There is now exactly one
// copy of this logic, and every gateway goes through it.
//
//   completed → mark the order paid, decrement stock, record commission
//               splits, send the paid email + WhatsApp confirmation
//   cancelled/failed → mark the order cancelled, send the failure email
//
// Idempotent: the guarded `.eq("status", "pending_payment")` update means
// a gateway retrying its notification (PayFast/Ozow both do this
// aggressively until they get a 200) is a safe no-op the second time.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentEvent, FulfillmentResult } from "../types";
import { recordOrderItemSplits } from "@/lib/payouts";
import { notifyOrderPaid } from "@/lib/whatsapp";
import { sendOrderPaidEmail, sendOrderFailedEmail } from "@/lib/email";

export async function fulfillOrder(
  supabase: SupabaseClient,
  event: PaymentEvent
): Promise<FulfillmentResult> {
  const { paymentId: orderId, outcome, gateway, gatewayPaymentId } = event;

  if (outcome === "completed") {
    // Fetch order items before updating (need them for the email + stock decrement)
    const { data: orderItems } = await supabase
      .from("order_items")
      .select("product_id, quantity, unit_price, product:products(name)")
      .eq("order_id", orderId);

    // `orders` has both a legacy `payfast_payment_id` column and a generic
    // `gateway_order_id` column (added once HappyPay/Ozow/Google Pay showed
    // up) — the admin UI already reads whichever one is set
    // (`order.payfast_payment_id ?? order.gateway_order_id`), so we keep
    // writing PayFast's own id into its original column for continuity and
    // everyone else into the generic one.
    const gatewayIdColumn = gateway === "payfast" ? "payfast_payment_id" : "gateway_order_id";

    const { data: order } = await supabase
      .from("orders")
      .update({
        status: "paid",
        payment_method: gateway,
        ...(gatewayPaymentId ? { [gatewayIdColumn]: gatewayPaymentId } : {}),
      })
      .eq("id", orderId)
      .eq("status", "pending_payment")
      .select(
        "total_amount, shipping_address, contact_name, contact_whatsapp, client:profiles!orders_client_id_fkey(full_name, email, phone)"
      )
      .single();

    if (!order) {
      console.warn("[fulfillOrder] order not found or already processed:", orderId);
      return { ok: true, alreadyProcessed: true, reason: "Order not found or already processed" };
    }

    if (orderItems) {
      for (const item of orderItems) {
        await supabase.rpc("decrement_stock", {
          p_product_id: item.product_id,
          p_qty: item.quantity,
        });
      }
    }

    // Record each item's 5.5% commission / 94.5% partner payout split now
    // that payment has cleared. Wallets aren't credited until the order is
    // later marked "delivered" — see lib/payouts.ts.
    try {
      await recordOrderItemSplits(supabase, orderId);
    } catch (e) {
      console.error("[fulfillOrder] Failed to record order commission split:", e);
    }

    const clientRow = Array.isArray(order.client) ? order.client[0] : order.client;

    try {
      await sendOrderPaidEmail({
        orderId,
        clientName: clientRow?.full_name ?? "Unknown",
        clientEmail: clientRow?.email ?? "",
        totalAmount: order.total_amount,
        shippingAddress: order.shipping_address ?? undefined,
        items: (orderItems ?? []).map((i) => ({
          name: (Array.isArray(i.product) ? i.product[0] : i.product)?.name ?? "Product",
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
    } catch (e) {
      console.error("[fulfillOrder] Order paid email error:", e);
    }

    // Checkout lets a buyer give a delivery contact name/WhatsApp number
    // different from their account profile (order.contact_name /
    // order.contact_whatsapp) — prefer that when present, same as the
    // Google Pay flow always did; fall back to the account profile for
    // gateways that don't collect it.
    const notifyName = order.contact_name ?? clientRow?.full_name ?? "there";
    const notifyPhone = order.contact_whatsapp ?? clientRow?.phone;

    if (notifyPhone) {
      try {
        await notifyOrderPaid({
          clientName: notifyName,
          clientPhone: notifyPhone,
          orderId,
          itemCount: orderItems?.length ?? 0,
          totalAmount: order.total_amount,
          paymentMethod: gateway,
        });
      } catch (e) {
        console.error("[fulfillOrder] WhatsApp notify error:", e);
      }
    }

    return { ok: true };
  }

  // ── cancelled / failed ────────────────────────────────────────────────
  const reason = outcome === "cancelled" ? "cancelled" : "failed";

  const { data: order } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .select("total_amount, client:profiles!orders_client_id_fkey(full_name, email)")
    .single();

  if (!order) {
    return { ok: true, alreadyProcessed: true, reason: "Order not found or already processed" };
  }

  const clientRow = Array.isArray(order.client) ? order.client[0] : order.client;
  try {
    await sendOrderFailedEmail({
      orderId,
      clientName: clientRow?.full_name ?? "Unknown",
      clientEmail: clientRow?.email ?? "",
      totalAmount: order.total_amount,
      reason,
    });
  } catch (e) {
    console.error("[fulfillOrder] Order failed email error:", e);
  }

  return { ok: true };
}
