// app/api/auth/phone-otp/send/route.ts
//
// Sends a real WhatsApp OTP via the approved "umuhle_number_otp" template
// (see lib/whatsapp.ts's sendPhoneOtp) and records a hashed copy in
// phone_otp_verifications so /verify — and, for a brand-new signup, the
// handle_new_user() trigger — can check it later. Used by both:
//   - components/AuthModal.tsx's registration flow — the account itself
//     isn't created until POST /verify succeeds; supabase.auth.signUp()
//     is only called after that.
//   - app/dashboard/page.tsx's ProfileTab — verifying a changed WhatsApp
//     number before it's saved.
// Deliberately unauthenticated (no session exists yet at signup) — the
// code itself is what's protected: short-lived (10 min), single-use,
// hashed at rest (never stored in plaintext), and rate-limited per phone
// number below so this endpoint can't be hammered directly to run up
// WhatsApp Business API send costs.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import { normalizePhone, isValidSAMobile } from "@/lib/phone";
import { sendPhoneOtp } from "@/lib/whatsapp";

const OTP_SECRET = process.env.OTP_SECRET ?? "umuhle-otp-secret-change-me";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes — matches the umuhle_number_otp template copy
const RESEND_COOLDOWN_MS = 45 * 1000; // a little under the client's 60s "Resend" button cooldown

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

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { phone } = body;
  if (!phone || typeof phone !== "string" || !isValidSAMobile(phone)) {
    return NextResponse.json({ error: "Enter a valid South African WhatsApp number." }, { status: 400 });
  }
  const normalizedPhone = normalizePhone(phone);

  const service = serviceClient();

  // Rate-limit: one send per phone every ~45s. Stops this endpoint being
  // called directly in a loop to bypass the client-side 60s "Resend"
  // cooldown and run up WhatsApp send costs.
  const { data: recent } = await service
    .from("phone_otp_verifications")
    .select("created_at")
    .eq("phone", normalizedPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent && Date.now() - new Date(recent.created_at as string).getTime() < RESEND_COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a moment before requesting another code." }, { status: 429 });
  }

  const otp = generateOtp();

  // Send first — only record a verification row (and start its 10-minute
  // clock, and the rate-limit window above) once WhatsApp actually
  // accepted the message, so a failed send doesn't block an immediate
  // retry with a phantom cooldown.
  const sent = await sendPhoneOtp(normalizedPhone, otp);
  if (!sent) {
    return NextResponse.json(
      { error: "Failed to send WhatsApp message. Check your phone number and try again." },
      { status: 500 }
    );
  }

  const requestedIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  const { error: insertErr } = await service.from("phone_otp_verifications").insert({
    phone: normalizedPhone,
    code_hash: hashCode(otp),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    requested_ip: requestedIp,
  });

  if (insertErr) {
    console.error("phone_otp_verifications insert error:", insertErr);
    return NextResponse.json({ error: "Could not start verification. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
