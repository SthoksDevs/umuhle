// lib/payments/gateways.ts
//
// Single source of truth for which payment gateways are switched on.
//
// This is deliberately opt-OUT, not opt-in: an unset env var means the
// gateway is enabled. That way the existing deployment keeps working with
// zero config changes, and pausing a gateway later is a one-line env var
// flip (e.g. HAPPYPAY_ENABLED=false) rather than something that has to be
// explicitly turned on everywhere first.
//
// IMPORTANT: only the *initiate* routes consult this — never the
// notify/webhook routes (see lib/payments/fulfillment.ts). A payment that
// was already started while a gateway was live must still be allowed to
// complete (or fail) correctly even if the gateway gets paused a minute
// later. Otherwise "pausing" a gateway would strand in-flight customer
// payments instead of just stopping new ones from starting.
//
// Today this only gates NEW checkouts. It doesn't yet stop an already-live
// gateway from being selected mid-refund or similar — there's no such flow
// in this codebase yet, so that's not a gap in practice, just a boundary
// worth knowing about if one gets added later.

export type PaymentGateway = "payfast" | "happypay" | "ozow";

export const PAYMENT_GATEWAYS: readonly PaymentGateway[] = ["payfast", "happypay", "ozow"];

const ENABLED_ENV_VAR: Record<PaymentGateway, string> = {
  payfast: "PAYFAST_ENABLED",
  happypay: "HAPPYPAY_ENABLED",
  ozow: "OZOW_ENABLED",
};

export const GATEWAY_LABEL: Record<PaymentGateway, string> = {
  payfast: "PayFast",
  happypay: "HappyPay",
  ozow: "Ozow",
};

export function isGatewayEnabled(gateway: PaymentGateway): boolean {
  const raw = process.env[ENABLED_ENV_VAR[gateway]];
  if (raw === undefined || raw === "") return true; // unset = on
  return raw.toLowerCase() !== "false" && raw !== "0";
}

/** Every gateway currently switched on, in a stable display order. */
export function enabledGateways(): PaymentGateway[] {
  return PAYMENT_GATEWAYS.filter(isGatewayEnabled);
}

export function gatewayLabel(gateway: PaymentGateway): string {
  return GATEWAY_LABEL[gateway];
}
