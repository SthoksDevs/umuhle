// components/CompleteProfileGate.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, AccountType } from "@/types";
import { ACCOUNT_TYPES, ARTIST_CATEGORIES } from "@/types";

const SNOOZE_KEY = "umuhle_profile_gate_snoozed";

/**
 * Customers can sign up with Google/Facebook, which skips our own
 * registration form entirely. Since WhatsApp is the primary way we reach
 * people on Umuhle, and we need to know whether someone is a customer,
 * artist, or business partner, this gate catches anyone whose profile is
 * still missing that info and asks for it — once per session.
 */
export default function CompleteProfileGate() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [show, setShow] = useState(false);

  const [accountType, setAccountType] = useState<AccountType>("customer");
  const [artistCategory, setArtistCategory] = useState<string>("hair");
  const [whatsapp, setWhatsapp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const checkProfile = async (u: User | null) => {
      setUser(u);
      if (!u) { setProfile(null); setShow(false); return; }

      const { data } = await supabase.from("profiles").select("*").eq("id", u.id).single();
      if (!data) return;
      const p = data as Profile;
      setProfile(p);
      setAccountType((p.account_type as AccountType) ?? "customer");
      setArtistCategory(p.artist_category ?? "hair");

      const snoozed = typeof window !== "undefined" && sessionStorage.getItem(SNOOZE_KEY) === "1";
      if (!p.phone && !snoozed) setShow(true);
    };

    supabase.auth.getUser().then(({ data: { user } }) => checkProfile(user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      checkProfile(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!whatsapp.trim()) { setError("WhatsApp number is required."); return; }

    setSaving(true);
    setError("");

    const { data, error: err } = await supabase
      .from("profiles")
      .update({
        phone: whatsapp.trim(),
        account_type: accountType,
        artist_category: accountType === "artist" ? artistCategory : null,
        is_artist: accountType === "artist",
        is_partner: accountType === "business_partner",
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .select()
      .single();

    setSaving(false);
    if (err) { setError(err.message); return; }
    if (data) { setProfile(data as Profile); setShow(false); }
  };

  const handleLater = () => {
    sessionStorage.setItem(SNOOZE_KEY, "1");
    setShow(false);
  };

  if (!show || !user || !profile) return null;

  const inputStyle: React.CSSProperties = {
    padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0",
    fontSize: "0.9rem", width: "100%", boxSizing: "border-box",
  };

  return (
    <div className="modal-overlay">
      <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 440, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.4rem" }}>
          Just one more thing
        </h2>
        <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
          We mainly talk to you on WhatsApp — bookings, confirmations, and updates all go there.
        </p>

        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              WhatsApp number *
            </label>
            <input
              type="tel"
              required
              placeholder="e.g. 082 123 4567"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              I am signing up as
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
              {ACCOUNT_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setAccountType(t.id)}
                  style={{
                    padding: "0.6rem 0.4rem", borderRadius: 12, fontSize: "0.78rem", fontWeight: 500,
                    border: `1.5px solid ${accountType === t.id ? "var(--plum)" : "#E0E0E0"}`,
                    background: accountType === t.id ? "var(--plum-t)" : "#fff",
                    color: accountType === t.id ? "var(--plum)" : "var(--grey)", cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {accountType === "artist" && (
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                What do you do?
              </label>
              <select value={artistCategory} onChange={(e) => setArtistCategory(e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
                {ARTIST_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p style={{ color: "#E53935", fontSize: "0.85rem", margin: 0 }}>{error}</p>}

          <button type="submit" className="btn-plum" disabled={saving} style={{ marginTop: "0.25rem" }}>
            {saving ? "Saving…" : "Continue"}
          </button>
          <button type="button" onClick={handleLater} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "0.8rem", cursor: "pointer", textAlign: "center" }}>
            Ask me later
          </button>
        </form>
      </div>
    </div>
  );
}