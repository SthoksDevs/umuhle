// app/api/branch-employees/invite/route.ts
//
// The owner-side employee invite flow — see
// docs/role-based-dashboards-status.md. Owner enters a name + phone (+
// optional email) for a branch → this creates a real Supabase Auth user,
// a profiles row (is_employee=true, account_type='employee'), and a
// branch_employees row with invite_status='pending', then emails an
// activation link. The employee sets their own password on that link
// (see app/activate-employee/page.tsx), which flips invite_status to
// 'active' via app/api/branch-employees/activate/route.ts.
//
// WHY EMAIL, NOT WHATSAPP: a business-initiated WhatsApp message to
// someone who's never messaged Umuhle needs a pre-approved Meta template
// (lib/whatsapp.ts's sendPhoneOtp uses one that already exists,
// "umuhle_number_otp" — there's no invite-link template approved, and
// getting one approved is an external multi-day Meta review, not
// something this codebase can do). Email has no such constraint. If no
// email is given, a synthetic address is used as the Auth identifier only
// — see synthesizeEmail below — but then delivery has nowhere to go, so
// email is effectively required for the invite to actually reach anyone;
// the UI should make this clear rather than silently creating an
// unreachable account.
//
// Uses lib/supabase/server.ts's createServiceClient() — see that file's
// comment for why this must NOT be built on @supabase/ssr's
// createServerClient (a subtle bug fixed 2026-08-31, commit e0cd18c: that
// client picks up the CALLER's own session cookies and silently runs
// "service" queries as them instead of bypassing RLS).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizePhone, isValidSAMobile } from "@/lib/phone";
import { sendEmployeeInviteEmail } from "@/lib/email";

function authClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const auth = authClient();
  const { data: { user: caller }, error: callerError } = await auth.auth.getUser(token);
  if (callerError || !caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim();
  const phoneRaw = (body?.phone as string | undefined)?.trim();
  const email = (body?.email as string | undefined)?.trim().toLowerCase() || null;
  const branchId = body?.branchId as string | undefined;

  if (!name || !phoneRaw || !branchId) {
    return NextResponse.json({ error: "Name, phone, and branch are required" }, { status: 400 });
  }
  const phone = normalizePhone(phoneRaw);
  if (!isValidSAMobile(phone)) {
    return NextResponse.json({ error: "That doesn't look like a valid South African mobile number" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "An email address is needed to send the activation link" }, { status: 400 });
  }

  const service = await createServiceClient();

  // Verify the caller owns the salon this branch belongs to.
  const { data: branch, error: branchError } = await service
    .from("store_branches")
    .select("id, name, salon:partner_salons(id, name, partner_id)")
    .eq("id", branchId)
    .single();
  const salonRow = Array.isArray(branch?.salon) ? branch?.salon[0] : branch?.salon;
  if (branchError || !branch || salonRow?.partner_id !== caller.id) {
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  }

  const { data: callerProfile } = await service.from("profiles").select("full_name").eq("id", caller.id).single();

  // Create (or reuse, if this email already has an account — e.g. inviting
  // someone who's also a customer — see reuseExistingAccount below) the
  // Auth user, then the profiles row.
  const { userId, isNewAccount, error: createError } = await createOrReuseEmployeeAccount(service, email, name, phone);
  if (createError || !userId) {
    return NextResponse.json({ error: createError ?? "Could not create account" }, { status: 500 });
  }

  const { data: existingAssignment } = await service
    .from("branch_employees")
    .select("id")
    .eq("branch_id", branchId)
    .eq("profile_id", userId)
    .maybeSingle();
  if (existingAssignment) {
    return NextResponse.json({ error: "This person is already assigned to this branch" }, { status: 409 });
  }

  const { data: newRow, error: insertError } = await service
    .from("branch_employees")
    .insert({
      branch_id: branchId,
      profile_id: userId,
      name,
      invite_status: "pending",
      invited_by: caller.id,
      rank: "staff",
    })
    .select()
    .single();
  if (insertError || !newRow) {
    return NextResponse.json({ error: insertError?.message ?? "Could not create the branch assignment" }, { status: 500 });
  }

  // Only send an activation link for a brand-new account — someone who
  // already has an Umuhle login just signs in as normal and finds the new
  // branch waiting for them (invite_status starts 'pending' either way,
  // but there's no separate "activation" step needed for an existing,
  // already-active-password account; flip it straight to active).
  if (isNewAccount) {
    const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://umuhle.co.za"}/activate-employee` },
    });
    if (linkError || !linkData?.properties?.action_link) {
      // The branch_employees/profiles rows already exist at this point —
      // don't roll those back over an email hiccup, the owner can just
      // hit "resend invite" (not yet built, see status doc) or contact
      // support with the row already in place.
      console.error("[branch-employees/invite] generateLink failed:", linkError);
      return NextResponse.json({ warning: "Account created, but the invite email could not be sent. Contact support." }, { status: 207 });
    }
    await sendEmployeeInviteEmail({
      toEmail: email,
      employeeName: name,
      branchName: branch.name,
      storeName: salonRow?.name ?? "your store",
      inviterName: callerProfile?.full_name ?? "The store owner",
      activationLink: linkData.properties.action_link,
    });
  } else {
    await service.from("branch_employees").update({ invite_status: "active" }).eq("id", newRow.id);
  }

  return NextResponse.json({ success: true, branchEmployeeId: newRow.id, isNewAccount });
}

