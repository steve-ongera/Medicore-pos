// src/pages/support/Subscriptions.jsx
// ONE page for plan, bundles and billing. Replaces the separate Wallet page.
//
// The owner picks a bundle and pays for it with M-Pesa in a single step: the STK prompt is for the
// bundle price, and the server activates the bundle as soon as Safaricom confirms the payment.
// No separate "top up first, then buy" step. If old wallet credit exists and covers the price,
// "Use wallet balance" is offered as a second way to pay.
import { useEffect, useRef, useState } from "react";
import { Field, Modal, useFetch } from "../../components/PageKit";
import { toast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext.jsx";
import { buyBundle, getPaymentStatus, getSubscription, getWallet, payForBundle } from "../../services/api";
import { formatCurrency, formatDateTime } from "../../utils/formatters";
import { ROLES } from "../../utils/roles";

const LABEL_STYLE = {
  fontSize: "var(--fs-2xs)",
  fontWeight: "var(--fw-semibold)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  marginBottom: "var(--space-1)",
};

const VALUE_STYLE = {
  fontSize: "var(--fs-lg)",
  fontFamily: "var(--font-mono)",
  color: "var(--text-primary)",
};

const KIND_LABEL = { TOPUP: "M-Pesa payment", BUNDLE: "Bundle", REFUND: "Refund", ADJUSTMENT: "Adjustment" };

const unlimited = (v) => (v === null || v === undefined ? "Unlimited" : Number(v).toLocaleString());

export default function Subscriptions() {
  const { user } = useAuth();
  const isOwner = user.role === ROLES.SUPER_ADMIN;
  const [picked, setPicked] = useState(null);

  const { data, loading, error, reload } = useFetch(async () => {
    const [sub, wallet] = await Promise.all([getSubscription(), isOwner ? getWallet() : Promise.resolve(null)]);
    return { sub, wallet };
  }, []);

  if (loading && !data) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <span className="loading-screen__label">Loading subscription…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
        <div className="alert-message">{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const { sub, wallet } = data;
  const limits = sub.limits || {};
  const balance = Number(wallet?.balance || 0);
  const outOfSales = sub.is_active && sub.sales_remaining !== null && sub.sales_remaining <= 0;
  const warn = !sub.is_active || outOfSales || sub.days_left <= 7;

  let warnText = "";
  if (!sub.is_active) warnText = "Your bundle has expired. Selling is paused until you buy a bundle.";
  else if (outOfSales) warnText = "You have used all your sales credits. Buy a bundle to continue selling.";
  else if (warn) warnText = `Your bundle ends on ${formatDateTime(sub.expires_at)}. Renew below to avoid interruption.`;

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Licensing &amp; Service</div>
          <h1 className="page-title">Subscription</h1>
          <p className="page-subtitle">Your bundle, and a one-step way to renew it with M-Pesa.</p>
        </div>
      </div>

      {/* Current plan */}
      <div className="card" style={{ marginTop: "var(--space-4)" }}>
        <div className="card-body">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <div className="stat-card__icon tone-info" style={{ width: 40, height: 40 }}>
              <i className="bi bi-shield-check" style={{ fontSize: 20 }}></i>
            </div>
            <h4 className="h4" style={{ margin: 0 }}>Current plan</h4>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "var(--space-3)",
              padding: "var(--space-3)",
              background: "var(--surface-sunken)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div>
              <div style={LABEL_STYLE}>Plan</div>
              <strong style={{ fontSize: "var(--fs-lg)", color: "var(--text-primary)" }}>{sub.plan_label}</strong>
            </div>
            <div>
              <div style={LABEL_STYLE}>Status</div>
              {sub.is_active
                ? <span className={`badge ${warn ? "badge-warning" : "badge-success"}`}>Active</span>
                : <span className="badge badge-danger">Expired</span>}
            </div>
            {sub.is_active && (
              <>
                <div>
                  <div style={LABEL_STYLE}>Expires</div>
                  <strong style={{ ...VALUE_STYLE, fontSize: "var(--fs-sm)" }}>{formatDateTime(sub.expires_at)}</strong>
                </div>
                <div>
                  <div style={LABEL_STYLE}>Days left</div>
                  <strong style={VALUE_STYLE}>{sub.days_left}</strong>
                </div>
              </>
            )}
            <div>
              <div style={LABEL_STYLE}>Sales left</div>
              <strong style={VALUE_STYLE}>{sub.sales_remaining === null ? "Unlimited" : sub.sales_remaining}</strong>
            </div>
            <div>
              <div style={LABEL_STYLE}>Staff accounts</div>
              <strong style={VALUE_STYLE}>{unlimited(limits.max_users)}</strong>
            </div>
            <div>
              <div style={LABEL_STYLE}>Medicines</div>
              <strong style={VALUE_STYLE}>{unlimited(limits.max_products)}</strong>
            </div>
            {isOwner && balance > 0 && (
              <div>
                <div style={LABEL_STYLE}>Wallet credit</div>
                <strong style={VALUE_STYLE}>{formatCurrency(balance)}</strong>
              </div>
            )}
          </div>

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
                  {b.name}: {b.sales_remaining === null ? "unlimited" : `${b.sales_remaining} sales`} · until {formatDateTime(b.expires_at)}
                </li>
              ))}
            </ul>
          )}

          {warn && (
            <div
              className={`alert ${sub.is_active ? "alert-warning" : "alert-danger"}`}
              role="alert"
              style={{ marginTop: "var(--space-4)", marginBottom: 0 }}
            >
              <i className="bi bi-exclamation-triangle alert-icon" aria-hidden="true" />
              <div className="alert-message">{warnText}</div>
            </div>
          )}
        </div>
      </div>

      {/* Bundles */}
      <h4 className="h4" style={{ marginTop: "var(--space-6)" }}>Choose a bundle</h4>
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "var(--space-4)",
          marginTop: "var(--space-3)",
        }}
      >
        {sub.plans.map((p) => {
          const isCurrent = sub.plan === p.code && sub.is_active;
          return (
            <div
              key={p.code}
              className={`card ${isCurrent ? "card-featured" : ""}`}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                borderColor: isCurrent ? "var(--primary-500)" : "var(--border-subtle)",
                boxShadow: isCurrent ? "var(--shadow-lg)" : "var(--shadow-xs)",
                transition:
                  "transform var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
              }}
            >
              {isCurrent && (
                <div
                  style={{
                    position: "absolute",
                    top: "-12px",
                    right: "var(--space-4)",
                    background: "var(--primary-600)",
                    color: "var(--text-inverse)",
                    padding: "var(--space-1) var(--space-3)",
                    borderRadius: "var(--radius-full)",
                    fontSize: "var(--fs-2xs)",
                    fontWeight: "var(--fw-semibold)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  <i className="bi bi-star-fill" style={{ marginRight: "var(--space-1)" }}></i>
                  Current
                </div>
              )}

              <div className="card-body" style={{ flex: 1 }}>
                <h3 className="h3" style={{ marginBottom: "var(--space-3)" }}>{p.name}</h3>

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
                    {formatCurrency(Number(p.price))}{" "}
                    <span style={{ fontSize: "var(--fs-xs)", fontWeight: "normal", color: "var(--text-tertiary)" }}>
                      for {p.validity_days} day{p.validity_days === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div style={{ ...LABEL_STYLE, marginBottom: "var(--space-2)" }}>
                  Features ({p.features.length})
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
                  {p.features.map((x) => (
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

              <div className="card-footer" style={{ flexShrink: 0, flexDirection: "column", gap: "var(--space-2)" }}>
                {isOwner ? (
                  <button
                    className={`btn ${isCurrent ? "btn-primary" : "btn-secondary"} btn-block`}
                    onClick={() => setPicked(p)}
                  >
                    <i className="bi bi-phone" aria-hidden="true"></i>
                    {isCurrent ? "Renew with M-Pesa" : "Pay with M-Pesa"}
                  </button>
                ) : (
                  <small className="text-sm text-muted">Ask the shop owner to renew.</small>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Billing history (owner only) */}
      {isOwner && wallet && (
        <div className="table-wrap" style={{ marginTop: "var(--space-6)" }}>
          <div className="table-toolbar">
            <h5 className="card-title">Billing history</h5>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Note</th><th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {wallet.transactions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-faint" style={{ padding: "var(--space-8) var(--space-4)" }}>
                      No payments yet.
                    </td>
                  </tr>
                )}
                {wallet.transactions.map((t, i) => (
                  <tr key={i}>
                    <td className="cell-muted">{formatDateTime(t.created_at)}</td>
                    <td><span className="badge badge-neutral">{KIND_LABEL[t.kind] || t.kind}</span></td>
                    <td>{t.note}</td>
                    <td className={`cell-numeric ${Number(t.amount) < 0 ? "text-danger" : "text-success"}`}>
                      {formatCurrency(Number(t.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {picked && (
        <PayModal
          plan={picked}
          balance={balance}
          onClose={() => setPicked(null)}
          onDone={() => { setPicked(null); reload(); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One-step payment: M-Pesa prompt for the bundle price -> server activates the bundle.
// ---------------------------------------------------------------------------
function PayModal({ plan, balance, onClose, onDone }) {
  const [qty, setQty] = useState(1);
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState("form"); // "form" | "waiting"
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const total = Number(plan.price) * qty;
  const days = plan.validity_days * qty;
  const canUseBalance = balance >= total;

  const payMpesa = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await payForBundle({ phone, bundle: plan.code, quantity: qty });
      setStage("waiting");
      // Safaricom calls our server back; the server then activates the bundle. Check every 3s for ~2 minutes.
      let tries = 0;
      clearInterval(timer.current);
      timer.current = setInterval(async () => {
        tries += 1;
        try {
          const s = await getPaymentStatus(r.checkout_request_id);
          if (s.status === "SUCCESS") {
            clearInterval(timer.current);
            toast.success(`${plan.name} activated.`);
            onDone();
            return;
          }
          if (s.status === "FAILED" || s.status === "MISMATCH") {
            clearInterval(timer.current);
            setStage("form");
            setNote(
              s.status === "FAILED"
                ? "The payment was cancelled or failed. Please try again."
                : "The amount paid did not match the price. Please contact support with your M-Pesa message."
            );
            return;
          }
        } catch { /* keep polling */ }
        if (tries >= 40) {
          clearInterval(timer.current);
          setStage("form");
          setNote("Still waiting for M-Pesa. If you paid, your bundle will activate shortly. Refresh this page in a minute.");
        }
      }, 3000);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const payBalance = async () => {
    setBusy(true);
    try {
      const r = await buyBundle({ bundle: plan.code, quantity: qty });
      toast.success(r.detail);
      onDone();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const footer =
    stage === "waiting" ? (
      <button className="btn btn-primary" disabled>Waiting for payment…</button>
    ) : (
      <>
        {canUseBalance && (
          <button className="btn btn-secondary" disabled={busy} onClick={payBalance}>
            Use wallet balance ({formatCurrency(balance)})
          </button>
        )}
        <button className="btn btn-primary" disabled={busy || !phone.trim()} onClick={payMpesa}>
          {busy ? "Sending…" : `Pay ${formatCurrency(total)} with M-Pesa`}
        </button>
      </>
    );

  return (
    <Modal title={`${plan.name} bundle`} onClose={onClose} footer={footer}>
      {stage === "waiting" ? (
        <div style={{ textAlign: "center", padding: "var(--space-6) var(--space-2)" }}>
          <div className="spinner spinner-lg" style={{ margin: "0 auto var(--space-4)" }} />
          <h4 className="h4" style={{ marginBottom: "var(--space-2)" }}>Check your phone</h4>
          <p className="text-sm text-muted">
            Enter your M-Pesa PIN to pay {formatCurrency(total)}. Your bundle activates automatically as soon as the
            payment is confirmed.
          </p>
        </div>
      ) : (
        <div className="pos-form">
          {note && (
            <div className="alert alert-warning" role="alert" style={{ marginBottom: "var(--space-4)" }}>
              <i className="bi bi-exclamation-triangle alert-icon" aria-hidden="true" />
              <div className="alert-message">{note}</div>
            </div>
          )}
          <Field label="Quantity" hint={`Valid for ${days} day${days === 1 ? "" : "s"}.`}>
            <select value={qty} onChange={(e) => setQty(Number(e.target.value))}>
              {[1, 2, 3, 6, 12].map((n) => (
                <option key={n} value={n}>
                  ×{n} ({plan.validity_days * n} day{plan.validity_days * n === 1 ? "" : "s"})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount to pay"><input value={formatCurrency(total)} readOnly /></Field>
          <Field label="M-Pesa number" hint="We will send the payment prompt to this number.">
            <input
              value={phone}
              placeholder="0712345678"
              inputMode="tel"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}