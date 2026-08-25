// app/api/checkout/courier-rates/route.ts
//
// Live (or mock — see lib/shiplogic.ts) Ship Logic rate quotes for the
// checkout page, one per courier-fulfilled partner group in the cart.
// Purely for display/selection: lets the customer see and pick a service
// level (e.g. Economy vs Overnight) before paying. NOT the source of
// truth for what gets charged — createPendingOrder (lib/orders.ts)
// re-quotes server-side from trusted product/partner data at order-
// creation time, so a tampered request here can't under-charge shipping.
//
// The checkout page already holds everything needed to build a request
// (CartLine.product's weight/dims, and partnerInfo's address/lat-long —
// see app/checkout/page.tsx), so this route is a thin, stateless pass-
// through to lib/shiplogic.getRates rather than re-deriving parcel data
// from the DB itself.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRates, buildAddress, buildParcel, isCourierCheckoutEnabled, type CourierRate } from "@/lib/shiplogic";

interface GroupInput {
  partnerId: string;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  declaredValueCents: number;
  origin: {
    address: string | null;
    suburb: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
  };
}

interface DestinationInput {
  addressLine1: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Courier is paused platform-wide — see lib/shiplogic.ts. No point calling
  // Ship Logic for a rate nothing will charge; the checkout page shows each
  // partner's own delivery arrangement instead (see lib/deliveryArrangement.ts).
  if (!isCourierCheckoutEnabled()) {
    return NextResponse.json({ quotes: {} });
  }

  const body = await req.json();
  const { groups, destination } = body as { groups: GroupInput[]; destination: DestinationInput };

  if (!Array.isArray(groups) || groups.length === 0) {
    return NextResponse.json({ error: "No courier groups supplied" }, { status: 400 });
  }
  if (!destination?.city || !destination?.province) {
    return NextResponse.json({ error: "Delivery address incomplete" }, { status: 400 });
  }

  const delivery = buildAddress({
    streetAddress: destination.addressLine1,
    suburb: destination.suburb,
    city: destination.city,
    province: destination.province,
    postalCode: destination.postalCode,
  });

  const quotes: Record<string, { rates: CourierRate[]; isMock: boolean; error?: string }> = {};

  // Sequential, not Promise.all — a handful of partners at most per cart,
  // and this keeps a single slow/failing partner's error handling simple
  // rather than needing allSettled bookkeeping for a rare case.
  for (const group of groups) {
    try {
      const { rates, isMock } = await getRates({
        collection: buildAddress({
          streetAddress: group.origin.address,
          suburb: group.origin.suburb,
          city: group.origin.city,
          province: group.origin.province,
          postalCode: group.origin.postalCode,
          isBusiness: true,
        }),
        delivery,
        collectionCoords: { lat: group.origin.latitude, lng: group.origin.longitude },
        parcels: [buildParcel({ weightG: group.weightG, lengthCm: group.lengthCm, widthCm: group.widthCm, heightCm: group.heightCm })],
        declaredValueCents: group.declaredValueCents,
      });
      quotes[group.partnerId] = { rates, isMock };
    } catch (err) {
      console.error(`Courier rate preview failed for partner ${group.partnerId}:`, err);
      quotes[group.partnerId] = { rates: [], isMock: false, error: "Couldn't fetch a shipping quote right now." };
    }
  }

  return NextResponse.json({ quotes });
}
