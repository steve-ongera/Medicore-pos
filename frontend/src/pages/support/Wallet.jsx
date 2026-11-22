// src/pages/support/Wallet.jsx
// Safaricom-style self-service: top up the wallet with M-Pesa, then buy a bundle with it.
// Restyled to match the Subscriptions page (page-header, card, btn, badge, data-table layout).
// Logic, data and API calls are unchanged.
import { useCallback, useEffect, useRef, useState } from "react";
import { buyBundle, getSubscription, getWallet, topUpWallet } from "../../services/api.js";

const kes = (v) => `KSh ${Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const when = (d) => (d ? new Date(d).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "-");

const LABEL_STYLE = {
  fontSize: "var(--fs-2xs)",
  fontWeight: "var(--fw-semibold)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  marginBottom: "var(--space-1)",
};

const ALERT_ICON = {
  success: "bi-check-circle",
  danger: "bi-exclamation-circle",
  info: "bi-info-circle",
};

function MsgAlert({ msg, style }) {
  if (!msg) return null;
  return (
    <div className={`alert alert-${msg.type}`} role="alert" style={style}>
      <i className={`bi ${ALERT_ICON[msg.type] || "bi-info-circle"} alert-icon`} aria-hidden="true" />
      <div className="alert-message">{msg.text}</div>
    </div>
  );
}

export default function Wallet() {
  const [sub, setSub] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null); // { type: "success" | "danger" | "info", text }
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [paying, setPaying] = useState(false);
  const [buying, setBuying] = useState("");
  const [qty, setQty] = useState({});
  const [autoRenew, setAutoRenew] = useState(false);
  const poll = useRef(null);

  const load = useCallback(async () => {
    const [s, w] = await Promise.all([getSubscription(), getWallet()]);
    setSub(s);
    setWallet(w);
    return Number(w.balance);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg({ type: "danger", text: e.message })).finally(() => setLoading(false));
    return () => clearInterval(poll.current);
  }, [load]);

  const topUp = async (e) => {
    e.preventDefault();
    setMsg(null);
    setPaying(true);
    try {
      const start = Number(wallet?.balance || 0);
      const r = await topUpWallet({ phone, amount: Number(amount) });
      setMsg({ type: "info", text: r.detail });
      // The balance changes when Safaricom calls our server back. Check every 4s for up to 2 minutes.
      let tries = 0;
      clearInterval(poll.current);
      poll.current = setInterval(async () => {
        tries += 1;
        try {
          const bal = await load();
          if (bal > start) {
            clearInterval(poll.current);
            setPaying(false);
            setAmount("");
            setMsg({ type: "success", text: `Payment received. New balance ${kes(bal)}.` });
          }
        } catch { /* keep polling */ }
        if (tries >= 30) {
          clearInterval(poll.current);
          setPaying(false);
          setMsg({ type: "info", text: "Still waiting for M-Pesa. If you paid, your balance will update shortly." });
        }
      }, 4000);
    } catch (err) {
      setMsg({ type: "danger", text: err.message });
      setPaying(false);
    }
  };

  const buy = async (b) => {
    setMsg(null);
    setBuying(b.code);
    try {
      const r = await buyBundle({ bundle: b.code, quantity: qty[b.code] || 1, autoRenew });
      await load();
      setMsg({ type: "success", text: `${r.detail} Valid until ${when(r.expires_at)}.` });
    } catch (err) {
      setMsg({ type: "danger", text: err.message }); // e.g. "Insufficient wallet balance. Top up with M-Pesa first."
    } finally {
      setBuying("");
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <span className="loading-screen__label">Loading wallet…</span>
      </div>
    );
  }
  if (!sub || !wallet) return <div>{msg && <MsgAlert msg={msg} />}</div>;

  const limits = sub.limits || {};
  const unlimited = (v) => (v === null || v === undefined ? "Unlimited" : v.toLocaleString());

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Licensing &amp; Service</div>
          <h1 className="page-title">Wallet &amp; bundles</h1>
          <p className="page-subtitle">Top up with M-Pesa, then buy a bundle with your balance.</p>
        </div>
      </div>

      <MsgAlert msg={msg} style={{ marginBottom: "var(--space-4)" }} />

      {/* ---- Balance + what you have right now ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "var(--space-4)",
          alignItems: "stretch",
        }}
      >
        <div className="card">
          <div className="card-body">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              <div className="stat-card__icon tone-success" style={{ width: 40, height: 40 }}>
                <i className="bi bi-wallet2" style={{ fontSize: 20 }}></i>
              </div>
              <h4 className="h4" style={{ margin: 0 }}>Wallet balance</h4>
            </div>
            <div
              style={{
                padding: "var(--space-3)",
                background: "var(--surface-sunken)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div style={LABEL_STYLE}>Available</div>
              <strong
                style={{
                  fontSize: "var(--fs-2xl)",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)",
                }}
              >
                {kes(wallet.balance)}
              </strong>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              <div className="stat-card__icon tone-info" style={{ width: 40, height: 40 }}>
                <i className="bi bi-shield-check" style={{ fontSize: 20 }}></i>
              </div>
              <h4 className="h4" style={{ margin: 0 }}>Current bundle</h4>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "var(--space-3)",
                padding: "var(--space-3)",
                background: "var(--surface-sunken)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div>
                <div style={LABEL_STYLE}>Bundle</div>
                <strong style={{ fontSize: "var(--fs-lg)", color: "var(--text-primary)" }}>{sub.plan_label}</strong>
              </div>
              <div>
                <div style={LABEL_STYLE}>Status</div>
                {sub.is_active
                  ? <span className="badge badge-success">Active</span>
                  : <span className="badge badge-danger">Expired</span>}
              </div>
              {sub.is_active && (
                <>
                  <div>
                    <div style={LABEL_STYLE}>Expires</div>
                    <strong style={{ fontSize: "var(--fs-sm)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                      {when(sub.expires_at)}
                    </strong>
                  </div>
                  <div>
                    <div style={LABEL_STYLE}>Days left</div>
                    <strong style={{ fontSize: "var(--fs-lg)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                      {sub.days_left}
                    </strong>
                  </div>
                </>
              )}
              <div>
                <div style={LABEL_STYLE}>Sales left</div>
                <strong style={{ fontSize: "var(--fs-lg)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {sub.sales_remaining === null ? "Unlimited" : sub.sales_remaining}
                </strong>
              </div>
              <div>
                <div style={LABEL_STYLE}>Staff accounts</div>
                <strong style={{ fontSize: "var(--fs-lg)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {unlimited(limits.max_users)}
                </strong>
              </div>
              <div>
                <div style={LABEL_STYLE}>Products</div>
                <strong style={{ fontSize: "var(--fs-lg)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {unlimited(limits.max_products)}
                </strong>
              </div>
            </div>

            {!sub.is_active && (
              <div className="alert alert-danger" role="alert" style={{ marginTop: "var(--space-4)", marginBottom: 0 }}>
                <i className="bi bi-exclamation-triangle alert-icon" aria-hidden="true" />
                <div className="alert-message">Expired. Selling is paused until you buy a bundle.</div>
              </div>
            )}

            {(sub.bundles || []).length > 1 && (
              <ul
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-1)",
                  padding: 0,
                  margin: "var(--space-3) 0 0",
                  listStyle: "none",
                  fontSize: "var(--fs-xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                {sub.bundles.map((b, i) => (
                  <li key={i}>
                    {b.name}: {b.sales_remaining === null ? "unlimited" : `${b.sales_remaining} sales`} · until {when(b.expires_at)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ---- Top up ---- */}
      <div className="card" style={{ marginTop: "var(--space-6)" }}>
        <div className="card-body">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <div className="stat-card__icon" style={{ width: 40, height: 40 }}>
              <i className="bi bi-phone" style={{ fontSize: 20 }} aria-hidden="true"></i>
            </div>
            <h4 className="h4" style={{ margin: 0 }}>Top up with M-Pesa</h4>
          </div>

          <form
            onSubmit={topUp}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "var(--space-4)",
              alignItems: "end",
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="tp-phone">M-Pesa number</label>
              <input id="tp-phone" className="input" placeholder="0712345678" inputMode="tel"
                     value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="tp-amount">Amount (KSh)</label>
              <input id="tp-amount" className="input" type="number" min="10" step="1"
                     value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <button className="btn btn-primary btn-block" disabled={paying}>
                {paying ? "Waiting for payment…" : "Send M-Pesa prompt"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ---- Buy a bundle ---- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--space-3)",
          marginTop: "var(--space-6)",
        }}
      >
        <h4 className="h4" style={{ margin: 0 }}>Buy a bundle</h4>
        <div className="checkbox-row">
          <input id="auto" className="checkbox" type="checkbox" checked={autoRenew}
                 onChange={(e) => setAutoRenew(e.target.checked)} />
          <label htmlFor="auto" className="checkbox-label">Auto-renew from wallet when it expires</label>
        </div>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "var(--space-4)",
          marginTop: "var(--space-4)",
        }}
      >
        {(sub.plans || []).map((b) => (
          <div
            key={b.code}
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              boxShadow: "var(--shadow-xs)",
            }}
          >
            <div className="card-body" style={{ flex: 1 }}>
              <h3 className="h3" style={{ marginBottom: "var(--space-3)" }}>{b.name}</h3>

              <div
                style={{
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--surface-subtle)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-subtle)",
                  marginBottom: "var(--space-4)",
                }}
              >
                <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>
                  Price
                </span>
                <div
                  style={{
                    fontSize: "var(--fs-xl)",
                    fontWeight: "var(--fw-bold)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {kes(b.price)}{" "}
                  <span style={{ fontSize: "var(--fs-xs)", fontWeight: "normal", color: "var(--text-tertiary)" }}>
                    for {b.validity_days} day{b.validity_days === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div style={{ ...LABEL_STYLE, marginBottom: "var(--space-2)" }}>
                Features ({(b.features || []).length})
              </div>
              <ul
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                  padding: 0,
                  margin: 0,
                  listStyle: "none",
                }}
              >
                {(b.features || []).map((x) => (
                  <li key={x} className="flex items-start gap-2" style={{ fontSize: "var(--fs-sm)" }}>
                    <i
                      className="bi bi-check-circle-fill"
                      style={{ color: "var(--primary-500)", fontSize: 14, marginTop: 2, flexShrink: 0 }}
                    ></i>
                    <span style={{ color: "var(--text-secondary)" }}>{x}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card-footer" style={{ flexShrink: 0, gap: "var(--space-2)" }}>
              <select
                className="select"
                aria-label="Quantity"
                style={{ width: "auto", height: 32, fontSize: "var(--fs-xs)" }}
                value={qty[b.code] || 1}
                onChange={(e) => setQty((p) => ({ ...p, [b.code]: Number(e.target.value) }))}
              >
                {[1, 2, 3, 6, 12].map((n) => <option key={n} value={n}>×{n}</option>)}
              </select>
              <button
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
                disabled={!!buying}
                onClick={() => buy(b)}
              >
                {buying === b.code ? "Buying…" : `Buy ${kes(Number(b.price) * (qty[b.code] || 1))}`}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Ledger ---- */}
      <div className="table-wrap" style={{ marginTop: "var(--space-6)" }}>
        <div className="table-toolbar">
          <h5 className="card-title">Recent wallet activity</h5>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Note</th>
                <th className="text-right">Amount</th><th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {wallet.transactions.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-faint" style={{ padding: "var(--space-8) var(--space-4)" }}>
                    No activity yet.
                  </td>
                </tr>
              )}
              {wallet.transactions.map((t, i) => (
                <tr key={i}>
                  <td className="cell-muted">{when(t.created_at)}</td>
                  <td><span className="badge badge-neutral">{t.kind}</span></td>
                  <td>{t.note}</td>
                  <td className={`cell-numeric ${Number(t.amount) < 0 ? "text-danger" : "text-success"}`}>{kes(t.amount)}</td>
                  <td className="cell-numeric">{kes(t.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}