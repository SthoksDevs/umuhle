// app/api/admin/otp/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { sendAdminOtpEmail } from "@/lib/email";

const ADMIN_EMAIL = "info@umuhle.co.za";
const OTP_SECRET  = process.env.OTP_SECRET ?? "umuhle-admin-otp-secret-CHANGE-ME";

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

// ── POST: verify password → send OTP ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail !== ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const service = serviceClient();

  // Verify password
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error: pwError } = await anonClient.auth.signInWithPassword({
    email:    normalizedEmail,
    password: password,
  });

  if (pwError) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  // Verify admin profile
  const { data: profile } = await service
    .from("profiles")
    .select("is_admin, account_status")
    .eq("email", normalizedEmail)
    .single();

  if (!profile?.is_admin || profile?.account_status !== "active") {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  // Generate OTP and store hash in DB
  const otp  = generateOtp();
  const hash = hashCode(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Invalidate old OTPs
  await service
    .from("admin_otp")
    .update({ used: true })
    .eq("email", normalizedEmail)
    .eq("used", false);

  const { error: insertError } = await service.from("admin_otp").insert({
    email:      normalizedEmail,
    otp_hash:   hash,
    expires_at: expiresAt,
    used:       false,
  });

  if (insertError) {
    console.error("admin_otp insert error:", insertError);
    return NextResponse.json({ error: "Could not create OTP." }, { status: 500 });
  }

  // Send via your own SMTP (bypasses Supabase email entirely), logged to email_log
  try {
    await sendAdminOtpEmail(normalizedEmail, otp);
  } catch (emailErr) {
    console.error("SMTP send error:", emailErr);
    return NextResponse.json(
      { error: "Could not send email. Check SMTP environment variables." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

// ── PUT: verify OTP → return session tokens ───────────────────────────────────
export async function PUT(req: NextRequest) {
  const { email, code } = await req.json();

  if (!email || !code) {
    return NextResponse.json({ error: "Email and code required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const service = serviceClient();

  const { data: record, error } = await service
    .from("admin_otp")
    .select("id, otp_hash, expires_at")
    .eq("email", normalizedEmail)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !record) {
    return NextResponse.json(
      { error: "Code expired or not found. Request a new one." },
      { status: 400 }
    );
  }

  // Constant-time comparison
  const submittedHash = hashCode(code.trim());
  let match = false;
  try {
    match = timingSafeEqual(
      Buffer.from(record.otp_hash,  "hex"),
      Buffer.from(submittedHash, "hex")
    );
  } catch { match = false; }

  if (!match) {
    return NextResponse.json({ error: "Incorrect code. Try again." }, { status: 400 });
  }

  // Mark as used
  await service.from("admin_otp").update({ used: true }).eq("id", record.id);

  // Mint a real Supabase session via magic link
  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type:  "magiclink",
    email: normalizedEmail,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: "Session creation failed." }, { status: 500 });
  }

  // Exchange hashed_token for a real session
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: sessionData, error: sessionError } = await anonClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type:       "magiclink",
  });

  if (sessionError || !sessionData.session) {
    return NextResponse.json({ error: "Session creation failed." }, { status: 500 });
  }

  return NextResponse.json({
    success:      true,
    accessToken:  sessionData.session.access_token,
    refreshToken: sessionData.session.refresh_token,
    redirectTo:   "/admin",
  });
}

// ── DELETE: change admin login slug ──────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await service
    .from("profiles")
    .select("is_admin, account_status")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin || profile?.account_status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { newSlug } = await req.json();

  if (!newSlug || typeof newSlug !== "string" || !/^[a-z0-9\-_]{6,60}$/.test(newSlug)) {
    return NextResponse.json(
      { error: "Slug must be 6–60 lowercase letters, numbers, hyphens or underscores." },
      { status: 400 }
    );
  }

  const { error: updateError } = await service
    .from("site_config")
    .upsert({
      key:        "admin_login_slug",
      value:      newSlug,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });

  if (updateError) {
    return NextResponse.json({ error: "Failed to update slug." }, { status: 500 });
  }

  return NextResponse.json({ success: true, slug: newSlug });
}
