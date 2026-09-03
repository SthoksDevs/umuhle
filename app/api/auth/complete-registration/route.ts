// app/api/auth/complete-registration/route.ts
//
// Finishes an account that has a session but hasn't completed the required
// registration details — the case app/register/page.tsx's "completing"
// mode handles: a brand new Google/Facebook sign-in, where
// handle_new_user() (see the 20260826 migration) already auto-created the
// profiles row with account_type defaulted to 'customer' and phone/terms
// left unset, since OAuth never supplies any of that. This route is the
// equivalent finishing step for a profile the trigger created with
// defaults, mirroring what that trigger does for a fresh signUp() call.
//
// Deliberately a server route rather than a raw client .update() (the
// pattern components/dashboard/ProfileTab.tsx uses for a simple phone
// change, per app/api/auth/phone-otp/verify/route.ts's own header comment)
// because this call also flips account_type/is_artist/is_partner together
// and re-checks the phone OTP verification server-side before trusting it
// — more surface than a single self-service field edit, and not something
// to trust a client-supplied boolean for.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { normalizePhone, isValidSAMobile } from "@/lib/phone";
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from "@/lib/legal";
import { sendWelcomeEmail } from "@/lib/email";
import { SA_PROVINCES } from "@/types";

const ACCOUNT_TYPES = ["customer", "artist", "business_partner"] as const;
type AllowedAccountType = (typeof ACCOUNT_TYPES)[number];
function isAllowedAccountType(v: unknown): v is AllowedAccountType {
  return typeof v === "string" && (ACCOUNT_TYPES as readonly string[]).includes(v);
}

const ARTIST_CATEGORIES = ["hair", "nails", "makeup", "lashes"] as const;
type ArtistCategory = (typeof ARTIST_CATEGORIES)[number];
function isArtistCategory(v: unknown): v is ArtistCategory {
  return typeof v === "string" && (ARTIST_CATEGORIES as readonly string[]).includes(v);
}

// profiles.account_type values don't match the welcome email content's
// role names 1:1 — same map as app/auth/callback/route.ts's
// WELCOME_ROLE_MAP, kept local here rather than shared since both are
// small and tied to their own call site's error handling.
const WELCOME_ROLE_MAP: Record<AllowedAccountType, "artist" | "store_owner" | "customer"> = {
  artist: "artist",
  business_partner: "store_owner",
  customer: "customer",
};

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: {
    full_name?: string; phone?: string; account_type?: string; artist_categories?: unknown;
    address?: string; suburb?: string; city?: string; province?: string; postal_code?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const fullName = (body.full_name ?? "").trim();
  if (!fullName) return NextResponse.json({ error: "Full name is required." }, { status: 400 });

  if (!body.phone || !isValidSAMobile(body.phone)) {
    return NextResponse.json({ error: "A valid South African WhatsApp number is required." }, { status: 400 });
  }
  const phone = normalizePhone(body.phone);

  const accountType: AllowedAccountType = isAllowedAccountType(body.account_type) ? body.account_type : "customer";

  const artistCategories: ArtistCategory[] = accountType === "artist" && Array.isArray(body.artist_categories)
    ? body.artist_categories.filter(isArtistCategory)
    : [];
  if (accountType === "artist" && artistCategories.length === 0) {
    return NextResponse.json({ error: "Choose at least one specialty." }, { status: 400 });
  }

  const address = (body.address ?? "").trim();
  const city = (body.city ?? "").trim();
  const province = (body.province ?? "").trim();
  const postalCode = (body.postal_code ?? "").trim();
  const suburb = (body.suburb ?? "").trim();
  if (!address || !city || !province || !postalCode) {
    return NextResponse.json({ error: "Please fill in your address." }, { status: 400 });
  }
  if (!(SA_PROVINCES as readonly string[]).includes(province)) {
    return NextResponse.json({ error: "Choose a valid province." }, { status: 400 });
  }

  // Re-check the phone was actually OTP-verified in the last 30 minutes —
  // same window and table handle_new_user() checks for a fresh signUp() —
  // rather than trusting a client-side otpVerified flag on its own.
  const service = serviceClient();
  const { data: otpRow } = await service
    .from("phone_otp_verifications")
    .select("id")
    .eq("phone", phone)
    .not("verified_at", "is", null)
    .is("consumed_at", null)
    .gt("verified_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otpRow) {
    return NextResponse.json({ error: "Please verify your WhatsApp number again." }, { status: 400 });
  }

  const now = new Date().toISOString();

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("welcome_email_sent_at, email")
    .eq("id", user.id)
    .single();

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone,
      whatsapp_verified_at: now,
      account_type: accountType,
      is_artist: accountType === "artist",
      is_partner: accountType === "business_partner",
      artist_categories: artistCategories,
      artist_category: artistCategories[0] ?? null,
      terms_accepted: true,
      terms_accepted_at: now,
      terms_version: CURRENT_TERMS_VERSION,
      privacy_version: CURRENT_PRIVACY_VERSION,
      address,
      suburb: suburb || null,
      city,
      province,
      postal_code: postalCode,
    })
    .eq("id", user.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Best-effort, same as handle_new_user() does for a fresh signup — a
  // failure here shouldn't undo the account update above.
  await service.from("phone_otp_verifications").update({ consumed_at: now }).eq("id", otpRow.id);

  const { error: logError } = await supabase.from("terms_acceptance_log").insert({
    user_id: user.id,
    terms_version: CURRENT_TERMS_VERSION,
    privacy_version: CURRENT_PRIVACY_VERSION,
    user_agent: req.headers.get("user-agent") || null,
  });
  if (logError) console.error("terms_acceptance_log insert failed:", logError.message);

  if (existingProfile && !existingProfile.welcome_email_sent_at) {
    try {
      await sendWelcomeEmail({
        toEmail: existingProfile.email ?? user.email ?? "",
        firstName: fullName.split(" ")[0],
        role: WELCOME_ROLE_MAP[accountType],
      });
    } catch (e) {
      console.error("Welcome email failed:", e);
    }
    await supabase.from("profiles").update({ welcome_email_sent_at: now }).eq("id", user.id);
  }

  return NextResponse.json({ success: true, account_type: accountType });
}
