"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import Link from "next/link";

const ICON = "/umuhle-icon.png";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [showPass, setShowPass] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSuccess(true);
    setMessage("Password updated successfully. Redirecting…");
    setTimeout(() => router.push("/dashboard"), 2000);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.85rem 1rem",
    borderRadius: 12,
    border: "1.5px solid #E0E0E0",
    fontSize: "0.95rem",
    boxSizing: "border-box",
    fontFamily: "var(--font-body)",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, var(--plum-t) 0%, #fff 60%)", fontFamily: "var(--font-body)" }}>
      {/* Minimal nav */}
      <nav style={{ height: 60, display: "flex", alignItems: "center", padding: "0 1.5rem", borderBottom: "1px solid rgba(155,127,184,0.12)", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>
      </nav>

      {/* Form card */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 1.5rem" }}>
        <div style={{ background: "#fff", borderRadius: 24, padding: "2.5rem 2rem", width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.08)" }}>

          {/* Icon */}
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.5rem" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--plum)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>

          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.75rem", color: "var(--onyx)", marginBottom: "0.4rem" }}>
            Set new password
          </h1>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "2rem", lineHeight: 1.6 }}>
            Choose a strong password for your Umuhle account. You&apos;ll use this to sign in with your email or WhatsApp number.
          </p>

          {!success ? (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ position: "relative" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>New password</label>
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{ position: "absolute", right: 12, bottom: 12, background: "none", border: "none", color: "var(--light)", cursor: "pointer", fontSize: "0.8rem" }}
                >
                  {showPass ? "Hide" : "Show"}
                </button>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Confirm password</label>
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  style={inputStyle}
                />
              </div>

              {/* Strength hints */}
              {password.length > 0 && (
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {[8, 10, 12].map(len => (
                    <div key={len} style={{ flex: 1, height: 3, borderRadius: 2, background: password.length >= len ? (len >= 12 ? "var(--forest)" : "var(--plum)") : "#E0E0E0", transition: "background 0.2s" }} />
                  ))}
                </div>
              )}

              {message && (
                <p style={{ color: message.includes("successfully") ? "var(--forest)" : "#E53935", fontSize: "0.85rem", margin: 0 }}>
                  {message}
                </p>
              )}

              <button
                type="submit"
                className="btn-plum"
                disabled={loading}
                style={{ padding: "0.875rem", marginTop: "0.5rem", fontSize: "1rem" }}
              >
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>✅</div>
              <p style={{ color: "var(--forest)", fontWeight: 500, fontSize: "1rem" }}>{message}</p>
            </div>
          )}

          <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.83rem", color: "var(--light)" }}>
            <Link href="/" style={{ color: "var(--plum)", textDecoration: "none" }}>← Back to Umuhle</Link>
          </p>
        </div>
      </div>
    </div>
  );
}