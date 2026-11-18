// src/pages/inventory/Inventory.jsx
// Restyled to match the compact Dashboard / Payments: same metric cards, 8px radius,
// design-system buttons, inputs, badges, tabs and data-table. Data and behaviour unchanged.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext.jsx";
import { Badge, Modal, Tabs, downloadCSV, useFetch } from "../../components/PageKit";
import {
  createMedicineBatch, getExpiringBatches, getMedicineBatches, getStockTransactions,
  getSuppliers, quickAddMedicine, searchMedicines, setMedicineStock, updateMedicine,
} from "../../services/api";
import { canEditMedicines } from "../../utils/roles";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/formatters";

// Same compact card styling as the Dashboard (scoped to .inv-compact)
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

  .inv-compact .stat-grid{grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:var(--space-3);padding-bottom:var(--space-2)}
  .inv-compact .table-wrap{border-radius:8px}
  .inv-compact .table-toolbar{padding:var(--space-3) var(--space-4)}
  .inv-compact .data-table thead th{padding:var(--space-2) var(--space-3)}
  .inv-compact .data-table tbody td{padding:var(--space-2) var(--space-3)}
  .inv-compact .inv-filters{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
  .inv-compact .inv-filters .input{width:280px;height:36px}
  .inv-compact .inv-filters .select{width:170px;height:36px}
  .inv-compact .inv-filters .btn,
  .inv-compact .page-header__actions .btn{height:36px}
  .inv-compact .inv-tabs{margin-bottom:var(--space-4)}
  .inv-compact .cell-sub{font-size:var(--fs-xs);color:var(--text-tertiary);font-weight:400}
  @media (max-width:640px){
    .inv-compact .inv-filters .input,
    .inv-compact .inv-filters .select{width:100%}
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

// Design-system form field (label + control + optional hint)
function FormField({ label, hint, className = "", children }) {
  return (
    <div className={`field ${className}`} style={{ marginBottom: 0 }}>
      <label className="field-label">{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

const LoadingBlock = ({ label = "Loading…" }) => (
  <div className="loading-screen">
    <div className="spinner spinner-lg" />
    <span className="loading-screen__label">{label}</span>
  </div>
);

const ErrorBlock = ({ children }) => (
  <div className="alert alert-danger" role="alert" style={{ margin: 16 }}>
    <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
    <div className="alert-message">{children}</div>
  </div>
);

const EmptyBlock = ({ children }) => <div className="text-center text-tertiary py-6">{children}</div>;

export default function Inventory() {
  const { user } = useAuth();
  const canEdit = canEditMedicines(user?.role);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "all";
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // {type, medicine?}

  const meds = useFetch(() => searchMedicines("", { includeHidden: canEdit }), [canEdit]);
  const expiring = useFetch(() => getExpiringBatches(90), []);
  const all = meds.data || [];
  const low = all.filter((m) => m.is_visible && m.is_low_stock);
  const totalValue = all.reduce((s, m) => s + Number(m.unit_price) * m.current_stock, 0);

  const shown = useMemo(() => {
    const base = tab === "low" ? low : all;
    const q = search.trim().toLowerCase();
    return q ? base.filter((m) => `${m.name} ${m.generic_name} ${m.category}`.toLowerCase().includes(q)) : base;
  }, [all, low, tab, search]);

  const done = () => { setModal(null); meds.reload(); expiring.reload(); };

  return (
    <div className="inv-compact">
      <style>{PAGE_CSS}</style>

      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Pharmacy</div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">Stock on hand, batches, expiry and every stock movement.</p>
        </div>
        {canEdit && (
          <div className="page-header__actions">
            <button className="btn btn-secondary" onClick={() => setModal({ type: "receive" })}>
              <i className="bi bi-box-arrow-in-down" aria-hidden="true" /> Receive stock
            </button>
            <button className="btn btn-primary" onClick={() => setModal({ type: "add" })}>
              <i className="bi bi-plus-lg" aria-hidden="true" /> Add medicine
            </button>
          </div>
        )}
      </div>

      {/* ==================== KEY METRICS ==================== */}
      <div className="stat-grid mb-5">
        <MetricCard icon="bi-box-seam" variant="primary" label="Products"
          value={all.length} sub="medicines in catalogue" />
        <MetricCard icon="bi-cash-stack" variant="success" label="Stock value"
          value={formatCurrency(totalValue)} sub="at selling price" />
        <MetricCard icon="bi-exclamation-triangle" variant="danger" label="Low / out of stock"
          value={low.length} sub="at or below reorder level" />
        <MetricCard icon="bi-hourglass-split" variant="warning" label="Expiring soon"
          value={expiring.data?.length ?? "…"} sub="batches within 90 days" />
      </div>

      <div className="inv-tabs">
        <Tabs value={tab} onChange={(k) => setParams({ tab: k })} tabs={[
          { key: "all", label: "All medicines", count: all.length },
          { key: "low", label: "Low stock", count: low.length },
          { key: "expiring", label: "Expiring", count: expiring.data?.length },
          { key: "batches", label: "Batches" },
          ...(canEdit ? [{ key: "ledger", label: "Stock ledger" }] : []),
        ]} />
      </div>

      {(tab === "all" || tab === "low") && (
        <div className="table-wrap">
          <div className="table-toolbar">
            <h5 className="card-title">{tab === "low" ? "Low Stock" : "All Medicines"}</h5>
            <div className="inv-filters">
              <input className="input" placeholder="Search medicine, generic name, category…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
              <button className="btn btn-secondary" onClick={() => downloadCSV("inventory.csv", shown.map((m) => ({
                name: m.name, generic: m.generic_name, category: m.category, unit: m.unit,
                price: m.unit_price, stock: m.current_stock, reorder_level: m.reorder_level })))}>
                <i className="bi bi-download" aria-hidden="true" /> Export CSV
              </button>
            </div>
          </div>

          {meds.loading && !meds.data ? <LoadingBlock label="Loading inventory…" />
            : meds.error ? <ErrorBlock>{meds.error}</ErrorBlock>
            : shown.length === 0 ? <EmptyBlock>No medicines found.</EmptyBlock> : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Medicine</th><th>Category</th><th>Unit</th><th className="text-right">Price</th>
                      <th className="text-right">In stock</th><th className="text-right">Reorder at</th>
                      <th>Status</th>{canEdit && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((m) => (
                      <tr key={m.id} style={m.is_visible ? undefined : { opacity: 0.55 }}>
                        <td className="cell-primary">
                          {m.name}
                          {m.generic_name && <div className="cell-sub">{m.generic_name}</div>}
                        </td>
                        <td>{m.category || "-"}</td>
                        <td>{m.unit}</td>
                        <td className="cell-numeric">{formatCurrency(m.unit_price)}</td>
                        <td className="cell-numeric">{m.current_stock}</td>
                        <td className="cell-numeric">{m.reorder_level}</td>
                        <td>
                          {!m.is_visible ? <Badge>Hidden</Badge>
                            : m.current_stock === 0 ? <Badge tone="danger">Out of stock</Badge>
                            : m.is_low_stock ? <Badge tone="warning">Low</Badge>
                            : <Badge tone="success">OK</Badge>}
                        </td>
                        {canEdit && (
                          <td className="cell-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => setModal({ type: "edit", medicine: m })}>Edit</button>{" "}
                            <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: "stock", medicine: m })}>Set stock</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {tab === "expiring" && <ExpiringTab q={expiring} />}
      {tab === "batches" && <BatchesTab />}
      {tab === "ledger" && canEdit && <LedgerTab />}

      {modal?.type === "add" && <AddMedicineModal onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "edit" && <EditMedicineModal medicine={modal.medicine} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "stock" && <SetStockModal medicine={modal.medicine} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "receive" && <ReceiveModal medicines={all} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

// ── tabs ─────────────────────────────────────────────────────────────────────
function expiryBadge(date) {
  const days = Math.ceil((new Date(date) - new Date()) / 86400000);
  if (days < 0) return <Badge tone="danger">Expired {-days}d ago</Badge>;
  if (days <= 30) return <Badge tone="danger">{days}d left</Badge>;
  if (days <= 90) return <Badge tone="warning">{days}d left</Badge>;
  return <Badge tone="success">{days}d left</Badge>;
}

function BatchTable({ rows }) {
  if (!rows?.length) return <EmptyBlock>No batches to show.</EmptyBlock>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Medicine</th><th>Batch</th><th>Supplier</th><th className="text-right">Received</th>
            <th className="text-right">Remaining</th><th>Expiry</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td className="cell-primary">{b.medicine_name}</td>
              <td className="cell-mono">{b.batch_number}</td>
              <td>{b.supplier_name || "-"}</td>
              <td className="cell-numeric">{b.quantity_received}</td>
              <td className="cell-numeric">{b.quantity_remaining}</td>
              <td className="cell-muted">{formatDate(b.expiry_date)}</td>
              <td>{b.quantity_remaining > 0 ? expiryBadge(b.expiry_date) : <Badge>Empty</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ExpiringTab = ({ q }) => (
  <div className="table-wrap">
    <div className="table-toolbar"><h5 className="card-title">Expiring Batches</h5></div>
    {q.loading ? <LoadingBlock /> : <BatchTable rows={q.data} />}
  </div>
);

function BatchesTab() {
  const q = useFetch(() => getMedicineBatches(), []);
  return (
    <div className="table-wrap">
      <div className="table-toolbar"><h5 className="card-title">All Batches</h5></div>
      {q.loading ? <LoadingBlock /> : <BatchTable rows={q.data} />}
    </div>
  );
}

function LedgerTab() {
  const [type, setType] = useState("");
  const q = useFetch(() => getStockTransactions({ transaction_type: type }), [type]);
  const tone = { STOCK_IN: "success", STOCK_OUT: "info", ADJUSTMENT: "warning", EXPIRED: "danger" };
  return (
    <div className="table-wrap">
      <div className="table-toolbar">
        <h5 className="card-title">Stock Ledger</h5>
        <div className="inv-filters">
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Movement type">
            <option value="">All movements</option>
            <option value="STOCK_IN">Stock in</option><option value="STOCK_OUT">Stock out</option>
            <option value="ADJUSTMENT">Adjustments</option><option value="EXPIRED">Expired</option>
          </select>
        </div>
      </div>
      {q.loading ? <LoadingBlock /> : !q.data?.length ? <EmptyBlock>No movements yet.</EmptyBlock> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th><th>Medicine</th><th>Batch</th><th>Type</th>
                <th className="text-right">Qty</th><th>Reason</th><th>By</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((t) => (
                <tr key={t.id}>
                  <td className="cell-muted">{formatDateTime(t.created_at)}</td>
                  <td className="cell-primary">{t.medicine_name}</td>
                  <td className="cell-mono">{t.batch_number || "-"}</td>
                  <td><Badge tone={tone[t.transaction_type]}>{t.transaction_type.replace("_", " ")}</Badge></td>
                  <td className="cell-numeric">{t.quantity > 0 && t.transaction_type !== "STOCK_OUT" ? "+" : ""}{t.quantity}</td>
                  <td>{t.reason}</td>
                  <td>{t.performed_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── modals ───────────────────────────────────────────────────────────────────
function useSubmit(action, onDone, okMsg) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await action(); toast.success(okMsg(r)); onDone(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

const SubmitButton = ({ busy, disabled, onClick, children }) => (
  <button className={`btn btn-primary${busy ? " is-loading" : ""}`} disabled={disabled || busy} onClick={onClick}>
    <i className="bi bi-check2" aria-hidden="true" /> {busy ? "Saving…" : children}
  </button>
);

function AddMedicineModal({ onClose, onDone }) {
  const [f, setF] = useState({ name: "", generic_name: "", category: "", unit: "tablet", unit_price: "", reorder_level: 20, quantity: "", batch_number: "", expiry_date: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, run } = useSubmit(() => quickAddMedicine(f), onDone, (m) => `${m.name} added`);
  const ok = f.name && f.unit_price && f.quantity && f.expiry_date;
  return (
    <Modal wide title="Add medicine" onClose={onClose}
      footer={<SubmitButton busy={busy} disabled={!ok} onClick={run}>Add medicine</SubmitButton>}>
      <div className="field-row">
        <FormField label="Name *"><input className="input" value={f.name} onChange={set("name")} autoFocus /></FormField>
        <FormField label="Generic name"><input className="input" value={f.generic_name} onChange={set("generic_name")} /></FormField>
        <FormField label="Category"><input className="input" value={f.category} onChange={set("category")} /></FormField>
        <FormField label="Unit"><input className="input" value={f.unit} onChange={set("unit")} /></FormField>
        <FormField label="Selling price *"><input className="input" type="number" min="0" value={f.unit_price} onChange={set("unit_price")} /></FormField>
        <FormField label="Reorder level"><input className="input" type="number" min="0" value={f.reorder_level} onChange={set("reorder_level")} /></FormField>
        <FormField label="Opening quantity *"><input className="input" type="number" min="1" value={f.quantity} onChange={set("quantity")} /></FormField>
        <FormField label="Batch number" hint="Auto-generated if empty"><input className="input" value={f.batch_number} onChange={set("batch_number")} /></FormField>
        <FormField label="Expiry date *"><input className="input" type="date" value={f.expiry_date} onChange={set("expiry_date")} /></FormField>
      </div>
    </Modal>
  );
}

function EditMedicineModal({ medicine, onClose, onDone }) {
  const [f, setF] = useState({ name: medicine.name, generic_name: medicine.generic_name, category: medicine.category,
    unit: medicine.unit, unit_price: medicine.unit_price, reorder_level: medicine.reorder_level, is_visible: medicine.is_visible });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, run } = useSubmit(() => updateMedicine(medicine.id, f), onDone, () => "Medicine updated");
  return (
    <Modal wide title={`Edit ${medicine.name}`} onClose={onClose}
      footer={<SubmitButton busy={busy} onClick={run}>Save changes</SubmitButton>}>
      <div className="field-row">
        <FormField label="Name"><input className="input" value={f.name} onChange={set("name")} /></FormField>
        <FormField label="Generic name"><input className="input" value={f.generic_name} onChange={set("generic_name")} /></FormField>
        <FormField label="Category"><input className="input" value={f.category} onChange={set("category")} /></FormField>
        <FormField label="Unit"><input className="input" value={f.unit} onChange={set("unit")} /></FormField>
        <FormField label="Selling price"><input className="input" type="number" min="0" value={f.unit_price} onChange={set("unit_price")} /></FormField>
        <FormField label="Reorder level"><input className="input" type="number" min="0" value={f.reorder_level} onChange={set("reorder_level")} /></FormField>
      </div>
      <label className="checkbox-row mt-4">
        <input type="checkbox" className="checkbox" checked={f.is_visible}
          onChange={(e) => setF({ ...f, is_visible: e.target.checked })} />
        <span className="checkbox-label">Show on the POS screen</span>
      </label>
    </Modal>
  );
}

function SetStockModal({ medicine, onClose, onDone }) {
  const [qty, setQty] = useState(String(medicine.current_stock));
  const [reason, setReason] = useState("Stock take");
  const { busy, run } = useSubmit(() => setMedicineStock(medicine.id, { quantity: Number(qty), reason }), onDone, () => "Stock updated");
  return (
    <Modal title={`Set stock - ${medicine.name}`} onClose={onClose}
      footer={<SubmitButton busy={busy} disabled={qty === ""} onClick={run}>Update stock</SubmitButton>}>
      <p className="text-sm text-muted mb-4">
        System shows <strong>{medicine.current_stock}</strong> {medicine.unit}(s). Enter what is actually on the shelf; the difference is recorded as an adjustment.
      </p>
      <div className="field-row">
        <FormField label="Counted quantity"><input className="input" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></FormField>
        <FormField label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

function ReceiveModal({ medicines, onClose, onDone }) {
  const suppliers = useFetch(() => getSuppliers(), []);
  const [f, setF] = useState({ medicine: "", supplier: "", batch_number: "", quantity_received: "", expiry_date: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, run } = useSubmit(
    () => createMedicineBatch({ ...f, supplier: f.supplier || null, quantity_received: Number(f.quantity_received) }),
    onDone, () => "Stock received");
  const ok = f.medicine && f.batch_number && f.quantity_received && f.expiry_date;
  return (
    <Modal wide title="Receive stock" onClose={onClose}
      footer={<SubmitButton busy={busy} disabled={!ok} onClick={run}>Receive</SubmitButton>}>
      <div className="field-row">
        <FormField label="Medicine *">
          <select className="select" value={f.medicine} onChange={set("medicine")}>
            <option value="">Select…</option>
            {medicines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </FormField>
        <FormField label="Supplier">
          <select className="select" value={f.supplier} onChange={set("supplier")}>
            <option value="">-</option>
            {(suppliers.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FormField>
        <FormField label="Batch number *"><input className="input" value={f.batch_number} onChange={set("batch_number")} /></FormField>
        <FormField label="Quantity *"><input className="input" type="number" min="1" value={f.quantity_received} onChange={set("quantity_received")} /></FormField>
        <FormField label="Expiry date *"><input className="input" type="date" value={f.expiry_date} onChange={set("expiry_date")} /></FormField>
      </div>
    </Modal>
  );
}