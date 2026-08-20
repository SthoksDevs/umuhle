// app/api/payments/gateways/route.ts
//
// Tells the client which payment gateways are currently available for a
// given payment, so checkout can hide options that would just fail at
// /api/<gateway>/initiate. Two things narrow the list, both from
// lib/payments/gateways.ts and lib/payments/eligibility.ts:
//   1. A gateway paused via its ENABLED env var (lib/payments/gateways.ts).
//   2. PayFast's R5 minimum / Umuhle-profit-only rule
//      (lib/payments/eligibility.ts) — pass `amountCents` and, for shop
//      orders, `profitOnly` to have this factored in. Omitting them
//      returns every currently-enabled gateway, unfiltered by amount.
//
// Not sensitive — just a public-safe list — so no auth check here.

import { NextRequest, NextResponse } from "next/server";
import { getEligibleGateways } from "@/lib/payments/eligibility";
import type { PaymentType } from "@/lib/payments/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") as PaymentType) ?? "order";
  const amountCents = Number(searchParams.get("amountCents") ?? "0");
  const isUmuhleProfitOnly = searchParams.get("profitOnly") === "true";

  const gateways = getEligibleGateways({
    type,
    amountCents: Number.isFinite(amountCents) ? amountCents : 0,
    isUmuhleProfitOnly,
  });

  return NextResponse.json({ gateways });
}
