"use client";

// app/activate-employee/page.tsx
//
// Where an employee lands after clicking the invite link from
// app/api/branch-employees/invite/route.ts (options.redirectTo). By the
// time this renders, @supabase/ssr's browser client has already exchanged
// the invite link's code for a real session automatically — same
// assumption app/reset-password/page.tsx already makes for its own
// (structurally identical) flow, no manual token handling needed here
// either. See docs/role-based-dashboards-status.md.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import Link from "next/link";

const ICON = "/umuhle-icon.png";

export default function ActivateEmployeePage() {
  const router = useRouter();
  const supabase = createClient();

  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setHasSession(!!user);
      setCheckingSession(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (password.length < 8) { setMessage("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setMessage("Passwords do not match."); return; }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setLoading(false); setMessage(error.message); return; }

    // Flip invite_status pending -> active. Best-effort: if this fails,
    // the password is already set and the account works — worst case they
    // land on "No active branch assignment" in the dashboard and can
    // contact the owner, rather than being locked out.
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      await fetch("/api/branch-employees/activate", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => {});
    }

    setLoading(false);
    setSuccess(true);
    setMessage("You're all set. Redirecting to your dashboard…");
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
      <nav style={{ height: 60, display: "flex", alignItems: "center", padding: "0 1.5rem", borderBottom: "1px solid rgba(155,127,184,0.12)", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>
      </nav>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 1.5rem" }}>
        <div style={{ background: "#fff", borderRadius: 24, padding: "2.5rem 2rem", width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.08)" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.5rem" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--plum)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
          </div>

          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.75rem", color: "var(--onyx)", marginBottom: "0.4rem" }}>
            Welcome to the team
          </h1>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "2rem", lineHeight: 1.6 }}>
            Set a password to activate your Umuhle account.
          </p>

          {checkingSession ? (
            <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Checking your invite…</p>
          ) : !hasSession ? (
            <p style={{ color: "#E53935", fontSize: "0.9rem" }}>
              This invite link has expired or was already used. Ask whoever added you to send a new one.
            </p>
          ) : !success ? (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ position: "relative" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Password</label>
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  style={inputStyle}
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  style={{ position: "absolute", right: 12, bottom: 12, background: "none", border: "none", color: "var(--light)", cursor: "pointer", fontSize: "0.8rem" }}>
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

              {message && <p style={{ color: "#E53935", fontSize: "0.85rem", margin: 0 }}>{message}</p>}

              <button type="submit" className="btn-plum" disabled={loading} style={{ padding: "0.875rem", marginTop: "0.5rem", fontSize: "1rem" }}>
                {loading ? "Activating…" : "Activate my account"}
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
