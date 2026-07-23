// middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ── Fetch the current admin login slug from site_config ───────────────────────
// We use the service role key here (server-only middleware, never in browser).
async function getAdminSlug(): Promise<string> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/site_config?key=eq.admin_login_slug&select=value`,
      {
        headers: {
          apikey:        process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          "Content-Type": "application/json",
        },
        // Edge middleware cannot use the JS SDK directly, so we use the REST API.
        // Cache for 60 seconds to avoid hitting the DB on every request.
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) return "ngenakuadmin";
    const data = await res.json();
    return data?.[0]?.value ?? "ngenakuadmin";
  } catch {
    return "ngenakuadmin";
  }
}

export async function middleware(request: NextRequest) {
  // ── Canonical host: strip "www." so every URL resolves to https://umuhle.co.za ──
  const host = request.headers.get("host") ?? "";
  if (host.startsWith("www.")) {
    const url = request.nextUrl.clone();
    url.host = host.slice(4);
    return NextResponse.redirect(url, 308);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as never)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── Dynamic admin login slug ───────────────────────────────────────────────
  // The admin login page lives at app/[adminSlug]/page.tsx.
  // We check if this single-segment path matches the stored slug.
  // If someone visits /ngenakuadmin (or the current slug), let it through.
  // Everything else with a single segment that isn't a known route is handled normally.
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) {
    const knownSingleSegments = [
      "dashboard", "shop", "stores", "earn", "cart",
      "checkout", "payment", "privacy-policy", "terms-and-conditions",
      "reset-password", "admin",
    ];
    const segment = segments[0];

    if (!knownSingleSegments.includes(segment)) {
      // Might be the admin slug — check against the stored value
      const adminSlug = await getAdminSlug();

      if (segment === adminSlug) {
        // It's the admin login page — allow through regardless of auth state
        // (unauthenticated users need to reach it to log in)
        return supabaseResponse;
      }
      // Not the admin slug and not a known route — let Next.js 404 handle it
    }
  }

  // ── Protect normal user routes ─────────────────────────────────────────────
  const protectedRoutes = ["/dashboard", "/partner", "/bookings", "/artist"];
  const isProtected = protectedRoutes.some((r) => pathname.startsWith(r));

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("auth", "login");
    return NextResponse.redirect(url);
  }

  // ── Protect /admin (the actual admin dashboard) ────────────────────────────
  // Direct access to /admin requires an authenticated admin session.
  // Visiting the admin login slug (above) does not — that's the login page.
  if (pathname.startsWith("/admin")) {
    if (!user) {
      // Redirect to the dynamic admin login slug instead of the home page
      const adminSlug = await getAdminSlug();
      const url = request.nextUrl.clone();
      url.pathname = `/${adminSlug}`;
      return NextResponse.redirect(url);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin, account_status")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin || profile?.account_status !== "active") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
