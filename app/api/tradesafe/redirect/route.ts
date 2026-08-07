// app/api/tradesafe/redirect/route.ts
//
// TradeSafe redirects the buyer's browser to ONE static URL configured in
// its dashboard (Getting Started → First Steps → "Register your
// application") for every outcome — success, failure, and cancellation are
// all the same URL, distinguished only by a `status` query param TradeSafe
// appends itself (see docs.tradesafe.co.za/api/deposits/#redirects). This
// is unlike Ozow/PayFast, which get three distinct URLs generated fresh
// per checkout. Register this exact URL there:
//
//   https://umuhle.co.za/api/tradesafe/redirect
//
// This is purely a courtesy redirect for the browser — the source of truth
// for whether a payment actually succeeded is always the server-to-server
// callback (app/api/tradesafe/callback/route.ts), same as every other
// gateway in this codebase. A shopper who closes the tab before this fires
// still gets their order marked paid correctly once the callback lands.

import { NextRequest, NextResponse } from "next/server";
import { parseReference } from "@/lib/tradesafe";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // "success" | "failure" | "canceled"
  const reference = searchParams.get("reference") ?? "";

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const parsed = parseReference(reference);
  const ref = parsed?.id ?? "";
  const type = parsed?.type ?? "";

  const destination =
    status === "success" ? "/payment/success" :
    status === "canceled" ? "/payment/cancelled" :
    "/payment/failed";

  return NextResponse.redirect(
    `${baseUrl}${destination}?ref=${encodeURIComponent(ref)}&type=${encodeURIComponent(type)}&method=tradesafe`
  );
}
