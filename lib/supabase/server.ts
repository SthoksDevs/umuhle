// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}

// IMPORTANT: this must NOT be built on @supabase/ssr's createServerClient.
// That client is cookie/session-aware by design: if the incoming request
// carries a logged-in user's Supabase auth cookies, its internal
// _getAccessToken() call returns that user's own access token and uses it
// as the Authorization header on every request — regardless of which key
// (even the service role key) was passed into the constructor. The service
// role key ends up only sent as the `apikey` header, Postgrest resolves the
// role from Authorization, and every "service" query silently runs as the
// calling user, subject to their normal RLS, instead of bypassing it.
//
// Plain createClient from @supabase/supabase-js, with no cookie storage
// and persistSession/autoRefreshToken off, has no session to pick up, so
// it always authenticates as whatever key it's given — same pattern
// already used correctly in the cron routes and app/[adminSlug]/page.tsx.
export async function createServiceClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
