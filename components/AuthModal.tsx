"use client";
// components/AuthModal.tsx
//
// Rendered once, inside SiteHeader, so it's present on every page. Fixes two
// bugs in the old homepage-only implementation:
//
// 1. "CTA on the search page doesn't work" — the old version read
//    window.location.search in a useEffect with an EMPTY dependency array,
//    so it only ever checked the URL once, on first mount. Clicking a
//    same-page link to add ?auth=register did nothing, because the effect
//    never ran again. This version derives visibility straight from
//    useSearchParams(), which is reactive by design.
//
// 2. "Other pages redirect to the homepage" — the old version only existed
//    on app/page.tsx, so every other page's "Sign in" button had to
//    navigate to "/?auth=login" to reach it — landing you on the homepage,
//    not back on the page you were on. This version lives in the header, so
//    it's already present wherever the link was clicked; those links now
//    just add "?auth=..." to the CURRENT url instead of jumping to "/".

import { useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { gTag, fbq, ttq } from "@/lib/analytics";

export default function AuthModal() {
  const router       = useRouter();
  const pathname      = usePathname();
  const searchParams  = useSearchParams();
  const supabase      = createClient();

  const authParam = searchParams.get("auth"); // "login" | "register" | null
  const nextParam = searchParams.get("next");
  const isOpen    = authParam === "login" || authParam === "register";

  const [mode, setMode]         = useState<"login" | "register" | "forgot">("login");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [form, setForm]         = useState({ email: "", password: "", name: "", phone: "" });

  // Reactive — this is the actual fix for bug #1. Runs every time the "auth"
  // param changes, including same-page navigations, not just on mount.
  useEffect(() => {
    if (authParam === "login") setMode("login");
    else if (authParam === "register") setMode("register");
  }, [authParam]);

  // Clear a stray OAuth error hash so the UI stays clean.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("error")) {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
  }, []);

  const close = () => {
    setError("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("auth");
    params.delete("next");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Where to land after a successful sign-in/sign-up: an explicit ?next=
  // wins, otherwise just stay on the page the modal was opened from — it
  // now lives wherever that page is, so "stay put" is the right default.
  const goNext = () => {
    const dest = nextParam && nextParam.startsWith("/") ? nextParam : pathname;
    router.push(dest);
  };

  const handleOAuth = async (provider: "google" | "facebook") => {
    setLoading(true);
    const dest = nextParam && nextParam.startsWith("/") ? nextParam : pathname;
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(dest || "/dashboard")}` },
    });
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        // Support login with email or WhatsApp (phone number → look up email)
        const identifier = form.email.trim();
        const isPhone = /^[0-9+\s()-]{7,}$/.test(identifier) && !identifier.includes("@");
        if (isPhone) {
          const { data: profileData } = await supabase
            .from("profiles")
            .select("email")
            .eq("phone", identifier.replace(/\D/g, "").replace(/^0/, "27"))
            .maybeSingle();
          if (!profileData?.email) throw new Error("No account found with that WhatsApp number.");
          const { error } = await supabase.auth.signInWithPassword({ email: profileData.email, password: form.password });
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email: identifier, password: form.password });
          if (error) throw error;
        }
        gTag("login", { method: "email" });
        fbq("Login");
        goNext();
      } else {
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: { full_name: form.name, phone: form.phone, account_type: "customer" },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        setError("Check your email to confirm your account.");
        gTag("sign_up", { method: "email" });
        fbq("CompleteRegistration");
        ttq("CompleteRegistration");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const identifier = form.email.trim();
    if (!identifier) {
      setError("Enter your email or WhatsApp number.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const isPhone = /^[0-9+\s()-]{7,}$/.test(identifier) && !identifier.includes("@");
      let emailToReset = identifier;
      if (isPhone) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("email")
          .eq("phone", identifier.replace(/\D/g, "").replace(/^0/, "27"))
          .maybeSingle();
        if (!profileData?.email) throw new Error("No account found with that WhatsApp number.");
        emailToReset = profileData.email;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(emailToReset, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setError("Password reset link sent. Check your email.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.6rem", marginBottom: "0.25rem" }}>
          {mode === "login" ? "Welcome back" : mode === "forgot" ? "Reset password" : "Create account"}
        </h2>
        <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
          {mode === "login" ? "Sign in to book your next appointment." : mode === "forgot" ? "Enter your email or WhatsApp number to receive a reset link." : "Join Umuhle — it's free."}
        </p>

        {mode !== "forgot" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
            <button onClick={() => handleOAuth("google")} disabled={loading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: 12, border: "1.5px solid #E0E0E0", background: "#fff", fontWeight: 500, fontSize: "0.9rem", cursor: "pointer" }}>
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.7-6.7C35.8 2.4 30.2 0 24 0 14.8 0 6.9 5.4 3 13.3l7.8 6.1C12.6 13.1 17.9 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.5c-.5 2.8-2.1 5.2-4.5 6.8l7 5.4c4.1-3.8 6.5-9.4 6.5-16.2z"/>
                <path fill="#FBBC05" d="M10.8 28.5A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.1.7-4.5L2.4 13.4A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8.2-6.2z"/>
                <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.4-4.6 2.2-8.2 2.2-6.1 0-11.3-4.1-13.2-9.7l-8.2 6.2C6.9 42.6 14.8 48 24 48z"/>
              </svg>
              Continue with Google
            </button>
            <button onClick={() => handleOAuth("facebook")} disabled={loading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: 12, border: "none", background: "#1877F2", color: "#fff", fontWeight: 500, fontSize: "0.9rem", cursor: "pointer" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                <path d="M24 12a12 12 0 1 0-13.875 11.85v-8.385H7.08V12h3.045V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.465h-2.796v8.385A12 12 0 0 0 24 12z"/>
              </svg>
              Continue with Facebook
            </button>
          </div>
        )}

        {mode !== "forgot" && (
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
            <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
            <span style={{ fontSize: "0.8rem", color: "var(--light)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
          </div>
        )}

        <form onSubmit={mode === "forgot" ? handleForgotPassword : handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {mode === "register" && (
            <>
              <input
                placeholder="Full name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
              />
              <input
                placeholder="Phone number (e.g. 082 123 4567)"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
              />
            </>
          )}

          <input
            type={mode === "register" ? "email" : "text"}
            placeholder={mode === "register" ? "Email address" : "Email or WhatsApp number"}
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            required
            style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
          />

          {mode !== "forgot" && (
            <>
              <input
                type="password"
                placeholder="Password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
              />
              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setError(""); }}
                  style={{ background: "none", border: "none", padding: 0, textAlign: "right", color: "var(--plum)", cursor: "pointer", fontSize: "0.85rem", alignSelf: "flex-end" }}
                >
                  Forgot password?
                </button>
              )}
            </>
          )}

          {error && (
            <p style={{ color: error.includes("Check your email") || error.includes("reset link sent") ? "var(--forest)" : "#E53935", fontSize: "0.85rem", margin: 0 }}>
              {error}
            </p>
          )}

          <button type="submit" className="btn-plum" style={{ marginTop: "0.25rem" }} disabled={loading}>
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : mode === "forgot" ? "Send reset link" : "Create account"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: "1.25rem", fontSize: "0.875rem", color: "var(--grey)" }}>
          {mode === "forgot" ? "Remember your password?" : mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button onClick={() => { setMode(mode === "register" ? "login" : mode === "forgot" ? "login" : "register"); setError(""); }} style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 500, cursor: "pointer" }}>
            {mode === "forgot" ? "Sign in" : mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>

        <p style={{ textAlign: "center", marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--light)" }}>
          By continuing you agree to our{" "}
          <Link href="/terms-and-conditions" style={{ color: "var(--plum)" }} onClick={close}>Terms</Link>
          {" "}and{" "}
          <Link href="/privacy-policy" style={{ color: "var(--plum)" }} onClick={close}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
