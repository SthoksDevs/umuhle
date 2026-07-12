// lib/payments/types.ts
//
// Gateway-agnostic payment types.
//
// Every payment gateway integration (PayFast, HappyPay, Ozow, Google Pay,
// and any future gateway) is responsible for two things ONLY:
//   1. Proving a callback is authentic (signature / hash / secret check).
//   2. Normalising the gateway's own payload into a PaymentEvent below.
//
// It then hands that PaymentEvent to processPaymentEvent() in
// lib/payments/fulfillment.ts, which does all the deciding: creating the
// booking, decrementing stock, recording commission splits, activating
// ads/listings/salons, sending emails and WhatsApp messages.
//
// Nothing in lib/payments/fulfillment.ts or lib/payments/handlers/* knows
// or cares which gateway produced the event. That's the whole point — it's
// what lets any single gateway be paused, swapped, or removed without
// touching how orders/bookings/ads/listings/salons actually get fulfilled.

export type PaymentType = "booking" | "order" | "ad" | "salon" | "product_listing";

export type PaymentOutcome = "completed" | "cancelled" | "failed";

export type GatewayName = "payfast" | "happypay" | "ozow" | "google_pay";

export interface PaymentEvent {
  /** What was being paid for. */
  type: PaymentType;
  /**
   * Our own internal id for the thing being paid for:
   *   - "booking"         → booking_intents.id
   *   - "order"            → orders.id
   *   - "ad"               → ads.id
   *   - "salon"            → salon_subscription_payments.id
   *   - "product_listing"  → products.id
   * This is the value every gateway is told to echo back to us
   * (PayFast's m_payment_id, Ozow/HappyPay's order_id query param, etc).
   */
  paymentId: string;
  /** What the gateway is telling us happened. */
  outcome: PaymentOutcome;
  /** Which gateway produced this event — used for logging, notification
   *  copy ("paid via Ozow"), and choosing which gateway-reference column
   *  to write on the underlying row. */
  gateway: GatewayName;
  /** The gateway's own transaction/payment id, if it has one
   *  (pf_payment_id, Ozow TransactionId, HappyPay order id, ...). */
  gatewayPaymentId?: string;
}

export interface FulfillmentResult {
  ok: boolean;
  /**
   * True if this event was a no-op because the underlying row was already
   * processed (or wasn't found in a processable state) — most often a
   * gateway retrying a notification it already sent successfully.
   * Callers should still tell the gateway "200 OK" either way; this flag
   * is for logging/telemetry, not for deciding the HTTP response.
   */
  alreadyProcessed?: boolean;
  reason?: string;
}
