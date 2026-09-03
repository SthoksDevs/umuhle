"use client";
// app/register/page.tsx
//
// The dedicated signup surface. components/AuthModal.tsx no longer collects
// registration details itself — its "Sign up" link and its `?auth=register`
// URL trigger both just navigate here instead. Two ways to land on this page:
//
//   1. Straight from a "Sign up" / "Become an Artist" link, no session yet
//      → "fresh" mode: full name, email, password, WhatsApp number, terms,
//      and (new) an explicit choice of what to register as.
//   2. Bounced here by app/auth/callback/route.ts right after a brand new
//      Google/Facebook sign-in — a session already exists (the trigger in
//      the 20260826 migration auto-created a `profiles` row with
//      account_type defaulted to 'customer', no phone, terms not accepted),
//      but OAuth never supplied a WhatsApp number, a role, or terms
//      acceptance → "completing" mode: same role choice + phone/terms, but
//      name/email are prefilled and read-only-ish, no password field.
//
// WhatsApp is collected here but deliberately NOT verified at this point —
// email is the only verification gate for account creation now (Supabase's
// own confirmation-link flow via emailRedirectTo below). The number is
// saved as-is (whatsapp_verified_at stays null — see handle_new_user() /
// app/api/auth/complete-registration/route.ts) and only gets OTP-verified
// later, on demand, from components/dashboard/ProfileTab.tsx when someone
// turns on "Send me WhatsApp updates". Registering used to block on a
// WhatsApp OTP step right here; that UI has moved to ProfileTab.
//
// Registering as "Employee" is deliberately not offered here — employees
// are provisioned by a store owner's invite (see
// app/api/branch-employees/invite/route.ts + app/activate-employee/page.tsx),
// never self-registered, and 'employee' isn't even in handle_new_user()'s
// account_type whitelist (see docs/role-based-dashboards-status.md).

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { gTag, fbq, ttq } from "@/lib/analytics";
import { normalizePhone, isValidSAMobile } from "@/lib/phone";
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from "@/lib/legal";
import type { AccountType, ServiceCategory } from "@/types";
import { SA_PROVINCES } from "@/types";

const ICON = "/umuhle-icon.png";

// account_type values, straight from the DB check constraint — see
// lib/dashboard/context.ts's resolveDashboardRole() for how these map to
// /dashboard/{artist,owner,customer} once someone's signed up. "Store
// Owner" reads better than the raw "business_partner" column value, same
// gap app/auth/callback/route.ts's WELCOME_ROLE_MAP already papers over
// for the welcome email copy.
const ROLE_OPTIONS: { value: AccountType; label: string; blurb: string }[] = [
  { value: "customer", label: "Customer", blurb: "Book artists and shop products" },
  { value: "artist", label: "Artist", blurb: "Offer hair, nails, makeup or lashes" },
  { value: "business_partner", label: "Store Owner", blurb: "Run a salon or sell products" },
];

const ARTIST_CATEGORIES: { value: ServiceCategory; label: string }[] = [
  { value: "hair", label: "Hair" },
  { value: "nails", label: "Nails" },
  { value: "makeup", label: "Makeup" },
  { value: "lashes", label: "Lashes" },
];

function isAccountType(v: string | null | undefined): v is AccountType {
  return v === "customer" || v === "artist" || v === "business_partner";
}

