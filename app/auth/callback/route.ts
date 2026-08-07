// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  console.log("AUTH CALLBACK HIT");
  const code = searchParams.get("code");
  console.log("CODE EXISTS:", !!code);

  const nextParam = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("EXCHANGE ERROR:", error);
    if (!error) {
      console.log("SESSION CREATED");
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
