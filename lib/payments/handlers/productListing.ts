// lib/payments/handlers/productListing.ts
//
// Fulfillment for "product_listing" payments — a partner paying to list a
// product in the shop. Moved out of the PayFast ITN route, unchanged in
// behaviour. Same no-op-on-failure scope as lib/payments/handlers/ad.ts —
// see the note there.
//
// One payment here creates a listing_packages credit bank
// (slots_total = pkg.ads, e.g. Growth = 3) and immediately spends 1 slot
// on the product that was being paid for; the other slots stay available
// for future products at no extra charge (see use_listing_slot() in the
// 2026-07-10 migration). is_active only flips to true here if content
// moderation already cleared the product (a partner can pay before or
// after admin reviews it; whichever finishes last is what makes it visible).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentEvent, FulfillmentResult } from "../types";
import { LISTING_PACKAGES } from "@/types";
import { sendProductListingPaidEmail } from "@/lib/email";

const WEEKS: Record<string, number> = { starter: 6, growth: 12, business: 16, premium: 24 };
const DURATION_LABELS: Record<string, string> = {
  starter: "6 weeks", growth: "3 months", business: "4 months", premium: "6 months",
};

export async function fulfillProductListing(
  supabase: SupabaseClient,
  event: PaymentEvent
): Promise<FulfillmentResult> {
  if (event.outcome !== "completed") {
    return { ok: true, alreadyProcessed: false, reason: "Product listing payment failures are not tracked (no-op by design)" };
  }

  const { paymentId, gatewayPaymentId } = event;

  const { data: product } = await supabase
    .from("products")
    .select("package, name, partner_id, moderation_status, partner:profiles!partner_id(full_name, email)")
    .eq("id", paymentId)
    .eq("listing_status", "pending_payment")
    .single();

  if (!product) {
    return { ok: true, alreadyProcessed: true, reason: "Product not found or already processed" };
  }

  const now = new Date();
  const pkg = product.package ?? "starter";
  const weeks = WEEKS[pkg] ?? 6;
  const slotsTotal = LISTING_PACKAGES.find((p) => p.id === pkg)?.ads ?? 1;
  const expiresAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: pkgRow } = await supabase
    .from("listing_packages")
    .insert({
      partner_id: product.partner_id,
      package: pkg,
      weeks,
      slots_total: slotsTotal,
      slots_used: 1, // this payment's product consumes the first slot immediately
      status: "active",
      payfast_payment_id: gatewayPaymentId ?? null,
      purchased_at: now.toISOString(),
    })
    .select("id")
    .single();

  await supabase
    .from("products")
    .update({
      listing_status: "active",
      listing_package_id: pkgRow?.id ?? null,
      payfast_payment_id: gatewayPaymentId ?? null,
      starts_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      is_active: product.moderation_status === "approved",
    })
    .eq("id", paymentId)
    .eq("listing_status", "pending_payment");

  const partnerRow = Array.isArray(product.partner) ? product.partner[0] : product.partner;
  try {
    await sendProductListingPaidEmail({
      productId: paymentId,
      productName: product.name,
      clientName: (partnerRow as { full_name: string } | undefined)?.full_name ?? "Partner",
      clientEmail: (partnerRow as { email: string } | undefined)?.email ?? "",
      packageName: pkg.charAt(0).toUpperCase() + pkg.slice(1),
      durationLabel: DURATION_LABELS[pkg] ?? `${weeks} weeks`,
      slotsTotal,
      amount: LISTING_PACKAGES.find((p) => p.id === pkg)?.price ?? 2000,
    });
  } catch (e) {
    console.error("[fulfillProductListing] Product listing paid email error:", e);
  }

  return { ok: true };
}
