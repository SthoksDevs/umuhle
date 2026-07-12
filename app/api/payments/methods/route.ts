// app/api/payments/methods/route.ts
//
// Tells the checkout UI which payment gateways are currently switched on
// (see lib/payments/gateways.ts). This is what lets a paused gateway
// disappear from the checkout page entirely instead of just failing with
// a 503 once someone clicks "Pay" — the frontend and the initiate routes
// both read from the same isGatewayEnabled() source of truth.

import { NextResponse } from "next/server";
import { listEnabledGateways } from "@/lib/payments/gateways";

export async function GET() {
  return NextResponse.json({ enabled: listEnabledGateways() });
}
