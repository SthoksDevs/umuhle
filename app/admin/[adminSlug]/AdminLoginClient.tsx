"use client";

// app/[adminSlug]/AdminLoginClient.tsx
// Three-step admin login: email+password → OTP email sent → verify code → session

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import { useRouter } from "next/navigation";

type Step = "credentials" | "otp" | "loading";

export default function AdminLoginClient() {
  const router = useRouter();
  const supabase = createClient();

  const [step,     setStep]    = useState<Step>("credentials");
  const [email,    setEmail]   = useState("");
  const [password, setPassword] = useState("");
  const [otp,      setOtp]     = useState(["", "", "", "", "", ""]);
  const [error,    setError]   = useState("");
  const [busy,     setBusy]    = useState(false);
  const [countdown, setCountdown] = useState(0);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Auto-focus first OTP input when step changes
  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => otpRefs.current[0]?.focus(), 80);
    }
  }, [step]);

  // ── Step 1: verify credentials → trigger OTP email ──────────────────────────
  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      const res = await fetch("/api/admin/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Invalid credentials.");
        return;
      }

      setStep("otp");
      setCountdown(60);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2: verify OTP → exchange for session ────────────────────────────────
  async function handleOtp(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) { setError("Enter the full 6-digit code."); return; }

    setError("");
    setBusy(true);
    setStep("loading");

    try {
      const res = await fetch("/api/admin/otp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code }),
      });
      const json = await res.json();

      if (!res.ok) {
        setStep("otp");
        setOtp(["", "", "", "", "", ""]);
        setError(json.error ?? "Incorrect code.");
        setTimeout(() => otpRefs.current[0]?.focus(), 80);
        return;
      }

      // Exchange tokenHash for a real Supabase session
      const { error: sessionError } = await supabase.auth.verifyOtp({
        token_hash: json.tokenHash,
        type:       "magiclink",
      });

      if (sessionError) {
        setStep("otp");
        setError("Session error — please try again.");
        return;
      }

      router.replace("/admin");
    } catch {
      setStep("otp");
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── OTP input handlers ───────────────────────────────────────────────────────
  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (digits.length === 6) {
      e.preventDefault();
      setOtp(digits.split(""));
      otpRefs.current[5]?.focus();
    }
  }

  async function handleResend() {
    if (countdown > 0) return;
    setBusy(true);
    setError("");
    try {
      await fetch("/api/admin/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setOtp(["", "", "", "", "", ""]);
      setCountdown(60);
      setTimeout(() => otpRefs.current[0]?.focus(), 80);
    } catch {
      setError("Could not resend code.");
    } finally {
      setBusy(false);
    }
  }

  // ── Styles (inline to match existing Umuhle style pattern) ──────────────────
  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 20,
    border: "1.5px solid rgba(155,127,184,0.18)",
    boxShadow: "0 24px 64px rgba(155,127,184,0.13)",
    padding: "2.5rem 2rem",
    width: "100%",
    maxWidth: 420,
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "0.85rem 1rem",
    borderRadius: 12,
    border: "1.5px solid rgba(155,127,184,0.25)",
    fontSize: "0.95rem",
    color: "var(--onyx, #1a1a1a)",
    background: "#fafafa",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const btn: React.CSSProperties = {
    width: "100%",
    padding: "0.9rem",
    borderRadius: 12,
    border: "none",
    background: "var(--plum, #9B7FB8)",
    color: "#fff",
    fontWeight: 600,
    fontSize: "0.95rem",
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.7 : 1,
    transition: "opacity 0.15s, transform 0.1s",
    letterSpacing: "0.01em",
  };

  const label: React.CSSProperties = {
    display: "block",
    fontSize: "0.78rem",
    fontWeight: 600,
    color: "var(--grey, #666)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: "0.4rem",
  };

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #f7f4fc 0%, #fdf9ff 100%)",
      padding: "1.5rem",
    }}>
      {/* Logo */}
      <div style={{ marginBottom: "2rem", textAlign: "center" }}>
        <Image
          src="/umuhle-icon.png"
          alt="Umuhle"
          width={52}
          height={52}
          style={{ borderRadius: "50%", objectFit: "cover", marginBottom: "0.75rem" }}
        />
        <div style={{
          fontFamily: "var(--font-display, 'Raleway', sans-serif)",
          fontWeight: 300,
          fontSize: "1.5rem",
          letterSpacing: "0.15em",
          color: "var(--plum, #9B7FB8)",
        }}>
          umuhle
        </div>
      </div>

      <div style={card}>

        {/* ── Step: loading ─────────────────────────────────────── */}
        {step === "loading" && (
          <div style={{ textAlign: "center", padding: "2rem 0" }}>
            <div style={{
              width: 40, height: 40,
              border: "3px solid rgba(155,127,184,0.2)",
              borderTopColor: "var(--plum, #9B7FB8)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 1.25rem",
            }} />
            <p style={{ color: "var(--grey, #666)", fontSize: "0.9rem" }}>
              Signing you in…
            </p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── Step 1: credentials ────────────────────────────────── */}
        {step === "credentials" && (
          <>
            <h1 style={{
              fontSize: "1.2rem",
              fontWeight: 500,
              color: "var(--onyx, #1a1a1a)",
              marginBottom: "0.35rem",
            }}>
              Admin sign in
            </h1>
            <p style={{ fontSize: "0.85rem", color: "var(--grey, #888)", marginBottom: "1.75rem" }}>
              Enter your credentials — a verification code will be emailed to you.
            </p>

            <form onSubmit={handleCredentials} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={label}>Email</label>
                <input
                  style={input}
                  type="email"
                  placeholder="info@umuhle.co.za"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <label style={label}>Password</label>
                <input
                  style={input}
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <p style={{ fontSize: "0.85rem", color: "#c0392b", background: "#fdf0ef", borderRadius: 8, padding: "0.6rem 0.85rem" }}>
                  {error}
                </p>
              )}

              <button type="submit" style={btn} disabled={busy}>
                {busy ? "Verifying…" : "Continue →"}
              </button>
            </form>
          </>
        )}

        {/* ── Step 2: OTP ───────────────────────────────────────── */}
        {step === "otp" && (
          <>
            <h1 style={{
              fontSize: "1.2rem",
              fontWeight: 500,
              color: "var(--onyx, #1a1a1a)",
              marginBottom: "0.35rem",
            }}>
              Check your email
            </h1>
            <p style={{ fontSize: "0.85rem", color: "var(--grey, #888)", marginBottom: "1.75rem" }}>
              A 6-digit code was sent to <strong style={{ color: "var(--onyx, #1a1a1a)" }}>{email}</strong>.
              Enter it below to complete sign-in.
            </p>

            <form onSubmit={handleOtp} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* OTP digit inputs */}
              <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center" }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    onPaste={handleOtpPaste}
                    style={{
                      width: 48,
                      height: 56,
                      textAlign: "center",
                      fontSize: "1.4rem",
                      fontWeight: 600,
                      borderRadius: 12,
                      border: `2px solid ${digit ? "var(--plum, #9B7FB8)" : "rgba(155,127,184,0.25)"}`,
                      background: digit ? "rgba(155,127,184,0.06)" : "#fafafa",
                      color: "var(--onyx, #1a1a1a)",
                      outline: "none",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  />
                ))}
              </div>

              {error && (
                <p style={{ fontSize: "0.85rem", color: "#c0392b", background: "#fdf0ef", borderRadius: 8, padding: "0.6rem 0.85rem", margin: 0 }}>
                  {error}
                </p>
              )}

              <button type="submit" style={btn} disabled={busy || otp.join("").length !== 6}>
                {busy ? "Verifying…" : "Verify code"}
              </button>
            </form>

            <div style={{ marginTop: "1.25rem", textAlign: "center" }}>
              {countdown > 0 ? (
                <p style={{ fontSize: "0.82rem", color: "var(--grey, #888)" }}>
                  Resend code in {countdown}s
                </p>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={busy}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--plum, #9B7FB8)",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Resend code
                </button>
              )}

              <button
                onClick={() => { setStep("credentials"); setError(""); setOtp(["","","","","",""]); }}
                style={{
                  display: "block",
                  margin: "0.5rem auto 0",
                  background: "none",
                  border: "none",
                  color: "var(--grey, #888)",
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ← Back
              </button>
            </div>
          </>
        )}

      </div>

      {/* Security note */}
      <p style={{
        marginTop: "1.5rem",
        fontSize: "0.75rem",
        color: "rgba(155,127,184,0.55)",
        textAlign: "center",
      }}>
        This page is restricted to authorised administrators only.
      </p>
    </div>
  );
}
