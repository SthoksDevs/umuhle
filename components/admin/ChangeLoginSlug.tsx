// components/admin/ChangeLoginSlug.tsx
// Drop this component into your superadmin page (app/admin/page.tsx).
// It lets the admin change the secret login URL from the dashboard.
//
// Usage:
//   import ChangeLoginSlug from "@/components/admin/ChangeLoginSlug";
//   // Inside your admin dashboard JSX (e.g., inside a "Settings" tab):
//   <ChangeLoginSlug />

"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ChangeLoginSlug() {
  const supabase = createClient();

  const [current, setCurrent] = useState<string>("");
  const [newSlug, setNewSlug] = useState("");
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");
  const [busy,    setBusy]    = useState(false);

  useEffect(() => {
    supabase
      .from("site_config")
      .select("value")
      .eq("key", "admin_login_slug")
      .single()
      .then(({ data }) => {
        if (data) setCurrent(data.value);
      });
  }, [supabase]);

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const slug = newSlug.trim().toLowerCase();

    if (!/^[a-z0-9\-_]{6,60}$/.test(slug)) {
      setError("Slug must be 6–60 characters: lowercase letters, numbers, hyphens or underscores.");
      return;
    }

    if (slug === current) {
      setError("That's the same as the current URL — nothing changed.");
      return;
    }

    setBusy(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setError("Not authenticated. Please refresh.");
        return;
      }

      const res = await fetch("/api/admin/otp", {
        method:  "DELETE",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ newSlug: slug }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Failed to update login URL.");
        return;
      }

      setCurrent(slug);
      setNewSlug("");
      setSuccess(
        `Login URL updated to /${slug}. Bookmark it now — the old URL no longer works.`
      );
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const input: React.CSSProperties = {
    flex: 1,
    padding: "0.75rem 1rem",
    borderRadius: 10,
    border: "1.5px solid rgba(155,127,184,0.25)",
    fontSize: "0.9rem",
    color: "#1a1a1a",
    background: "#fafafa",
    outline: "none",
    minWidth: 0,
  };

  return (
    <div style={{
      background: "#fff",
      border: "1.5px solid rgba(155,127,184,0.15)",
      borderRadius: 16,
      padding: "1.5rem",
      maxWidth: 560,
    }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "#1a1a1a", margin: "0 0 0.35rem" }}>
        Secret login URL
      </h3>
      <p style={{ fontSize: "0.82rem", color: "#888", margin: "0 0 1.25rem", lineHeight: 1.5 }}>
        The admin dashboard is only accessible via a private URL. Change it here if you suspect it
        has been discovered. The new URL takes effect immediately.
      </p>

      {current && (
        <div style={{
          background: "rgba(155,127,184,0.06)",
          border: "1px solid rgba(155,127,184,0.15)",
          borderRadius: 10,
          padding: "0.6rem 0.9rem",
          marginBottom: "1rem",
          fontSize: "0.82rem",
          color: "#666",
        }}>
          Current URL: <strong style={{ color: "#9B7FB8", fontFamily: "monospace" }}>
            umuhle.co.za/{current}
          </strong>
        </div>
      )}

      <form onSubmit={handleChange} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", flex: 1, background: "#fafafa", border: "1.5px solid rgba(155,127,184,0.25)", borderRadius: 10, overflow: "hidden" }}>
          <span style={{ padding: "0 0 0 0.85rem", fontSize: "0.85rem", color: "#bbb", whiteSpace: "nowrap", flexShrink: 0 }}>
            umuhle.co.za/
          </span>
          <input
            style={{ ...input, border: "none", background: "transparent" }}
            type="text"
            placeholder="new-secret-slug"
            value={newSlug}
            onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9\-_]/g, ""))}
            maxLength={60}
            required
          />
        </div>

        <button
          type="submit"
          disabled={busy || !newSlug.trim()}
          style={{
            padding: "0.75rem 1.25rem",
            borderRadius: 10,
            border: "none",
            background: busy ? "#ccc" : "var(--plum, #9B7FB8)",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.85rem",
            cursor: busy ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {busy ? "Saving…" : "Update URL"}
        </button>
      </form>

      {error && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "#c0392b", background: "#fdf0ef", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          {error}
        </p>
      )}

      {success && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "#2e7d32", background: "#f1f8e9", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          ✓ {success}
        </p>
      )}

      <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#bbb" }}>
        Allowed characters: a–z, 0–9, hyphens, underscores. Minimum 6 characters.
      </p>
    </div>
  );
}
