// lib/payments/fulfillment.ts
//
// processPaymentEvent() is the ONE place a gateway integration hands off
// to once it's confirmed a payment result is authentic. Every gateway
// route (PayFast ITN, HappyPay webhooks, Ozow notify, Google Pay) ends
// with a call to this function instead of containing its own copy of
// "what does a paid/failed booking|order|ad|salon|listing actually do".
//
// This is what makes any single gateway pausable/removable without risk:
// a gateway's route file only has to (a) prove the callback is real and
// (b) describe *what* happened, in the gateway-agnostic shape below. It
// never decides *what to do about it* — that lives here and in
// lib/payments/handlers/*, exactly once each.
//
// Usage from a gateway route:
//
//   const result = await processPaymentEvent(supabase, {
//     type: "order",
//     paymentId: orderId,
//     outcome: "completed",
//     gateway: "ozow",
//     gatewayPaymentId: payload.TransactionId,
//   });
//
// processPaymentEvent() never throws — a fulfillment bug should not stop
// a gateway route from returning the 200 its provider needs to stop
// retrying. Errors are captured in the returned FulfillmentResult instead.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentEvent, FulfillmentResult } from "./types";
import { fulfillBooking } from "./handlers/booking";
import { fulfillOrder } from "./handlers/order";
import { fulfillAd } from "./handlers/ad";
import { fulfillProductListing } from "./handlers/productListing";
import { fulfillSalon } from "./handlers/salon";

export type { PaymentEvent, FulfillmentResult, PaymentType, PaymentOutcome, GatewayName } from "./types";

export async function processPaymentEvent(
  supabase: SupabaseClient,
  event: PaymentEvent
): Promise<FulfillmentResult> {
  console.log(
    `[processPaymentEvent] type=${event.type} outcome=${event.outcome} gateway=${event.gateway} paymentId=${event.paymentId}`
  );

  try {
    switch (event.type) {
      case "booking":
        return await fulfillBooking(supabase, event);
      case "order":
        return await fulfillOrder(supabase, event);
      case "ad":
        return await fulfillAd(supabase, event);
      case "product_listing":
        return await fulfillProductListing(supabase, event);
      case "salon":
        return await fulfillSalon(supabase, event);
      default: {
        // Exhaustiveness check — if a new PaymentType is ever added without
        // a handler here, this fails to compile.
        const _exhaustive: never = event.type;
        return { ok: false, reason: `Unknown payment type: ${_exhaustive}` };
      }
    }
  } catch (err) {
    console.error("[processPaymentEvent] Unhandled fulfillment error:", err);
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown fulfillment error" };
  }
}
