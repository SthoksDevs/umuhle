"use client";

import { ChangeEvent, useRef, useState } from "react";
import { calculateSalonRegistrationPrice } from "@/lib/salon-pricing";

export interface StoreCsvImportResult {
  inserted: number;
  errors: string[];
  salonIds: string[];
}

interface StoreCsvImportProps {
  onImported?: (result: StoreCsvImportResult) => void;
  disabled?: boolean;
}

export default function StoreCsvImport({ onImported, disabled = false }: StoreCsvImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<StoreCsvImportResult | null>(null);
  const [error, setError] = useState("");

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError("");
    setResult(null);

    try {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        throw new Error("Please select a CSV file.");
      }

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/salons/import", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(data?.errors) && data.errors.length
          ? ` ${data.errors.slice(0, 5).join(" ")}`
          : "";
        throw new Error((data?.error || "Store import failed.") + details);
      }

      const stores = Array.isArray(data?.stores) ? data.stores : [];
      const importResult: StoreCsvImportResult = {
        inserted: Number(data?.inserted ?? 0),
        errors: Array.isArray(data?.errors) ? data.errors : [],
        salonIds: stores.map((s: { id: string }) => s.id).filter(Boolean),
      };
      setResult(importResult);
      onImported?.(importResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Store import failed.");
    } finally {
      setUploading(false);
    }
  };

  const handlePay = async () => {
    if (!result?.salonIds.length) return;
    setPaying(true);
    setError("");
    try {
      const response = await fetch("/api/ozow/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "salon", salonIds: result.salonIds }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.redirectUrl) {
        throw new Error(data?.error || "Could not start payment.");
      }
      window.location.href = data.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment.");
      setPaying(false);
    }
  };

  // Client-side preview only — the /api/ozow/initiate route recomputes this
  // from salonIds.length itself and never trusts a client-supplied amount.
  const pricing = result && result.salonIds.length > 0
    ? calculateSalonRegistrationPrice(result.salonIds.length)
    : null;

  return (
    <div style={{ border: "1.5px solid rgba(155,127,184,0.18)", borderRadius: 16, background: "#fff", padding: "1rem" }}>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        disabled={disabled || uploading}
        style={{ display: "none" }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>Import stores from CSV</p>
          <p style={{ margin: "0.25rem 0 0", color: "var(--grey)", fontSize: "0.76rem" }}>
            Upload your CSV and Umuhle will validate and create the stores securely on the server.
          </p>
        </div>
        <button
          type="button"
          className="btn-plum"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          style={{ padding: "0.55rem 1rem", fontSize: "0.8rem", whiteSpace: "nowrap" }}
        >
          {uploading ? "Importing…" : "Choose CSV"}
        </button>
      </div>

      {error && (
        <p style={{ margin: "0.75rem 0 0", color: "#C62828", fontSize: "0.78rem", lineHeight: 1.5 }}>{error}</p>
      )}

      {result && (
        <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", lineHeight: 1.5 }}>
          <p style={{ margin: 0, color: "#2E7D32" }}>
            {result.inserted} store{result.inserted === 1 ? "" : "s"} imported successfully.
          </p>
          {result.errors.length > 0 && (
            <div style={{ marginTop: "0.4rem", color: "#8A4B00" }}>
              <strong>Rows needing attention:</strong>
              <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
                {result.errors.slice(0, 10).map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
              </ul>
              {result.errors.length > 10 && <span>And {result.errors.length - 10} more.</span>}
            </div>
          )}

          {pricing && (
            <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 12, background: "#FAF7FC" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                Registration fee: R{pricing.totalRand.toFixed(2)}
                <span style={{ fontWeight: 400, color: "var(--grey)" }}> (R{pricing.rateRand.toFixed(2)} × {result.salonIds.length})</span>
              </p>
              <p style={{ margin: "0.35rem 0 0", color: "var(--grey)" }}>
                These stores stay in review and won&apos;t go live until this is paid.
              </p>
              <button
                type="button"
                className="btn-plum"
                onClick={handlePay}
                disabled={paying}
                style={{ marginTop: "0.6rem", padding: "0.55rem 1rem", fontSize: "0.8rem" }}
              >
                {paying ? "Redirecting…" : `Pay R${pricing.totalRand.toFixed(2)} to activate`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
