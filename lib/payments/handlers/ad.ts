// lib/payments/handlers/ad.ts
//
// Fulfillment for "ad" payments. Moved out of the PayFast ITN route,
// unchanged in behaviour — currently only PayFast sells ads, but this no
// longer assumes that.
//
// Matches the original handler's scope exactly: only "completed" is
// handled. A cancelled/failed ad payment is a no-op here (the ad row just
// stays at status "pending_payment" — there's no dedicated failure email
// for ads today, unlike bookings/orders). That's an existing gap, not
// something introduced by this refactor; flagging it here so it's easy to
// find if/when it's worth closing.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentEvent, FulfillmentResult } from "../types";
import { AD_PACKAGES } from "@/types";
import { sendAdPaidEmail } from "@/lib/email";

const WEEKS: Record<string, number> = { starter: 6, growth: 12, business: 16, premium: 24 };
const AD_COUNTS: Record<string, number> = { starter: 1, growth: 3, business: 6, premium: 10 };
const DURATION_LABELS: Record<string, string> = {
  starter: "6 weeks", growth: "3 months", business: "4 months", premium: "6 months",
};

export async function fulfillAd(
  supabase: SupabaseClient,
  event: PaymentEvent
): Promise<FulfillmentResult> {
  if (event.outcome !== "completed") {
    return { ok: true, alreadyProcessed: false, reason: "Ad payment failures are not tracked (no-op by design)" };
  }

  const { paymentId, gatewayPaymentId } = event;

  const { data: ad } = await supabase
    .from("ads")
    .select("package, price, partner_id, partner:profiles!partner_id(full_name, email)")
    .eq("id", paymentId)
    .eq("status", "pending_payment")
    .single();

  if (!ad) {
    return { ok: true, alreadyProcessed: true, reason: "Ad not found or already processed" };
  }

  const now = new Date();
  const pkg = ad.package ?? "starter";
  const weeks = WEEKS[pkg] ?? 6;
  const expiresAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  await supabase
    .from("ads")
    .update({
      status: "active",
      payfast_payment_id: gatewayPaymentId ?? null,
      starts_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      moderation_status: "scanning",
    })
    .eq("id", paymentId)
    .eq("status", "pending_payment");

  const partnerRow = Array.isArray(ad.partner) ? ad.partner[0] : ad.partner;
  try {
    await sendAdPaidEmail({
      adId: paymentId,
      clientName: (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
      clientEmail: (partnerRow as { email: string } | undefined)?.email ?? "",
      packageName: pkg.charAt(0).toUpperCase() + pkg.slice(1),
      adsCount: AD_COUNTS[pkg] ?? 1,
      durationLabel: DURATION_LABELS[pkg] ?? `${weeks} weeks`,
      amount: ad.price ?? 0,
    });
  } catch (e) {
    console.error("[fulfillAd] Ad paid email error:", e);
  }

  return { ok: true };
}
