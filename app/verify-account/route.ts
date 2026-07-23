// app/verify-account/route.ts
//
// Destination of the "Verify account" button on the umuhle_account WABA
// template. Reference-only: records whatsapp_verified_at on the profile so
// it's visible on the admin Users tab, but does NOT change account_status
// or gate anything — payments keep working exactly as before regardless of
// whether this link was ever clicked.
//
// Uses the service client (not the cookie-bound one) since the person
// clicking this link from WhatsApp may not have an active session on
// whatever device they're on.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyAccountToken } from "@/lib/account-verify";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const { valid, userId } = token ? verifyAccountToken(token) : { valid: false as const };

  if (!valid || !userId) {
    return NextResponse.redirect(new URL("/dashboard?verify=invalid", req.url));
  }

  try {
    const supabase = await createServiceClient();
    // Don't overwrite an earlier verification timestamp if this link is clicked twice.
    await supabase
      .from("profiles")
      .update({ whatsapp_verified_at: new Date().toISOString() })
      .eq("id", userId)
      .is("whatsapp_verified_at", null);
  } catch (e) {
    console.error("[verify-account] error recording whatsapp_verified_at:", e);
  }

  return NextResponse.redirect(new URL("/dashboard?verify=success", req.url));
}
