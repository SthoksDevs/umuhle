// app/api/admin/otp/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "info@umuhle.co.za";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── POST: verify password → send OTP via Supabase email ──────────────────────
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail !== ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  // Step 1: verify the password is correct
  const anon = anonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email:    normalizedEmail,
    password: password,
  });

  if (signInError) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  // Step 2: confirm profile is admin
  const service = serviceClient();
  const { data: profile } = await service
    .from("profiles")
    .select("is_admin, account_status")
    .eq("email", normalizedEmail)
    .single();

  if (!profile?.is_admin || profile?.account_status !== "active") {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  // Step 3: send a 6-digit OTP via Supabase's own email system
  // This uses your Supabase project's email settings (or their default sender)
  // and delivers a real 6-digit code the user types in.
  const { error: otpError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: normalizedEmail,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://umuhle.co.za"}/auth/callback`,
    },
  });

  // Use signInWithOtp which sends a 6-digit code (not a magic link)
  // We call this via the anon client so Supabase handles delivery
  const { error: emailOtpError } = await anon.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: false, // user must already exist
    },
  });

  if (emailOtpError) {
    console.error("OTP send error:", emailOtpError);
    return NextResponse.json(
      { error: "Could not send verification code. Check Supabase email settings." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

// ── PUT: verify the 6-digit OTP Supabase sent → create session ───────────────
export async function PUT(req: NextRequest) {
  const { email, code } = await req.json();

  if (!email || !code) {
    return NextResponse.json({ error: "Email and code required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const anon = anonClient();

  // Verify the OTP that Supabase emailed
  const { data, error } = await anon.auth.verifyOtp({
    email: normalizedEmail,
    token: code.trim(),
    type:  "email",
  });

  if (error || !data.session) {
    return NextResponse.json(
      { error: "Incorrect or expired code. Please try again." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success:      true,
    accessToken:  data.session.access_token,
    refreshToken: data.session.refresh_token,
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