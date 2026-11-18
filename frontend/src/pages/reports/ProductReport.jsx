// src/pages/reports/ProductReport.jsx
// Styled to match the Dashboard: compact metric cards, table-wrap / data-table.
import { useState } from "react";
import { DateRange, daysAgo, downloadCSV, isoDate, useFetch } from "../../components/PageKit";
import { METRIC_CARD_CSS, MetricCard } from "../../components/MetricCard.jsx";
import { getProductReport } from "../../services/api";
import { formatCurrency } from "../../utils/formatters";

// Revenue share bar (same green as the Dashboard's top-medicines chart)
const BAR_CSS = `
  .dash-compact .rev-bar{height:8px;border-radius:4px;background:#eef2f6;overflow:hidden}
  .dash-compact .rev-bar > div{height:100%;border-radius:4px;background:#16a34a}
`;

export default function ProductReport() {
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const { data, loading, error } = useFetch(
    () => getProductReport({ date_from: range.from, date_to: range.to }),
    [range.from, range.to],
  );

  const items = data?.items || [];
  const max = Math.max(...items.map((i) => Number(i.revenue)), 1);
  const totalRevenue = items.reduce((s, i) => s + Number(i.revenue), 0);
  const topItem = items.reduce((best, i) => (!best || Number(i.revenue) > Number(best.revenue) ? i : best), null);

  return (
    <div className="dash-compact">
      <style>{METRIC_CARD_CSS + BAR_CSS}</style>

      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Reports</div>
          <h1 className="page-title">Product performance</h1>
          <p className="page-subtitle">What sold, how much, and how much it earned.</p>
        </div>
        <div className="page-header__actions">
          <DateRange from={range.from} to={range.to} onChange={setRange} />
          <button className="btn btn-secondary" disabled={!items.length}
            onClick={() => downloadCSV(
              `products_${range.from}_${range.to}.csv`,
              items.map(({ name, unit, quantity, revenue }) => ({ name, unit, quantity, revenue })),
            )}>
            <i className="bi bi-download" aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="loading-screen">
          <div className="spinner spinner-lg" />
          <span className="loading-screen__label">Loading report…</span>
        </div>
      ) : error ? (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
          <div className="alert-message">{error}</div>
        </div>
      ) : (
        <>
          {/* ==================== KEY METRICS ==================== */}
          <div className="stat-grid mb-5">
            <MetricCard icon="bi-cash-stack" variant="success" label="Product Revenue"
              value={formatCurrency(totalRevenue)} sub="From products sold in this period" />
            <MetricCard icon="bi-box-seam" variant="primary" label="Products Sold"
              value={items.length} sub="Distinct medicines" />
            <MetricCard icon="bi-trophy" variant="warning" label="Top Seller"
              value={topItem ? formatCurrency(topItem.revenue) : "-"}
              sub={topItem ? topItem.name : "No sales yet"} />
          </div>

          <div className="table-wrap">
            <div className="table-toolbar">
              <h5 className="card-title">Sales by Product</h5>
              <span className="text-tertiary text-xs">By revenue</span>
            </div>
            {items.length === 0 ? (
              <div className="text-center text-tertiary py-6">No sales in this period.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Medicine</th>
                      <th className="text-right">Qty sold</th>
                      <th className="text-right">Revenue</th>
                      <th style={{ width: "26%" }} aria-label="Share of top seller" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i, n) => (
                      <tr key={i.medicine}>
                        <td className="cell-muted">{n + 1}</td>
                        <td className="cell-primary">{i.name}</td>
                        <td className="cell-numeric">{i.quantity} {i.unit}</td>
                        <td className="cell-numeric">{formatCurrency(i.revenue)}</td>
                        <td>
                          <div className="rev-bar">
                            <div style={{ width: `${(Number(i.revenue) / max) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}