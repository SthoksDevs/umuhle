// app/api/auth/phone-otp/verify/route.ts
//
// Verifies a code sent by POST /api/auth/phone-otp/send and marks the
// matching phone_otp_verifications row as verified_at = now(). It does
// NOT create an account or update a profile itself — the two callers each
// do their own next step once this returns success:
//   - components/AuthModal.tsx calls supabase.auth.signUp() right after,
//     with the SAME normalised phone string this route matched against.
//     The handle_new_user() trigger re-checks phone_otp_verifications
//     itself (verified_at set, unconsumed, within the last 30 minutes)
//     before marking the new profile's WhatsApp number as verified, and
//     consumes the row so it can't be reused for a second account.
//   - app/dashboard/page.tsx's ProfileTab just needs otpVerified === true
//     client-side to allow saving the new number to the existing profile;
//     nothing server-side needs to consume the row for that path, so it's
//     left for the "unexpired, unconsumed" window to naturally expire.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { normalizePhone } from "@/lib/phone";

const OTP_SECRET = process.env.OTP_SECRET ?? "umuhle-otp-secret-change-me";
const MAX_ATTEMPTS = 5;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function hashCode(code: string): string {
  return createHmac("sha256", OTP_SECRET).update(code).digest("hex");
}

export async function POST(req: NextRequest) {
  let body: { phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { phone, code } = body;
  if (!phone || typeof phone !== "string" || !code || typeof code !== "string") {
    return NextResponse.json({ error: "Phone and code are required." }, { status: 400 });
  }

  const normalizedPhone = normalizePhone(phone);
  const service = serviceClient();

  const { data: record, error } = await service
    .from("phone_otp_verifications")
    .select("id, code_hash, attempts")
    .eq("phone", normalizedPhone)
    .is("verified_at", null)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !record) {
    return NextResponse.json(
      { error: "Code expired or not found. Request a new one." },
      { status: 400 }
    );
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    // Lock this attempt out rather than letting it keep being guessed —
    // the person needs a fresh code (a new /send call) from here.
    await service.from("phone_otp_verifications").update({ consumed_at: new Date().toISOString() }).eq("id", record.id);
    return NextResponse.json(
      { error: "Too many incorrect attempts. Please request a new code." },
      { status: 400 }
    );
  }

  const submittedHash = hashCode(code.trim());
  let match = false;
  try {
    match = timingSafeEqual(
      Buffer.from(record.code_hash as string, "hex"),
      Buffer.from(submittedHash, "hex")
    );
  } catch {
    match = false;
  }

  if (!match) {
    await service
      .from("phone_otp_verifications")
      .update({ attempts: (record.attempts as number) + 1 })
      .eq("id", record.id);
    return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 400 });
  }

  const { error: updateErr } = await service
    .from("phone_otp_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", record.id);

  if (updateErr) {
    console.error("phone_otp_verifications verify update error:", updateErr);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ success: true, verified: true });
}
