// lib/deliveryArrangement.ts
//
// While NEXT_PUBLIC_COURIER_CHECKOUT_ENABLED is off (see lib/shiplogic.ts),
// there's no live rate/booking for a "courier" fulfillment line — so a
// partner who still offers courier needs to tell customers how their order
// will actually get to them. This is that partner-facing statement: a
// preset (for the common, well-understood cases) plus an optional free-text
// note, editable in app/dashboard/page.tsx's PartnerFulfillmentSettings and
// shown to the customer at app/checkout/page.tsx.
//
// Pure constants/formatting only — no server-only code — so this is safe to
// import from both client and server files.

export type DeliveryArrangementMethod =
  | "personal_delivery"
  | "postnet_to_postnet"
  | "pudo_paxi"
  | "own_arrangement"
  | "custom";

export interface DeliveryArrangementOption {
  id: DeliveryArrangementMethod;
  label: string;
  description: string;
  // Default customer-facing sentence for this preset — shown as-is unless
  // the partner also added a note, in which case the note is appended.
  customerCopy: string;
}

export const DELIVERY_ARRANGEMENT_OPTIONS: DeliveryArrangementOption[] = [
  {
    id: "personal_delivery",
    label: "I'll deliver it myself",
    description: "You personally drop orders off within your area.",
    customerCopy: "The seller will personally deliver your order.",
  },
  {
    id: "postnet_to_postnet",
    label: "PostNet to PostNet",
    description: "Customer collects from their nearest PostNet with a reference you send them.",
    customerCopy: "Your order will be sent PostNet to PostNet — the seller will send you a collection reference.",
  },
  {
    id: "pudo_paxi",
    label: "PUDO / Paxi locker-to-locker",
    description: "Affordable locker-to-locker delivery via PUDO or Pep's Paxi service.",
    customerCopy: "Your order will ship via a PUDO/Paxi locker — the seller will send you pickup details.",
  },
  {
    id: "own_arrangement",
    label: "I'll contact the customer to arrange it",
    description: "You'll reach out after the order to agree on a courier and who covers the cost.",
    customerCopy: "The seller will contact you after checkout to arrange delivery.",
  },
  {
    id: "custom",
    label: "Something else",
    description: "Write your own message — shown to the customer instead of the options above.",
    customerCopy: "",
  },
];

export function deliveryArrangementOption(
  method: string | null | undefined
): DeliveryArrangementOption | null {
  return DELIVERY_ARRANGEMENT_OPTIONS.find((o) => o.id === method) ?? null;
}

// Customer-facing sentence for the checkout page / order view. Falls back to
// a generic line if the partner hasn't set anything yet — courier still
// isn't blocked, just unquoted, so checkout never dead-ends on this.
export function formatDeliveryArrangement(
  method: string | null | undefined,
  note: string | null | undefined
): string {
  const trimmedNote = note?.trim();
  if (method === "custom") {
    return trimmedNote || "The seller will be in touch to arrange delivery.";
  }
  const option = deliveryArrangementOption(method);
  if (!option) return "We'll be in touch after your order to arrange delivery.";
  return trimmedNote ? `${option.customerCopy} ${trimmedNote}` : option.customerCopy;
}
