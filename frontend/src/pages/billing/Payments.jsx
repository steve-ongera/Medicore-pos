// src/pages/billing/Payments.jsx
// Restyled to match the compact Dashboard: same metric cards, 8px radius cards/tables,
// design-system buttons, inputs, badges and data-table. Data and behaviour are unchanged.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "../../context/ToastContext";
import {
  DateRange, METHOD_LABEL, Modal, downloadCSV, isoDate, useFetch,
} from "../../components/PageKit";
import { addOTCSalePayment, getOTCSales, getPaymentsSummary } from "../../services/api";
import { formatCurrency, formatDateTime } from "../../utils/formatters";

// Same compact card styling as the Dashboard (scoped to .pay-compact)
const PAGE_CSS = `
  .dm-card{background:var(--surface,#fff);border:1px solid #e6ebf1;border-radius:8px;padding:12px 14px;box-shadow:0 1px 2px rgba(15,23,42,.04);display:flex;flex-direction:column;gap:8px;transition:border-color .15s,box-shadow .15s}
  .dm-card:hover{border-color:#d3dbe5;box-shadow:0 3px 10px rgba(15,23,42,.06)}
  .dm-card__top{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .dm-card__label{font-size:.78rem;font-weight:500;color:#64748b;line-height:1.25}
  .dm-card__icon{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;font-size:.95rem;flex:none}
  .dm-card__num{font-size:1.5rem;font-weight:700;line-height:1;letter-spacing:-.02em;color:#0f172a;font-variant-numeric:tabular-nums}
  .dm-card__sub{font-size:.74rem;color:#64748b;line-height:1.3;padding-top:8px;border-top:1px solid #eef2f6}
  .dm-card--primary .dm-card__icon{background:#eaf1ff;color:#2f5fd0}
  .dm-card--success .dm-card__icon{background:#e7f6ee;color:#157a4b}
  .dm-card--warning .dm-card__icon{background:#fdf1dd;color:#b26a00}
  .dm-card--danger .dm-card__icon{background:#fdecec;color:#b42318}
  .dm-card--info .dm-card__icon{background:#e6f5f8;color:#0e7490}
  .dm-card--secondary .dm-card__icon{background:#eef1f5;color:#52607a}

  .pay-compact .stat-grid{grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:var(--space-3);padding-bottom:var(--space-2)}
  .pay-compact .table-wrap{border-radius:8px}
  .pay-compact .table-toolbar{padding:var(--space-3) var(--space-4)}
  .pay-compact .data-table thead th{padding:var(--space-2) var(--space-3)}
  .pay-compact .data-table tbody td{padding:var(--space-2) var(--space-3)}
  .pay-compact .pay-filters{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
  .pay-compact .pay-filters .input{width:260px;height:36px}
  .pay-compact .pay-filters .select{width:160px;height:36px}
  .pay-compact .pay-filters .btn,
  .pay-compact .page-header__actions .btn{height:36px}
  @media (max-width:640px){
    .pay-compact .pay-filters .input,
    .pay-compact .pay-filters .select{width:100%}
  }
`;

function MetricCard({ icon, variant = "primary", label, value, sub }) {
  return (
    <div className={`dm-card dm-card--${variant}`}>
      <div className="dm-card__top">
        <span className="dm-card__label">{label}</span>
        <span className="dm-card__icon"><i className={`bi ${icon}`} /></span>
      </div>
      <div className="dm-card__num">{value}</div>
      {sub && <div className="dm-card__sub">{sub}</div>}
    </div>
  );
}

