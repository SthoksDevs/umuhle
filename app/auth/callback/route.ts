// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWelcomeEmail } from "@/lib/email";

// profiles.account_type values (see the DB check constraint) don't match
// the email content's UserRole names 1:1 — "business_partner" is the
// account_type, "store_owner" is what the welcome copy calls it.
// "employee" has no entry here on purpose: employees activate via
// /activate-employee, not this route, and already get their own tailored
// email (sendEmployeeInviteEmail) at invite time.
const WELCOME_ROLE_MAP: Record<string, "artist" | "store_owner" | "customer" | undefined> = {
  artist: "artist",
  business_partner: "store_owner",
  customer: "customer",
};

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  console.log("AUTH CALLBACK HIT");
  const code = searchParams.get("code");
  console.log("CODE EXISTS:", !!code);

  const nextParam = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("EXCHANGE ERROR:", error);
    if (!error && data.user) {
      console.log("SESSION CREATED");

      // One-time welcome email. This route runs on every code exchange —
      // OAuth login, magic link, email confirmation — not just signup, so
      // welcome_email_sent_at is what keeps it to exactly once per
      // account rather than once per login.
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email, account_type, welcome_email_sent_at")
        .eq("id", data.user.id)
        .single();

      const role = profile ? WELCOME_ROLE_MAP[profile.account_type] : undefined;
      if (profile && !profile.welcome_email_sent_at && role) {
        try {
          await sendWelcomeEmail({
            toEmail: profile.email ?? data.user.email ?? "",
            firstName: (profile.full_name ?? "there").split(" ")[0],
            role,
          });
        } catch (e) {
          console.error("Welcome email failed:", e);
        }
        await supabase
          .from("profiles")
          .update({ welcome_email_sent_at: new Date().toISOString() })
          .eq("id", data.user.id);
      }

      // Only fall back to /dashboard when no next was sent at all (e.g. an
      // email-confirmation link, which never includes one). When a next IS
      // present, respect it even if it's literally "/" — AuthModal's
      // handleOAuth always sends the page the modal was opened from as
      // next, and for a login triggered from the homepage that page IS
      // "/". Treating that as "no intent" (the old `next === "/"` check)
      // is what was bouncing homepage logins to /dashboard instead of
      // back to the artist they were trying to book.
      const redirectTo = nextParam && nextParam.startsWith("/") ? nextParam : "/dashboard";

      // Behind a proxy (e.g. Vercel), `origin` derived from the request URL can
      // resolve to an internal host. Prefer the public host the browser
      // actually requested so the redirect lands on the real domain.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (!isLocalEnv && forwardedHost) {
        return NextResponse.redirect(`${forwardedProto}://${forwardedHost}${redirectTo}`);
      }
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }
  console.log("AUTH FAILED");
  return NextResponse.redirect(`${origin}/?auth=error`);
}
