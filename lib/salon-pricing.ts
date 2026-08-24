// lib/salon-pricing.ts
//
// Salon registration pricing — cliff-style tiered rate. The per-salon rate
// for the highest tier reached applies to ALL salons in the registration,
// not just the ones above the threshold (confirmed intentional 2026-08-24:
// e.g. registering a 10th salon can lower the total vs. 9, since the whole
// batch drops from the R35 tier to the R28 tier).

// Rates stored in cents to match existing payment conventions.
export const SALON_REGISTRATION_TIERS = [
  { min: 1,   rateCents: 3500 }, // R35.00 per salon — 1 to 9 salons
  { min: 10,  rateCents: 2800 }, // R28.00 per salon — 10 to 49 salons
  { min: 50,  rateCents: 2450 }, // R24.50 per salon — 50 to 99 salons
  { min: 100, rateCents: 1500 }, // R15.00 per salon — 100+ salons
] as const;

export interface SalonRegistrationPricing {
  salonCount: number;
  rateCents: number;   // per-salon rate that applies at this count
  totalCents: number;  // rateCents * salonCount
  rateRand: number;
  totalRand: number;
}

export function calculateSalonRegistrationPrice(
  salonCount: number
): SalonRegistrationPricing {
  if (!Number.isInteger(salonCount) || salonCount < 1) {
    throw new Error("salonCount must be a positive integer");
  }

  // Highest tier whose minimum the count meets or exceeds.
  const tier = [...SALON_REGISTRATION_TIERS]
    .reverse()
    .find((t) => salonCount >= t.min)!;

  const totalCents = tier.rateCents * salonCount;

  return {
    salonCount,
    rateCents: tier.rateCents,
    totalCents,
    rateRand: tier.rateCents / 100,
    totalRand: totalCents / 100,
  };
}