const inputStyle: React.CSSProperties = {
  padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0",
  fontSize: "0.9rem", width: "100%", boxSizing: "border-box", fontFamily: "var(--font-body)",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.78rem", fontWeight: 500, color: "var(--grey)",
  marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em",
};

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.7-6.7C35.8 2.4 30.2 0 24 0 14.8 0 6.9 5.4 3 13.3l7.8 6.1C12.6 13.1 17.9 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.5c-.5 2.8-2.1 5.2-4.5 6.8l7 5.4c4.1-3.8 6.5-9.4 6.5-16.2z"/>
      <path fill="#FBBC05" d="M10.8 28.5A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.1.7-4.5L2.4 13.4A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8.2-6.2z"/>
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.4-4.6 2.2-8.2 2.2-6.1 0-11.3-4.1-13.2-9.7l-8.2 6.2C6.9 42.6 14.8 48 24 48z"/>
    </svg>
  );
}
function FacebookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
      <path d="M24 12a12 12 0 1 0-13.875 11.85v-8.385H7.08V12h3.045V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.465h-2.796v8.385A12 12 0 0 0 24 12z"/>
    </svg>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, var(--plum-t) 0%, #fff 60%)", fontFamily: "var(--font-body)" }}>
      <nav style={{ height: 60, display: "flex", alignItems: "center", padding: "0 1.5rem", borderBottom: "1px solid rgba(155,127,184,0.12)", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>
      </nav>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2.5rem 1.5rem" }}>
        <div style={{ background: "#fff", borderRadius: 24, padding: "2.5rem 2rem", width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.08)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function RegisterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const nextParam = searchParams.get("next");
  const typeParam = searchParams.get("type");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/dashboard";
  // Where someone lands once registration is actually complete — distinct
  // from `next` above (which also drives the "already complete, bounce
  // away" redirect, the OAuth round trip, and the "Sign in" link). An
  // explicit deep link still wins (e.g. someone sent here mid-booking),
  // but with no particular destination in mind, send a brand-new account
  // to the Profile tab so verifying/enabling WhatsApp is right there.
  const postSignupNext = nextParam && nextParam.startsWith("/") ? nextParam : "/dashboard?tab=profile";

  // "checking": don't know yet whether a session exists.
  // "fresh": no session — full signup form.
  // "completing": session exists, profile incomplete — short completion form.
  const [status, setStatus] = useState<"checking" | "fresh" | "completing">("checking");
  const [sessionEmail, setSessionEmail] = useState("");

  const [accountType, setAccountType] = useState<AccountType>(isAccountType(typeParam) ? typeParam : "customer");
  const [artistCategories, setArtistCategories] = useState<ServiceCategory[]>([]);
  const toggleArtistCategory = (cat: ServiceCategory) => {
    setArtistCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const [form, setForm] = useState({
    name: "", email: "", password: "", phone: "",
    address: "", suburb: "", city: "", province: "", postalCode: "",
  });
  const [showPass, setShowPass] = useState(false);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);

  // An already-complete profile (existing user who wandered back here, or
  // a "completing" submit that already succeeded) has no business on this
  // page — send them on to `next`. Everyone else lands in "fresh" or
  // "completing" depending on whether a session already exists.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (cancelled) return;
      if (!user) { setStatus("fresh"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone, terms_accepted, account_type, artist_categories, address, suburb, city, province, postal_code")
        .eq("id", user.id)
        .single();

      if (cancelled) return;

      if (profile && profile.terms_accepted && profile.phone) {
        router.replace(next);
        return;
      }

      setSessionEmail(user.email ?? "");
      setForm(f => ({
        ...f,
        name: profile?.full_name ?? "",
        email: user.email ?? "",
        address: profile?.address ?? "",
        suburb: profile?.suburb ?? "",
        city: profile?.city ?? "",
        province: profile?.province ?? "",
        postalCode: profile?.postal_code ?? "",
      }));
      if (!typeParam && isAccountType(profile?.account_type)) setAccountType(profile.account_type);
      if (profile?.artist_categories?.length) setArtistCategories(profile.artist_categories as ServiceCategory[]);
      setStatus("completing");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePhoneInput = (val: string) => {
    setForm(f => ({ ...f, phone: val }));
  };

  // The chosen role rides along as `type` on the way back from OAuth, so a
  // brand new Google/Facebook sign-up that picked "Artist" before clicking
  // the button doesn't land back in "completing" mode defaulted to
  // Customer. app/auth/callback/route.ts passes an incomplete profile's
  // `next` straight through unchanged when it already points at /register.
  const handleOAuth = async (provider: "google" | "facebook") => {
    setLoading(true);
    const dest = `/register?type=${accountType}&next=${encodeURIComponent(next)}`;
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(dest)}` },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidSAMobile(form.phone)) { setError("Enter a valid South African WhatsApp number."); return; }
    if (!termsAccepted) { setError("Please accept the Terms & Conditions and Privacy Policy first."); return; }
    if (accountType === "artist" && artistCategories.length === 0) { setError("Choose at least one specialty."); return; }
    if (!form.address.trim() || !form.city.trim() || !form.province || !form.postalCode.trim()) {
      setError("Please fill in your address.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (status === "completing") {
        const res = await fetch("/api/auth/complete-registration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: form.name,
            phone: form.phone,
            account_type: accountType,
            artist_categories: accountType === "artist" ? artistCategories : [],
            address: form.address,
            suburb: form.suburb,
            city: form.city,
            province: form.province,
            postal_code: form.postalCode,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Something went wrong");
        gTag("sign_up", { method: "oauth" });
        fbq("CompleteRegistration");
        ttq("CompleteRegistration");
        router.push(postSignupNext);
        return;
      }

      // Phone is normalized here the same way ProfileTab and
      // handle_new_user() normalise it, so a later verify-from-Profile
      // attempt matches this exact string — but no OTP check happens at
      // this point. handle_new_user() just stores it and leaves
      // whatsapp_verified_at null.
      const { error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            full_name: form.name,
            phone: normalizePhone(form.phone),
            account_type: accountType,
            artist_categories: accountType === "artist" ? artistCategories : [],
            terms_version: CURRENT_TERMS_VERSION,
            privacy_version: CURRENT_PRIVACY_VERSION,
            address: form.address,
            suburb: form.suburb,
            city: form.city,
            province: form.province,
            postal_code: form.postalCode,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(postSignupNext)}`,
        },
      });
      if (error) throw error;
      gTag("sign_up", { method: "email" });
      fbq("CompleteRegistration");
      ttq("CompleteRegistration");
      setCheckEmail(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (status === "checking") {
    return <PageShell><p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading…</p></PageShell>;
  }

  if (checkEmail) {
    return (
      <PageShell>
        <div style={{ textAlign: "center", padding: "1rem 0" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.5rem", color: "var(--onyx)", marginBottom: "0.5rem" }}>Check your email</h1>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", lineHeight: 1.6 }}>
            We sent a confirmation link to <strong>{form.email}</strong>. Click it to activate your account.
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.75rem", color: "var(--onyx)", marginBottom: "1.75rem" }}>
        {status === "completing" ? "Finish setting up" : "Join Umuhle"}
      </h1>

      <div style={{ marginBottom: "1.5rem" }}>
        <label style={labelStyle}>I&apos;m signing up as</label>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          {ROLE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAccountType(opt.value)}
              style={{
                flex: "1 1 140px", textAlign: "left", padding: "0.85rem", borderRadius: 14, cursor: "pointer",
                border: accountType === opt.value ? "1.5px solid var(--plum)" : "1.5px solid #E0E0E0",
                background: accountType === opt.value ? "var(--plum-t)" : "#fff",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--onyx)" }}>{opt.label}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--grey)", marginTop: "0.15rem" }}>{opt.blurb}</div>
            </button>
          ))}
        </div>

        {accountType === "artist" && (
          <div style={{ marginTop: "0.85rem" }}>
            <label style={labelStyle}>What do you specialise in? (choose all that apply)</label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {ARTIST_CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => toggleArtistCategory(cat.value)}
                  style={{
                    padding: "0.5rem 0.9rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer",
                    border: artistCategories.includes(cat.value) ? "1.5px solid var(--plum)" : "1.5px solid #E0E0E0",
                    background: artistCategories.includes(cat.value) ? "var(--plum-t)" : "#fff",
                    color: artistCategories.includes(cat.value) ? "var(--plum)" : "var(--grey)",
                    fontWeight: artistCategories.includes(cat.value) ? 600 : 400,
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {accountType === "business_partner" && (
          <p style={{ fontSize: "0.8rem", color: "var(--light)", marginTop: "0.6rem" }}>
            You&apos;ll set up your store&apos;s details from your dashboard once you&apos;re signed up.
          </p>
        )}
      </div>

      {status === "fresh" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
            <button
              onClick={() => handleOAuth("google")}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: 12, border: "1.5px solid #E0E0E0", background: "#fff", fontWeight: 500, fontSize: "0.9rem", cursor: "pointer" }}
            >
              <GoogleIcon /> Continue with Google
            </button>
            <button
              onClick={() => handleOAuth("facebook")}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: 12, border: "none", background: "#1877F2", color: "#fff", fontWeight: 500, fontSize: "0.9rem", cursor: "pointer" }}
            >
              <FacebookIcon /> Continue with Facebook
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
            <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
            <span style={{ fontSize: "0.8rem", color: "var(--light)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        <input
          placeholder="Full name"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
          style={inputStyle}
        />

        {status === "fresh" ? (
          <input
            type="email"
            placeholder="Email address"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            required
            style={inputStyle}
          />
        ) : (
          <input type="email" value={sessionEmail} disabled style={{ ...inputStyle, background: "#F7F7F7", color: "var(--grey)" }} />
        )}

        <input
          placeholder="WhatsApp number (e.g. 082 123 4567)"
          value={form.phone}
          onChange={e => handlePhoneInput(e.target.value)}
          required
          style={inputStyle}
        />

        <div style={{ marginTop: "0.35rem" }}>
          <label style={labelStyle}>Address</label>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <input
              placeholder="Street address"
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              required
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <input
                placeholder="Suburb"
                value={form.suburb}
                onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                placeholder="City"
                value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                required
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <select
                value={form.province}
                onChange={e => setForm(f => ({ ...f, province: e.target.value }))}
                required
                style={{ ...inputStyle, flex: 1, background: "#fff" }}
              >
                <option value="">Province</option>
                {SA_PROVINCES.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input
                placeholder="Postal code"
                value={form.postalCode}
                onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))}
                required
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
          </div>
        </div>

        {status === "fresh" && (
          <div style={{ position: "relative" }}>
            <input
              type={showPass ? "text" : "password"}
              placeholder="Password (at least 8 characters)"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              style={inputStyle}
            />
            <button type="button" onClick={() => setShowPass(v => !v)} style={{ position: "absolute", right: 12, top: 12, background: "none", border: "none", color: "var(--light)", cursor: "pointer", fontSize: "0.8rem" }}>
              {showPass ? "Hide" : "Show"}
            </button>
          </div>
        )}

        <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={e => setTermsAccepted(e.target.checked)}
            style={{ marginTop: "0.2rem", flexShrink: 0 }}
          />
          <span style={{ fontSize: "0.8rem", color: "var(--grey)", lineHeight: 1.5 }}>
            I have read and agree to the{" "}
            <Link href="/terms-and-conditions" target="_blank" style={{ color: "var(--plum)" }}>Terms &amp; Conditions</Link>
            {" "}and{" "}
            <Link href="/privacy-policy" target="_blank" style={{ color: "var(--plum)" }}>Privacy Policy</Link>.
          </span>
        </label>

        {error && <p style={{ color: "#E53935", fontSize: "0.85rem", margin: 0 }}>{error}</p>}

        <button type="submit" className="btn-plum" disabled={loading || !termsAccepted} style={{ marginTop: "0.25rem", padding: "0.875rem", fontSize: "1rem" }}>
          {loading ? "Please wait…" : "Create account"}
        </button>
      </form>

      <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--grey)" }}>
        Already have an account?{" "}
        <Link href={`/?auth=login&next=${encodeURIComponent(next)}`} style={{ color: "var(--plum)", fontWeight: 500, textDecoration: "none" }}>
          Sign in
        </Link>
      </p>
    </PageShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<PageShell><p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading…</p></PageShell>}>
      <RegisterPageInner />
    </Suspense>
  );
}