export default function Payments() {
  const [params, setParams] = useSearchParams();
  const today = isoDate(new Date());
  const [range, setRange] = useState({ from: today, to: today });
  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const [unpaid, setUnpaid] = useState(params.get("unpaid") === "1");
  const [selected, setSelected] = useState(null);

  const q = { date_from: range.from, date_to: range.to, payment_method: method, search, unpaid: unpaid ? 1 : "" };
  const sales = useFetch(() => getOTCSales(q), [range.from, range.to, method, search, unpaid]);
  const summary = useFetch(() => getPaymentsSummary({ date_from: range.from, date_to: range.to }), [range.from, range.to]);

  const refresh = () => { sales.reload(); summary.reload(); };
  const rows = sales.data || [];
  const s = summary.data;

  const exportCsv = () =>
    downloadCSV(`payments_${range.from}_${range.to}.csv`, rows.map((r) => ({
      sale_number: r.sale_number, date: r.sold_at, customer: r.customer_name, method: r.payment_method,
      reference: r.reference_number, total: r.total_amount, paid: r.amount_paid, balance: r.balance, served_by: r.served_by_name,
    })));

  return (
    <div className="pay-compact">
      <style>{PAGE_CSS}</style>

      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Billing</div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Money taken at the counter, by method, and balances still owed.</p>
        </div>
        <div className="page-header__actions">
          <DateRange from={range.from} to={range.to} onChange={setRange} />
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!rows.length}>
            <i className="bi bi-download" aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      {/* ==================== KEY METRICS ==================== */}
      {s && (
        <div className="stat-grid mb-5">
          <MetricCard icon="bi-cash-stack" variant="primary" label="Billed"
            value={formatCurrency(s.billed)} sub={`${s.sales} sale(s)`} />
          <MetricCard icon="bi-check2-circle" variant="success" label="Collected"
            value={formatCurrency(s.collected)} sub="received in this period" />
          <MetricCard icon="bi-cash-coin" variant="warning" label="Outstanding"
            value={formatCurrency(s.outstanding)} sub="still owed by customers" />
          {s.by_method.map((m) => (
            <MetricCard key={m.method} icon="bi-wallet2" variant="info"
              label={METHOD_LABEL[m.method] || m.method}
              value={formatCurrency(m.total)} sub={`${m.count} sale(s)`} />
          ))}
        </div>
      )}

      {/* ==================== TRANSACTIONS ==================== */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <h5 className="card-title">Transactions</h5>
          <div className="pay-filters">
            <input className="input" placeholder="Search sale no., customer, reference…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
              <option value="">All methods</option>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="checkbox-row">
              <input type="checkbox" className="checkbox" checked={unpaid}
                onChange={(e) => { setUnpaid(e.target.checked); setParams({}); }} />
              <span className="checkbox-label">Unpaid only</span>
            </label>
          </div>
        </div>

        {sales.loading && !sales.data ? (
          <div className="loading-screen">
            <div className="spinner spinner-lg" />
            <span className="loading-screen__label">Loading payments…</span>
          </div>
        ) : sales.error ? (
          <div className="alert alert-danger" role="alert" style={{ margin: 16 }}>
            <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
            <div className="alert-message">{sales.error}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center text-tertiary py-6">No payments found for these filters.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sale</th><th>Time</th><th>Customer</th><th>Method</th><th>Reference</th>
                  <th className="text-right">Total</th><th className="text-right">Paid</th>
                  <th className="text-right">Balance</th><th>Served by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="is-clickable" onClick={() => setSelected(r)}>
                    <td className="cell-mono">{r.sale_number}</td>
                    <td className="cell-muted">{formatDateTime(r.sold_at)}</td>
                    <td className="cell-primary">{r.customer_name || "Walk-in"}</td>
                    <td>{METHOD_LABEL[r.payment_method] || r.payment_method}</td>
                    <td className="cell-mono">{r.reference_number || "-"}</td>
                    <td className="cell-numeric">{formatCurrency(r.total_amount)}</td>
                    <td className="cell-numeric">{formatCurrency(r.amount_paid)}</td>
                    <td className="cell-numeric">
                      {Number(r.balance) > 0
                        ? <span className="badge badge-warning">{formatCurrency(r.balance)}</span>
                        : <span className="badge badge-success">Paid</span>}
                    </td>
                    <td>{r.served_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <SaleModal sale={selected} onClose={() => setSelected(null)}
          onPaid={() => { setSelected(null); refresh(); }} />
      )}
    </div>
  );
}

function SaleModal({ sale, onClose, onPaid }) {
  const owed = Number(sale.balance);
  const [amount, setAmount] = useState(owed > 0 ? String(owed) : "");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const collect = async () => {
    setBusy(true);
    try {
      await addOTCSalePayment(sale.id, { amount, reference_number: reference });
      toast.success(`Payment of ${formatCurrency(amount)} recorded`);
      onPaid();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title={`Sale ${sale.sale_number}`} onClose={onClose}
      footer={owed > 0 ? (
        <button className={`btn btn-primary${busy ? " is-loading" : ""}`} disabled={busy || !Number(amount)} onClick={collect}>
          <i className="bi bi-check2" aria-hidden="true" /> {busy ? "Saving…" : "Record payment"}
        </button>
      ) : <button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <p className="text-sm text-muted mb-3">
        {formatDateTime(sale.sold_at)} · {sale.customer_name || "Walk-in"} · {METHOD_LABEL[sale.payment_method]}
      </p>

      <div className="table-wrap" style={{ borderRadius: 8 }}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th><th className="text-right">Qty</th>
                <th className="text-right">Price</th><th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <td className="cell-primary">{i.medicine_name}</td>
                  <td className="cell-numeric">{i.quantity}</td>
                  <td className="cell-numeric">{formatCurrency(i.unit_price)}</td>
                  <td className="cell-numeric">{formatCurrency(i.subtotal)}</td>
                </tr>
              ))}
              {Number(sale.discount) > 0 && (
                <tr><td colSpan={3}>Discount</td><td className="cell-numeric">- {formatCurrency(sale.discount)}</td></tr>
              )}
              <tr>
                <td colSpan={3}><strong>Total</strong></td>
                <td className="cell-numeric"><strong>{formatCurrency(sale.total_amount)}</strong></td>
              </tr>
              <tr><td colSpan={3}>Paid</td><td className="cell-numeric">{formatCurrency(sale.amount_paid)}</td></tr>
              <tr>
                <td colSpan={3}>{owed < 0 ? "Change given" : "Balance"}</td>
                <td className="cell-numeric">{formatCurrency(Math.abs(owed))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {owed > 0 && (
        <div className="field-row mt-4">
          <div className="field">
            <label className="field-label">Amount received</label>
            <input className="input" type="number" min="0" max={owed} value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Reference (M-Pesa code, optional)</label>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
      )}
    </Modal>
  );
}