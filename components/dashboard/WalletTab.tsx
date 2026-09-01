"use client";

// components/dashboard/WalletTab.tsx
//
// Balance, withdrawal requests and PayFast merchant-ID setup for
// instant-split payouts. Reads the existing wallets/wallet_transactions/
// withdrawals tables (already used by the admin panel). Shown on all three
// DashboardShell roles — withdrawals are naturally owner/artist-only in
// practice since only they accrue a wallet balance, but nothing here is
// hard-gated by role; see docs/role-based-dashboards-status.md for why
// (withdrawals/wallets are keyed only to profile_id, no branch concept —
// confirms employees never get a wallet UI simply because they're never
// wired up to one, not because of an explicit block).

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Wallet, WalletTransaction, Withdrawal } from "@/types";
import { PAYOUT_HOLD_DAYS, getNextPayoutDate, formatPayoutDate } from "@/lib/payouts";
import { fmt } from "@/lib/dashboard/format";

// Matches the R100 minimum withdrawal called out on the public Earn page.
const MIN_WITHDRAWAL_CENTS = 10000; // R100

export default function WalletTab({ user }: { user: User }) {
  const supabase = createClient();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    // Recalculates available/pending/total_earned straight from the ledger —
    // this is what moves a credit from "pending" into "available" once its
    // payout hold window has passed. Pure recalculation, so it's always safe
    // to call and needs no cron job.
    await supabase.rpc("recompute_wallet_balance", { p_profile_id: user.id });

    const { data: walletData, error: walletErr } = await supabase
      .from("wallets")
      .select("*")
      .eq("profile_id", user.id)
      .maybeSingle();

    if (walletErr) {
      setLoadError("Couldn't load your wallet. Please try again shortly.");
      setLoading(false);
      return;
    }
    setWallet((walletData as Wallet) ?? null);

    if (walletData) {
      const { data: txData } = await supabase
        .from("wallet_transactions")
        .select("*")
        .eq("wallet_id", walletData.id)
        .order("created_at", { ascending: false })
        .limit(30);
      setTransactions((txData as WalletTransaction[]) ?? []);
    } else {
      setTransactions([]);
    }

    const { data: wdData } = await supabase
      .from("withdrawals")
      .select("*")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    setWithdrawals((wdData as Withdrawal[]) ?? []);

    setLoading(false);
  }, [user.id, supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const availableBalance = wallet?.available_balance ?? 0;
  const pendingBalance = wallet?.pending_balance ?? 0;
  const totalEarned = wallet?.total_earned ?? 0;
  const hasOpenRequest = withdrawals.some(w => w.status === "pending" || w.status === "approved");
  const canRequest = !!wallet && availableBalance >= MIN_WITHDRAWAL_CENTS && !hasOpenRequest;

  const handleSubmitRequest = async () => {
    if (!wallet || !canRequest) return;
    if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
      setFormError("Please fill in all your bank details.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const { error: insertError } = await supabase.from("withdrawals").insert({
      profile_id: user.id,
      amount: availableBalance,
      bank_name: bankName.trim(),
      account_number: accountNumber.trim(),
      account_holder: accountHolder.trim(),
      status: "pending",
    });
    setSubmitting(false);
    if (insertError) {
      setFormError("Couldn't submit your request. Please try again.");
      return;
    }
    setShowRequestForm(false);
    setBankName(""); setAccountNumber(""); setAccountHolder("");
    setNotice(`Withdrawal request submitted. Payouts run Mondays, Wednesdays and Fridays — next payout run is ${formatPayoutDate(getNextPayoutDate())}.`);
    load();
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "1.25rem" }}>Wallet</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {[...Array(2)].map((_, i) => <div key={i} style={{ height: i === 0 ? 150 : 90, borderRadius: 20, background: "var(--plum-t)", animation: "pulse 1.5s ease-in-out infinite" }} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Wallet</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
        Your earnings from completed bookings and delivered orders land here (Umuhle keeps a service fee — R5 flat, or 10% on amounts above R50 — and you keep the rest), along with any referral rewards. New earnings sit in <strong>Pending</strong> for {PAYOUT_HOLD_DAYS} days after completion before moving to your available balance — withdraw once that reaches R100. Payouts are processed every Monday, Wednesday and Friday.
      </p>

      {loadError && (
        <div style={{ background: "#FBE9E7", border: "1.5px solid rgba(191,54,12,0.25)", borderRadius: 14, padding: "0.85rem 1.25rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: "#BF360C" }}>
          {loadError}
        </div>
      )}

      {notice && (
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 14, padding: "0.85rem 1.25rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: "var(--onyx)" }}>
          {notice}
        </div>
      )}

      {/* Balance card */}
      <div style={{ background: "linear-gradient(135deg, var(--plum) 0%, var(--plum-d) 100%)", borderRadius: 20, padding: "1.75rem", marginBottom: "1.25rem", color: "#fff" }}>
        <p style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.85, marginBottom: "0.4rem" }}>Available balance</p>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", fontWeight: 500, marginBottom: "1.25rem" }}>{fmt(availableBalance)}</p>
        <div style={{ display: "flex", gap: "1.75rem" }}>
          <div>
            <p style={{ fontSize: "0.7rem", opacity: 0.75, marginBottom: 2 }}>Pending</p>
            <p style={{ fontSize: "0.95rem", fontWeight: 500 }}>{fmt(pendingBalance)}</p>
            {pendingBalance > 0 && (
              <p style={{ fontSize: "0.65rem", opacity: 0.7, marginTop: 2 }}>in {PAYOUT_HOLD_DAYS}-day payout window</p>
            )}
          </div>
          <div>
            <p style={{ fontSize: "0.7rem", opacity: 0.75, marginBottom: 2 }}>Total earned</p>
            <p style={{ fontSize: "0.95rem", fontWeight: 500 }}>{fmt(totalEarned)}</p>
          </div>
        </div>
      </div>

      {/* Withdraw action / status */}
      {hasOpenRequest ? (
        <div style={{ background: "var(--plum-t)", borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "2rem", fontSize: "0.85rem", color: "var(--onyx)" }}>
          You have a withdrawal request being processed. Payouts run Mondays, Wednesdays and Fridays — next payout run is {formatPayoutDate(getNextPayoutDate())}.
        </div>
      ) : (
        <div style={{ marginBottom: "2rem" }}>
          <button
            className="btn-plum"
            disabled={!canRequest}
            onClick={() => setShowRequestForm(true)}
            style={{ padding: "0.75rem 2rem", opacity: canRequest ? 1 : 0.5, cursor: canRequest ? "pointer" : "not-allowed" }}
          >
            Request withdrawal
          </button>
          {!canRequest && (
            <p style={{ fontSize: "0.8rem", color: "var(--light)", marginTop: "0.6rem" }}>
              You need at least R100 available to request a withdrawal.
            </p>
          )}
        </div>
      )}

      {/* Instant payouts via PayFast */}
      <PayFastMerchantSection userId={user.id} />

      {/* Request form modal */}
      {showRequestForm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowRequestForm(false); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.35rem" }}>Request withdrawal</h3>
            <p style={{ color: "var(--grey)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>You&apos;re requesting <strong>{fmt(availableBalance)}</strong>.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Bank *</label>
                <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Capitec" style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Account number *</label>
                <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Account holder name *</label>
                <input value={accountHolder} onChange={e => setAccountHolder(e.target.value)} style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
              </div>
              {formError && <p style={{ color: "#E53935", fontSize: "0.8rem" }}>{formError}</p>}
              <button className="btn-plum" onClick={handleSubmitRequest} disabled={submitting} style={{ width: "100%", padding: "0.75rem" }}>
                {submitting ? "Submitting…" : "Submit request"}
              </button>
              <button onClick={() => setShowRequestForm(false)} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "0.85rem", cursor: "pointer", textAlign: "center" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction history */}
      <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.85rem" }}>Transaction history</p>
      {transactions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>👛</div>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>No transactions yet. Completed bookings, delivered orders, and referrals will show up here.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {transactions.map(t => {
            const clearsAt = t.clears_at ? new Date(t.clears_at) : null;
            const isPending = t.type === "credit" && clearsAt !== null && clearsAt.getTime() > Date.now();
            const daysLeft = isPending && clearsAt ? Math.max(1, Math.ceil((clearsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
            return (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", borderRadius: 14, padding: "0.9rem 1.1rem", border: "1.5px solid rgba(155,127,184,0.12)" }}>
                <div>
                  <p style={{ fontSize: "0.88rem", color: "var(--onyx)", marginBottom: 2 }}>{t.description}</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--light)" }}>
                    {new Date(t.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                    {isPending && <span style={{ color: "#E65100" }}> · available in {daysLeft} day{daysLeft === 1 ? "" : "s"}</span>}
                  </p>
                </div>
                <p style={{ fontSize: "0.95rem", fontWeight: 600, color: t.type === "credit" ? "var(--forest)" : "var(--onyx)" }}>
                  {t.type === "credit" ? "+" : "−"}{fmt(t.amount)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PayFast instant payouts (split payments) ──────────────────────────────────
// Collects the artist/store partner's own PayFast merchant ID so PayFast can
// pay them directly at the moment of payment, instead of the wallet's
// pending → 2-day-hold → manual withdrawal path — see lib/payments/split.ts
// for the full mechanics and the constraints this is built around.
//
// ⚠️  Enabling this is TWO steps, and only the first is self-serve:
//   1. The partner pastes their merchant ID here (this component).
//   2. TKZ adds that merchant ID to Umuhle's own "Allowed merchants" list
//      in the PayFast dashboard (this appears to require a manual,
//      per-merchant step there — no public API for it was found; confirm
//      with PayFast support before assuming this can be automated) and
//      then flips payfast_split_approved for that profile, e.g. via the
//      admin panel.
// Until step 2 happens, this partner keeps earning through the wallet
// exactly as before — nothing about their current payouts changes just by
// saving an ID here.

function PayFastMerchantSection({ userId }: { userId: string }) {
  const supabase = createClient();
  const [merchantId, setMerchantId] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("payfast_merchant_id, payfast_split_approved")
        .eq("id", userId)
        .single();
      setSavedId(data?.payfast_merchant_id ?? null);
      setMerchantId(data?.payfast_merchant_id ?? "");
      setApproved(Boolean(data?.payfast_split_approved));
      setLoading(false);
    })();
  }, [userId, supabase]);

  const handleSave = async () => {
    const trimmed = merchantId.trim();
    if (!trimmed) return;
    setSaving(true);
    // A new/changed ID always needs re-approving — see the file header.
    const { error } = await supabase
      .from("profiles")
      .update({ payfast_merchant_id: trimmed, payfast_split_approved: false })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      setNotice("Couldn't save your merchant ID. Please try again.");
      return;
    }
    setSavedId(trimmed);
    setApproved(false);
    setNotice("Saved. We'll activate instant payouts once it's confirmed on our end — usually within a few days.");
  };

  if (loading) return null;

  return (
    <div style={{ background: "#fff", border: "1.5px solid var(--plum-t)", borderRadius: 18, padding: "1.5rem", marginBottom: "2rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.05rem" }}>Instant payouts via PayFast</h3>
        {savedId && (
          <span style={{
            fontSize: "0.7rem", fontWeight: 600, padding: "0.25rem 0.65rem", borderRadius: 999,
            background: approved ? "#E6F4EA" : "var(--plum-t)", color: approved ? "#1E7B34" : "var(--onyx)",
          }}>
            {approved ? "Active" : "Pending approval"}
          </span>
        )}
      </div>
      <p style={{ color: "var(--grey)", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1rem" }}>
        {approved
          ? "Your bookings and single-seller orders now pay you directly and instantly — no 2-day hold, no manual withdrawal. (Multi-seller cart orders still go through your wallet above, since a single payment can only split to one PayFast account.)"
          : "Add your own PayFast merchant ID and, once we've confirmed it on our end, eligible bookings and orders will pay you the moment the customer pays — instead of sitting in your wallet's pending balance."}
      </p>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "0.5rem" }}>
        <input
          type="text"
          value={merchantId}
          onChange={(e) => setMerchantId(e.target.value)}
          placeholder="e.g. 10000100"
          style={{ flex: 1, padding: "0.7rem 0.9rem", borderRadius: 12, border: "1.5px solid var(--plum-t)", fontSize: "0.9rem" }}
        />
        <button
          className="btn-plum"
          disabled={saving || !merchantId.trim() || merchantId.trim() === savedId}
          onClick={handleSave}
          style={{ padding: "0.7rem 1.4rem", opacity: saving || !merchantId.trim() || merchantId.trim() === savedId ? 0.5 : 1 }}
        >
          {saving ? "Saving…" : savedId ? "Update" : "Save"}
        </button>
      </div>

      {notice && <p style={{ fontSize: "0.8rem", color: "var(--onyx)", marginTop: "0.4rem" }}>{notice}</p>}

      <button
        onClick={() => setShowHelp((s) => !s)}
        style={{ background: "none", border: "none", padding: 0, marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--plum)", textDecoration: "underline", cursor: "pointer" }}
      >
        {showHelp ? "Hide" : "Don't have a PayFast merchant ID?"}
      </button>

      {showHelp && (
        <div style={{ marginTop: "0.85rem", padding: "1rem 1.1rem", background: "var(--plum-t)", borderRadius: 14, fontSize: "0.82rem", lineHeight: 1.7, color: "var(--onyx)" }}>
          <p style={{ marginBottom: "0.6rem" }}>
            Your merchant ID is free and comes with a PayFast account — it&apos;s the same account you&apos;d use to accept payments anywhere else, not something specific to Umuhle.
          </p>
          <ol style={{ paddingLeft: "1.1rem", marginBottom: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <li>
              Sign up for a free PayFast account at{" "}
              <a href="https://www.payfast.io" target="_blank" rel="noopener noreferrer" style={{ color: "var(--plum)" }}>payfast.io</a>
              {" "}(business or individual, whichever fits you).
            </li>
            <li>
              Once you&apos;re logged in, your Merchant ID is shown on your Dashboard, or under Settings → Integration. PayFast&apos;s own guide:{" "}
              <a href="https://payfast.io/faq/merchant-faqs/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--plum)" }}>Merchant FAQs</a>.
            </li>
            <li>Paste that number above and save.</li>
          </ol>
          <p style={{ opacity: 0.85 }}>
            Curious how the instant-pay part works under the hood? See PayFast&apos;s{" "}
            <a href="https://payfast.io/features/split-payments/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--plum)" }}>Split Payments</a> page.
          </p>
        </div>
      )}
    </div>
  );
}
