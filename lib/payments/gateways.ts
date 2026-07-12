// lib/payments/gateways.ts
//
// Central on/off switch per payment gateway.
//
// Setting one of the env vars below to "false" takes that gateway out of
// service for NEW payment attempts: its /initiate route (or, for Google
// Pay, its combined initiate+charge route) starts returning 503 instead of
// starting a checkout. Nothing else needs to change — the fulfillment
// logic in lib/payments/handlers/* has no idea which gateways are enabled,
// it only reacts to PaymentEvents, so every other gateway keeps working
// exactly as before.
//
// Deliberately NOT gated here: a gateway's webhook/notify route. If a
// gateway is disabled mid-flight, any payment that was already started
// against it should still be able to settle and update its order/booking
// correctly — "paused" means "stop starting new payments here", not "stop
// honouring ones already in progress".
//
// This is intentionally just env vars for now (no DB table, no admin UI) —
// enough to prove a gateway can be pulled out cleanly. If/when there's a
// need to flip these at runtime without a redeploy, swap the body of
// isGatewayEnabled() for a `site_config` lookup; every caller stays the
// same.

import type { GatewayName } from "./types";

const ENV_FLAGS: Record<GatewayName, string> = {
  payfast: "PAYFAST_ENABLED",
  happypay: "HAPPYPAY_ENABLED",
  ozow: "OZOW_ENABLED",
  google_pay: "GOOGLE_PAY_ENABLED",
};

/** Enabled by default — a gateway only turns off if its flag is explicitly "false". */
export function isGatewayEnabled(gateway: GatewayName): boolean {
  return process.env[ENV_FLAGS[gateway]] !== "false";
}

export function listEnabledGateways(): GatewayName[] {
  return (Object.keys(ENV_FLAGS) as GatewayName[]).filter(isGatewayEnabled);
}

export const GATEWAY_DISABLED_MESSAGE = "This payment method is currently unavailable — please choose another.";
