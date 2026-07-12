// app/api/payments/gateways/route.ts
//
// Tells the client which payment gateways are currently switched on, so
// checkout can hide a paused one instead of letting someone pick it and
// hit a dead end at /api/<gateway>/initiate. See lib/payments/gateways.ts
// for how a gateway gets paused. Not sensitive — just a public-safe list —
// so no auth check here.

import { NextResponse } from "next/server";
import { enabledGateways } from "@/lib/payments/gateways";

export async function GET() {
  return NextResponse.json({ gateways: enabledGateways() });
}
