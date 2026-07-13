// app/api/payments/finalize/route.ts
//
// Why this exists: PayFast does not send an ITN at all when a shopper
// simply backs out of its hosted page before submitting a payment method —
// there's no transaction on PayFast's side to report, so no notification
// ever arrives (see app/api/payfast/notify/route.ts and lib/payfast.ts —
// that route only ever hears about COMPLETE or a genuinely attempted-and-
// declined FAILED charge). Nothing was ever calling fulfillPayment() with
// outcome "cancelled" for that case, which is why cancelling a payment
// wasn't sending an email even though a real decline did.
//
// This route is the /payment/cancelled and /payment/failed pages calling
// home once they mount, so a plain abandoned checkout still gets closed
// out and emailed instead of sitting "pending" forever. It's a deliberately
// narrow safety net, not a new way to control payment state:
//
//   - It can ONLY move a still-pending record to "cancelled" or "failed" —
//     never "paid". Marking something paid always requires a real gateway
//     notification (signature/secret-verified) going through the normal
//     webhook routes.
//   - It goes through the exact same fulfillPayment() every gateway's real
//     webhook uses, including its `status = 'pending'/'pending_payment'`
//     guard. So if the real webhook already landed — paid, or cancelled/
//     failed via a gateway that DOES report it reliably (Ozow, HappyPay,
//     or a genuine PayFast decline) — this call finds nothing left in
//     "pending" and is a harmless no-op. No double emails.
//   - The reference id is already exposed to the browser the moment
//     checkout starts (it's embedded in the redirect URLs sent to PayFast/
//     HappyPay/Ozow), so accepting it here from the client doesn't expose
//     anything that wasn't already client-visible. Worst case of a
//     mismatched ref is closing out someone else's still-in-flight attempt
//     early — no money moves and nothing sensitive is returned.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import type { PaymentEvent, PaymentType } from "@/lib/payments/types";
import type { PaymentGateway } from "@/lib/payments/gateways";

const VALID_TYPES: PaymentType[] = ["booking", "order", "ad", "salon", "product_listing"];
const VALID_GATEWAYS: PaymentGateway[] = ["payfast", "happypay", "ozow"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const ref = body?.ref as string | undefined;
  const type = body?.type as PaymentType | undefined;
  const gateway = (body?.gateway as PaymentGateway | undefined) ?? "payfast";
  const outcome = body?.outcome as string | undefined;

  if (!ref || !type) {
    return NextResponse.json({ error: "Missing ref/type" }, { status: 400 });
  }
  if (outcome !== "cancelled" && outcome !== "failed") {
    // Deliberately not "paid" — see file header. Anything else is rejected too.
    return NextResponse.json({ error: "Unsupported outcome" }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Unsupported payment type" }, { status: 400 });
  }
  if (!VALID_GATEWAYS.includes(gateway)) {
    return NextResponse.json({ error: "Unsupported gateway" }, { status: 400 });
  }

  const event: PaymentEvent = { gateway, type, outcome, referenceId: ref };

  try {
    const result = await fulfillPayment(await createServiceClient(), event);
    return NextResponse.json({ ok: result.ok });
  } catch (err) {
    console.error("[payments/finalize] error", err);
    // Best-effort by design — the page that called this doesn't change its
    // own UI either way, so there's nothing more useful to return here.
    return NextResponse.json({ ok: false });
  }
}
