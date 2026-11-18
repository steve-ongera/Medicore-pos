// src/components/PageKit.jsx
// Small shared building blocks for the POS pages. Styled by styles/pos.css, which
// reads your HMIS CSS variables (with fallbacks) so it picks up your theme.
// Modal now uses the global main.css modal classes so it matches the rest of the app.
import { useCallback, useEffect, useState } from "react";

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="pos-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="pos-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, flush }) {
  return (
    <section className="pos-card">
      {(title || actions) && (
        <header className="pos-card-head">
          <h3>{title}</h3>
          {actions && <div className="pos-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "pos-card-body"}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, tone = "default" }) {
  return (
    <div className={`pos-stat pos-stat-${tone}`}>
      <span className="pos-stat-label">{label}</span>
      <strong className="pos-stat-value">{value}</strong>
      {hint && <span className="pos-stat-hint">{hint}</span>}
    </div>
  );
}

export function Badge({ tone = "default", children }) {
  return <span className={`pos-badge pos-badge-${tone}`}>{children}</span>;
}

export function Empty({ children = "Nothing to show." }) {
  return <div className="pos-empty">{children}</div>;
}

export function Spinner() {
  return <div className="pos-loading">Loading…</div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="pos-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key}
          className={value === t.key ? "active" : ""} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <span className="pos-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Modal — styled with the global main.css classes (modal-overlay / modal / modal-header / modal-body / modal-footer).
// `wide` -> modal-lg (720px). Default is 520px. Escape or a click on the backdrop closes it.
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal${wide ? " modal-lg" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
      >
        <div className="modal-header">
          <h4 className="modal-title">{title}</h4>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        {/* inline padding because main.css zeroes .modal-lg .modal-body for the video modal */}
        <div className="modal-body" style={{ padding: "var(--space-5)" }}>{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="pos-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

// Loads data on mount and whenever `deps` change. Returns { data, loading, error, reload }.
export function useFetch(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    fn()
      .then((data) => live && setState({ data, loading: false, error: "" }))
      .catch((e) => live && setState({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
  }, deps);
  useEffect(() => run(), [run]);
  return { ...state, reload: run };
}

// ---- date helpers ----------------------------------------------------------
export const isoDate = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};
export const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
};

export function DateRange({ from, to, onChange, presets = true }) {
  const set = (f, t) => onChange({ from: f, to: t });
  return (
    <div className="pos-daterange">
      {presets && (
        <>
          <button className="pos-btn pos-btn-sm" onClick={() => set(isoDate(new Date()), isoDate(new Date()))}>Today</button>
          <button className="pos-btn pos-btn-sm" onClick={() => set(daysAgo(6), isoDate(new Date()))}>7 days</button>
          <button className="pos-btn pos-btn-sm" onClick={() => set(daysAgo(29), isoDate(new Date()))}>30 days</button>
        </>
      )}
      <input type="date" value={from} max={to} onChange={(e) => set(e.target.value, to)} />
      <span>to</span>
      <input type="date" value={to} min={from} onChange={(e) => set(from, e.target.value)} />
    </div>
  );
}

// ---- export ----------------------------------------------------------------
export function downloadCSV(filename, rows) {
  if (!rows?.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const METHOD_LABEL = { CASH: "Cash", MPESA: "M-Pesa", CARD: "Card" };
export const fullName = (u) => (u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username : "");