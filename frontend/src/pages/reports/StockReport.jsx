// src/pages/reports/StockReport.jsx
// Styled to match the Dashboard: compact metric cards, table-wrap / data-table, badge-* statuses.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, downloadCSV, useFetch } from "../../components/PageKit";
import { METRIC_CARD_CSS, MetricCard } from "../../components/MetricCard.jsx";
import { getStockReport } from "../../services/api";
import { formatCurrency, formatDate } from "../../utils/formatters";

const STATUS_BADGE = { OK: "badge-success", LOW: "badge-warning", OUT: "badge-danger" };

export default function StockReport() {
  const { data, loading, error } = useFetch(() => getStockReport(), []);
  const [tab, setTab] = useState("all");

  if (loading && !data) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <span className="loading-screen__label">Loading report…</span>
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

  const rows = tab === "all" ? data.items : data.items.filter((r) => r.status !== "OK");

  return (
    <div className="dash-compact">
      <style>{METRIC_CARD_CSS}</style>

      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Reports</div>
          <h1 className="page-title">Stock &amp; expiry</h1>
          <p className="page-subtitle">
            Valued at selling price (the system does not track buying cost yet).
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-secondary" onClick={() => downloadCSV("stock_report.csv", data.items)}>
            <i className="bi bi-download" aria-hidden="true" /> Export CSV
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <i className="bi bi-printer" aria-hidden="true" /> Print
          </button>
        </div>
      </div>

      {/* ==================== KEY METRICS ==================== */}
      <div className="stat-grid mb-5">
        <MetricCard icon="bi-cash-stack" variant="success" label="Stock Value"
          value={formatCurrency(data.total_value)} sub="At selling price" />
        <MetricCard icon="bi-box-seam" variant="primary" label="Products"
          value={data.total_products} sub={<Link to="/inventory">Open inventory</Link>} />
        <MetricCard icon="bi-exclamation-triangle" variant="warning" label="Low Stock"
          value={data.low_count} sub="At or below reorder level" />
        <MetricCard icon="bi-x-octagon" variant="danger" label="Out of Stock"
          value={data.out_count} sub="Needs restocking" />
      </div>

      <div className="mb-3">
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: "all", label: "All stock", count: data.items.length },
          { key: "attention", label: "Needs attention", count: data.low_count + data.out_count },
          { key: "expiry", label: "Expiring batches", count: data.expiring.length },
        ]} />
      </div>

      {tab !== "expiry" ? (
        <div className="table-wrap">
          <div className="table-toolbar">
            <h5 className="card-title">{tab === "all" ? "All Stock" : "Needs Attention"}</h5>
            <span className="text-tertiary text-xs">{rows.length} item(s)</span>
          </div>
          {rows.length === 0 ? (
            <div className="text-center text-tertiary py-6">Nothing needs attention.</div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th><th>Category</th>
                    <th className="text-right">Qty</th><th className="text-right">Price</th>
                    <th className="text-right">Value</th><th className="text-right">Reorder at</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-primary">{r.name}</td>
                      <td className="cell-muted">{r.category || "-"}</td>
                      <td className="cell-numeric">{r.quantity}</td>
                      <td className="cell-numeric">{formatCurrency(r.unit_price)}</td>
                      <td className="cell-numeric">{formatCurrency(r.value)}</td>
                      <td className="cell-numeric">{r.reorder_level}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status] || "badge-warning"}`}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-toolbar">
            <h5 className="card-title">Expiring Batches</h5>
            <Link to="/inventory?tab=expiring" className="link-btn">Review in inventory</Link>
          </div>
          {data.expiring.length === 0 ? (
            <div className="text-center text-tertiary py-6">No batches are close to expiry.</div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th><th>Batch</th>
                    <th className="text-right">Remaining</th><th>Expiry</th><th>Days left</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expiring.map((b) => (
                    <tr key={b.id}>
                      <td className="cell-primary">{b.medicine}</td>
                      <td className="cell-mono">{b.batch_number}</td>
                      <td className="cell-numeric">{b.quantity_remaining}</td>
                      <td className="cell-muted">{formatDate(b.expiry_date)}</td>
                      <td>
                        <span className={`badge ${b.days_left <= 30 ? "badge-danger" : "badge-warning"}`}>
                          {b.days_left < 0 ? `Expired ${-b.days_left}d ago` : `${b.days_left} days`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}