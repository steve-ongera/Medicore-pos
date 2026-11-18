// src/pages/reports/SalesReport.jsx
// Styled to match the Dashboard: compact metric cards, chart-card / table-wrap / data-table,
// and a shaded area under the revenue line.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DateRange, METHOD_LABEL, daysAgo, downloadCSV, isoDate, useFetch } from "../../components/PageKit";
import { METRIC_CARD_CSS, MetricCard } from "../../components/MetricCard.jsx";
import { getSalesReport } from "../../services/api";
import { formatCurrency, formatDate } from "../../utils/formatters";

const kFormat = (v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v);

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{label}</div>
      <div className="chart-tooltip__value">{formatCurrency(payload[0].value)}</div>
    </div>
  );
}

export default function SalesReport() {
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const { data, loading, error } = useFetch(
    () => getSalesReport({ date_from: range.from, date_to: range.to }),
    [range.from, range.to],
  );

  const daily = (data?.daily || []).map((d) => ({
    ...d,
    revenue: Number(d.revenue),
    label: formatDate(d.date).slice(0, 6),
  }));

  return (
    <div className="dash-compact">
      <style>{METRIC_CARD_CSS}</style>

      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Reports</div>
          <h1 className="page-title">Sales report</h1>
          <p className="page-subtitle">Revenue, discounts and balances for the selected period.</p>
        </div>
        <div className="page-header__actions">
          <DateRange from={range.from} to={range.to} onChange={setRange} />
          <button className="btn btn-secondary" disabled={!data}
            onClick={() => downloadCSV(`sales_${range.from}_${range.to}.csv`, data.daily)}>
            <i className="bi bi-download" aria-hidden="true" /> Export CSV
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <i className="bi bi-printer" aria-hidden="true" /> Print
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
      ) : data && (
        <>
          {/* ==================== KEY METRICS ==================== */}
          <div className="stat-grid mb-5">
            <MetricCard icon="bi-cash-stack" variant="success" label="Revenue"
              value={formatCurrency(data.totals.revenue)} sub="Total for the period" />
            <MetricCard icon="bi-bag-check" variant="primary" label="Sales"
              value={data.totals.sales} sub={`Avg ${formatCurrency(data.totals.average_sale)} per sale`} />
            <MetricCard icon="bi-tag" variant="warning" label="Discounts Given"
              value={formatCurrency(data.totals.discount)} sub="Total discounts applied" />
            <MetricCard icon="bi-cash-coin" variant="danger" label="Unpaid Balances"
              value={formatCurrency(data.totals.outstanding)}
              sub={<Link to="/billing/payments?unpaid=1">View unpaid</Link>} />
          </div>

          {/* ==================== ANALYTICS ==================== */}
          <h2 className="section-title mb-3">Analytics</h2>

          <div className="chart-card mb-4">
            <div className="chart-card__header">
              <h5 className="card-title">Daily Revenue</h5>
              <span className="font-semibold text-sm">{formatCurrency(data.totals.revenue)}</span>
            </div>
            <div style={{ height: 240 }}>
              {daily.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={daily} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.35} />
                        <stop offset="60%" stopColor="#4f46e5" stopOpacity={0.12} />
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={kFormat} fontSize={12} tickLine={false} axisLine={false} width={44} />
                    <Tooltip content={<MoneyTooltip />} />
                    <Area type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2.5}
                      fill="url(#salesRevenueFill)" dot={{ r: 3, fill: "#4f46e5" }} activeDot={{ r: 5 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-tertiary py-6">No sales in this period.</div>
              )}
            </div>
          </div>

          <div className="grid-2 mb-4">
            <div className="table-wrap min-w-0">
              <div className="table-toolbar">
                <h5 className="card-title">By Payment Method</h5>
              </div>
              {data.payment_methods.length === 0 ? (
                <div className="text-center text-tertiary py-6">No sales in this period.</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr><th>Method</th><th className="text-right">Sales</th><th className="text-right">Total</th></tr>
                    </thead>
                    <tbody>
                      {data.payment_methods.map((m) => (
                        <tr key={m.method}>
                          <td className="cell-primary">{METHOD_LABEL[m.method] || m.method}</td>
                          <td className="cell-numeric">{m.count}</td>
                          <td className="cell-numeric">{formatCurrency(m.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="table-wrap min-w-0">
              <div className="table-toolbar">
                <h5 className="card-title">By Cashier</h5>
              </div>
              {data.cashiers.length === 0 ? (
                <div className="text-center text-tertiary py-6">No sales in this period.</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr><th>Cashier</th><th className="text-right">Sales</th><th className="text-right">Total</th></tr>
                    </thead>
                    <tbody>
                      {data.cashiers.map((c) => (
                        <tr key={c.id || c.name}>
                          <td className="cell-primary">{c.name}</td>
                          <td className="cell-numeric">{c.count}</td>
                          <td className="cell-numeric">{formatCurrency(c.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="table-wrap">
            <div className="table-toolbar">
              <h5 className="card-title">Day by Day</h5>
              <span className="text-tertiary text-xs">Newest first</span>
            </div>
            {data.daily.length === 0 ? (
              <div className="text-center text-tertiary py-6">No sales in this period.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>Date</th><th className="text-right">Sales</th><th className="text-right">Revenue</th></tr>
                  </thead>
                  <tbody>
                    {[...data.daily].reverse().map((d) => (
                      <tr key={d.date}>
                        <td className="cell-primary">{formatDate(d.date)}</td>
                        <td className="cell-numeric">{d.sales}</td>
                        <td className="cell-numeric">{formatCurrency(d.revenue)}</td>
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