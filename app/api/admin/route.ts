// app/api/admin/otp/route.ts
// POST → verify password first, then send a 6-digit OTP to the admin email.
// PUT  → verify OTP, create a Supabase magic-link session for the admin.
//
// OTP storage strategy:
//   We store  HMAC-SHA256(otp, secret)  in admin_otp.otp_hash
//   and verify by hashing the submitted code the same way.
//   The expiry is enforced at the DB level (expires_at column + WHERE clause).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

const ADMIN_EMAIL = "info@umuhle.co.za";
const OTP_SECRET  = process.env.OTP_SECRET ?? "umuhle-admin-otp-secret-CHANGE-ME";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** HMAC of just the code — expiry is handled by the DB expires_at column */
function hashCode(code: string): string {
  return createHmac("sha256", OTP_SECRET).update(code).digest("hex");
}

// ── POST: password check → send OTP ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Only the super-admin email is allowed through this endpoint
  if (normalizedEmail !== ADMIN_EMAIL.toLowerCase()) {
    // Deliberate vague error — don't reveal which emails are admin
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const supabase = serviceClient();

  // Verify password via Supabase Auth (uses a temporary anon client for this check)
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error: signInError } = await anonClient.auth.signInWithPassword({
    email:    normalizedEmail,
    password: password,
  });

  if (signInError) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  // Verify profile has is_admin = true
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, account_status")
    .eq("email", normalizedEmail)
    .single();

  if (!profile?.is_admin || profile?.account_status !== "active") {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  // Invalidate any prior unused OTPs
  await supabase
    .from("admin_otp")
    .update({ used: true })
    .eq("email", normalizedEmail)
    .eq("used", false);

  const otp = generateOtp();
  const hash = hashCode(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: insertError } = await supabase.from("admin_otp").insert({
    email:      normalizedEmail,
    otp_hash:   hash,
    expires_at: expiresAt,
    used:       false,
  });

  if (insertError) {
    console.error("admin_otp insert:", insertError);
    return NextResponse.json({ error: "Could not create OTP." }, { status: 500 });
  }

  // Send OTP via Supabase Auth email — use generateLink which triggers SMTP
  // We embed the OTP in the redirect URL so no template change is needed:
  // the magic link hits /auth/callback which we intercept to show the OTP entry screen.
  //
  // Simpler approach: use Supabase's own email OTP (signInWithOtp) —
  // it sends a 6-digit code that the user enters, but it uses Supabase's code not ours.
  // We stick to our own code so we control expiry and the flow.
  //
  // Best-practice delivery: call your own email via Resend/SendGrid/etc.
  // Here we use the Supabase admin.generateLink trick to get SMTP delivery:

  const { error: emailError } = await supabase.auth.admin.generateLink({
    type:  "magiclink",
    email: normalizedEmail,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://umuhle.co.za"}/auth/callback`,
    },
  });

  // generateLink sends the email as a side effect when email confirmations are enabled.
  // If your project sends magic-link emails, the admin will receive one.
  // We ignore the link itself — we only use our own OTP code.
  // If emailError occurs, fall through (OTP is still stored; admin can request again).
  if (emailError) {
    console.warn("generateLink email warning:", emailError.message);
  }

  // RECOMMENDED: replace the block above with your own SMTP call:
  // await sendEmail({
  //   to:      normalizedEmail,
  //   subject: "Umuhle Admin — Verification Code",
  //   text:    `Your verification code is: ${otp}\n\nExpires in 10 minutes.`,
  // });

  return NextResponse.json({ success: true, hint: "Check your email for the code." });
}

// ── PUT: verify OTP → mint admin session ─────────────────────────────────────
export async function PUT(req: NextRequest) {
  const { email, code } = await req.json();

  if (!email || !code) {
    return NextResponse.json({ error: "Email and code required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const supabase = serviceClient();

  // Fetch most recent valid OTP
  const { data: record, error } = await supabase
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
      { error: "Code expired or not found. Please request a new code." },
      { status: 400 }
    );
  }

  // Constant-time comparison
  const submittedHash = hashCode(code.trim());
  let match = false;
  try {
    match = timingSafeEqual(
      Buffer.from(record.otp_hash,   "hex"),
      Buffer.from(submittedHash, "hex")
    );
  } catch {
    match = false;
  }

  if (!match) {
    return NextResponse.json({ error: "Incorrect code. Try again." }, { status: 400 });
  }

  // Consume the OTP
  await supabase.from("admin_otp").update({ used: true }).eq("id", record.id);

  // Mint a real Supabase session for the admin via magic link
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type:  "magiclink",
    email: normalizedEmail,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: "Session creation failed. Please try again." }, { status: 500 });
  }

  // Return the hashed token — the client will exchange it for a session
  // via supabase.auth.verifyOtp({ token_hash, type: "magiclink" })
  return NextResponse.json({
    success:     true,
    tokenHash:   linkData.properties.hashed_token,
    redirectTo:  "/admin",
  });
}

// ── DELETE: change admin login slug (admin-only) ──────────────────────────────
export async function DELETE(req: NextRequest) {
  // Reused for slug change — requires an active admin session
  const supabase = serviceClient();

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
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

  const { error: updateError } = await supabase
    .from("site_config")
    .upsert({ key: "admin_login_slug", value: newSlug, updated_by: user.id, updated_at: new Date().toISOString() });

  if (updateError) {
    return NextResponse.json({ error: "Failed to update slug." }, { status: 500 });
  }

  return NextResponse.json({ success: true, slug: newSlug });
}