// If this email already belongs to an Umuhle account (e.g. they're also a
// customer), reuse it rather than erroring — just flip on is_employee and
// let them keep their existing password. Otherwise create a brand-new
// Auth user with no password set (they set one via the invite link).
//
// IMPORTANT: auth.users has an existing AFTER INSERT trigger
// (on_auth_user_created -> handle_new_user()) that auto-creates the
// matching profiles row (upsert-safe, ON CONFLICT DO UPDATE) and reads
// full_name/phone straight out of user_metadata — so admin.createUser()
// below already produces a profiles row with those two fields set
// correctly. What it does NOT do: handle_new_user()'s account_type
// validation is `if v_account_type not in ('customer','artist',
// 'business_partner') then v_account_type := 'customer'`  — 'employee'
// was never added to that whitelist when the role_based_dashboards
// migration introduced it as a valid profiles.account_type value, so a
// freshly-created employee row lands as account_type='customer',
// is_employee=false until corrected below. Left as a discovered-but-not-
// fixed gap (see docs/role-based-dashboards-status.md) rather than
// touched here — this is an AFTER INSERT trigger on auth.users, about as
// sensitive as shared infrastructure gets, and this route doesn't need it
// fixed to work correctly since it immediately overwrites both fields
// itself either way.
async function createOrReuseEmployeeAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: ReturnType<typeof createClient<any, any, any>>,
  email: string,
  name: string,
  phone: string
): Promise<{ userId: string | null; isNewAccount: boolean; error?: string }> {
  const { data: existingProfile } = await service.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existingProfile) {
    await service.from("profiles").update({ is_employee: true }).eq("id", existingProfile.id);
    return { userId: existingProfile.id, isNewAccount: false };
  }

  const { data: created, error: createUserError } = await service.auth.admin.createUser({
    email,
    email_confirm: true, // the invite link itself is the verification step
    user_metadata: { full_name: name, phone },
  });
  if (createUserError || !created?.user) {
    return { userId: null, isNewAccount: true, error: createUserError?.message ?? "Could not create account" };
  }

  // handle_new_user() already inserted the profiles row (see comment
  // above) with full_name/phone correct but account_type/is_employee
  // wrong — fix just those two rather than re-inserting.
  const { error: profileError } = await service
    .from("profiles")
    .update({ account_type: "employee", is_employee: true })
    .eq("id", created.user.id);
  if (profileError) {
    return { userId: null, isNewAccount: true, error: profileError.message };
  }

  return { userId: created.user.id, isNewAccount: true };
}
