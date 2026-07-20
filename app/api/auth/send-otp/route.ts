// app/api/auth/send-otp/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendTemplateMessage } from "@/lib/whatsapp";

// In-memory OTP store (use Redis/Supabase in production for multi-instance)
// For Vercel serverless, we store OTPs in a signed cookie instead
import { cookies } from "next/headers";
import { createHmac } from "crypto";

const OTP_SECRET = process.env.OTP_SECRET ?? "umuhle-otp-secret-change-me";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function signOtp(phone: string, otp: string, ts: number): string {
  return createHmac("sha256", OTP_SECRET)
    .update(`${phone}:${otp}:${ts}`)
    .digest("hex");
}

export async function POST(req: NextRequest) {
  const { phone } = await req.json();

  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "Phone number required" }, { status: 400 });
  }

  const otp = generateOtp();
  const ts = Date.now();
  const sig = signOtp(phone, otp, ts);

  // Send via WhatsApp — must use an approved Authentication template,
  // since this is the first message to this number (no open session window)
  const sent = await sendTemplateMessage(phone, "otp_verification", [
    {
      type: "body",
      parameters: [{ type: "text", text: otp }],
    },
    {
      type: "button",
      sub_type: "copy_code",
      index: "0",
      parameters: [{ type: "coupon_code", coupon_code: otp }],
    },
  ]);

  if (!sent) {
    return NextResponse.json({ error: "Failed to send WhatsApp message. Check your phone number." }, { status: 500 });
  }

  // Store OTP data in a cookie (httpOnly, short-lived)
  const cookieStore = await cookies();
  cookieStore.set("_otp_data", JSON.stringify({ phone, otp, ts, sig }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes
    path: "/",
    sameSite: "lax",
  });

  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
  // Verify OTP
  const { phone, code } = await req.json();

  if (!phone || !code) {
    return NextResponse.json({ error: "Phone and code required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get("_otp_data")?.value;

  if (!raw) {
    return NextResponse.json({ error: "No OTP session found. Request a new code." }, { status: 400 });
  }

  let data: { phone: string; otp: string; ts: number; sig: string };
  try {
    data = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid OTP session." }, { status: 400 });
  }

  // Verify signature
  const expectedSig = signOtp(data.phone, data.otp, data.ts);
  if (expectedSig !== data.sig) {
    return NextResponse.json({ error: "Invalid OTP session." }, { status: 400 });
  }

  // Check expiry
  if (Date.now() - data.ts > OTP_TTL_MS) {
    return NextResponse.json({ error: "OTP has expired. Request a new code." }, { status: 400 });
  }

  // Check phone matches
  if (data.phone.replace(/\D/g, "") !== phone.replace(/\D/g, "")) {
    return NextResponse.json({ error: "Phone number mismatch." }, { status: 400 });
  }

  // Check code
  if (data.otp !== code.trim()) {
    return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 400 });
  }

  // Clear OTP cookie
  cookieStore.delete("_otp_data");

  // Set a verified cookie (short-lived, 5 mins — just enough to complete registration)
  cookieStore.set("_otp_verified", phone.replace(/\D/g, ""), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 300,
    path: "/",
    sameSite: "lax",
  });

  return NextResponse.json({ success: true, verified: true });
}
