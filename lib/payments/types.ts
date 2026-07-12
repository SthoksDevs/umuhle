// lib/payments/types.ts
//
// The normalized shape every gateway's webhook gets translated into before
// any business decision is made. Whatever PayFast/HappyPay/Ozow-specific
// parsing and signature checking happens stays in that gateway's own route
// file; by the time fulfillPayment() (./fulfillment.ts) is called, gateway
// identity only matters for logging and for which "gateway reference"
// column gets written — never for what decision gets made.

import type { PaymentGateway } from "./gateways";

/** The five things a payment on Umuhle can be for. */
export type PaymentType = "booking" | "order" | "ad" | "salon" | "product_listing";

export type PaymentOutcome = "paid" | "cancelled" | "failed";

export interface PaymentEvent {
  /** Which gateway produced this notification — for logging and the audit-trail column only. */
  gateway: PaymentGateway;
  type: PaymentType;
  outcome: PaymentOutcome;
  /**
   * The id of the row this payment is for: booking_intents.id, orders.id,
   * ads.id, products.id, or salon_subscription_payments.id, depending on
   * `type`. Always OUR OWN id — what we sent the gateway as the payment
   * reference — never the gateway's own transaction id.
   */
  referenceId: string;
  /**
   * The gateway's own transaction/order reference, if it supplied one at
   * notification time (PayFast's pf_payment_id, Ozow's TransactionId).
   * HappyPay doesn't send one to its webhook URLs, so this is routinely
   * undefined for HappyPay events — that's expected, not an error.
   */
  gatewayPaymentId?: string;
}

export interface FulfillmentResult {
  ok: boolean;
  message: string;
}
