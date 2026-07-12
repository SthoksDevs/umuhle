// lib/payments/handlers/salon.ts
//
// Fulfillment for "salon" payments — a partner's annual salon listing
// subscription. Moved out of the PayFast ITN route, unchanged in
// behaviour. Same no-op-on-failure scope as lib/payments/handlers/ad.ts —
// see the note there.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentEvent, FulfillmentResult } from "../types";
import { sendSalonPaidEmail } from "@/lib/email";

export async function fulfillSalon(
  supabase: SupabaseClient,
  event: PaymentEvent
): Promise<FulfillmentResult> {
  if (event.outcome !== "completed") {
    return { ok: true, alreadyProcessed: false, reason: "Salon payment failures are not tracked (no-op by design)" };
  }

  const { paymentId, gatewayPaymentId } = event;

  const now = new Date();
  const oneYear = new Date(now);
  oneYear.setFullYear(oneYear.getFullYear() + 1);

  const { data: payment } = await supabase
    .from("salon_subscription_payments")
    .update({ status: "paid", payfast_payment_id: gatewayPaymentId ?? null })
    .eq("id", paymentId)
    .eq("status", "pending")
    .select("salon_id, amount, partner:profiles!partner_id(full_name, email)")
    .single();

  if (!payment?.salon_id) {
    return { ok: true, alreadyProcessed: true, reason: "Salon subscription payment not found or already processed" };
  }

  await supabase
    .from("partner_salons")
    .update({ subscription_until: oneYear.toISOString() })
    .eq("id", payment.salon_id);

  const { data: salon } = await supabase
    .from("partner_salons")
    .select("name")
    .eq("id", payment.salon_id)
    .single();

  const partnerRow = Array.isArray(payment.partner) ? payment.partner[0] : payment.partner;
  try {
    await sendSalonPaidEmail({
      paymentId,
      clientName: (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
      clientEmail: (partnerRow as { email: string } | undefined)?.email ?? "",
      salonName: salon?.name ?? "Your salon",
      amount: (payment as { amount?: number }).amount ?? 3500,
      expiresAt: oneYear.toISOString(),
    });
  } catch (e) {
    console.error("[fulfillSalon] Salon paid email error:", e);
  }

  return { ok: true };
}
