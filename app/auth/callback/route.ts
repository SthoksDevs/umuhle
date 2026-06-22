// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  console.log("AUTH CALLBACK HIT");
  const code = searchParams.get("code");
  console.log("CODE EXISTS:", !!code);

  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("EXCHANGE ERROR:", error);
    if (!error) {
      console.log("SESSION CREATED");
      // Always redirect to dashboard after email confirmation or OAuth
      const redirectTo = next === "/" ? "/dashboard" : next;

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
