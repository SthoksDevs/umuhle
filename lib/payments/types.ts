// lib/payments/types.ts
//
// The normalized shape every gateway's webhook gets translated into before
// any business decision is made. Whatever TradeSafe/Ozow-specific parsing
// and signature/secret checking happens stays in that gateway's own route
// file; by the time fulfillPayment() (./fulfillment.ts) is called, gateway
// identity only matters for logging, for which "gateway reference" column
// gets written, and for TradeSafe's own escrow-release calls (see
// fulfillOrder/fulfillBooking/fulfillStoreBookingDeposit) — never for what
// business decision gets made.

import type { PaymentGateway } from "./gateways";

/** The six things a payment on Umuhle can be for. */
export type PaymentType = "booking" | "order" | "ad" | "salon" | "product_listing" | "store_booking_deposit";

export type PaymentOutcome = "paid" | "cancelled" | "failed";

export interface PaymentEvent {
  /** Which gateway produced this notification — for logging, the audit-trail column, and TradeSafe's escrow-release branch in fulfillment.ts. */
  gateway: PaymentGateway;
  type: PaymentType;
  outcome: PaymentOutcome;
  /**
   * The id of the row this payment is for: booking_intents.id, orders.id,
   * ads.id, products.id, salon_subscription_payments.id, or (for
   * "store_booking_deposit") store_bookings.id, depending on `type`. Always
   * OUR OWN id — what we sent the gateway as the payment reference — never
   * the gateway's own transaction id.
   */
  referenceId: string;
  /**
   * The gateway's own transaction/order reference, if it supplied one at
   * notification time (TradeSafe's transaction id, Ozow's TransactionId).
   */
  gatewayPaymentId?: string;
}

export interface FulfillmentResult {
  ok: boolean;
  message: string;
}
