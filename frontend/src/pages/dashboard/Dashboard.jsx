// src/pages/dashboard/Dashboard.jsx
// HMIS-style dashboard. Same data (getDashboardSummary), same roles and links as before.
// Update: compact cards (less height, smaller radius) + shaded area under the revenue line.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { METHOD_LABEL, useFetch } from "../../components/PageKit";
import { useAuth } from "../../context/AuthContext.jsx";
import { getDashboardSummary } from "../../services/api";
import { formatCurrency, formatDateTime } from "../../utils/formatters";

const PIE_COLORS = ["#4f46e5", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#64748b", "#db2777"];
const shortDate = (iso) => new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short" });
const kFormat = (v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v);

// Compact card styling. Everything is scoped to .dash-compact so other pages are untouched.
const METRIC_CARD_CSS = `
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

  /* Tighter stat grid + smaller radius / padding for chart and table cards */
  .dash-compact .stat-grid{grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:var(--space-3);padding-bottom:var(--space-2)}
  .dash-compact .chart-card,
  .dash-compact .table-wrap{border-radius:8px}
  .dash-compact .chart-card{padding:var(--space-4)}
  .dash-compact .chart-card__header{margin-bottom:var(--space-3)}
  .dash-compact .table-toolbar{padding:var(--space-3) var(--space-4)}
  .dash-compact .data-table thead th{padding:var(--space-2) var(--space-3)}
  .dash-compact .data-table tbody td{padding:var(--space-2) var(--space-3)}
`;

// Only links every role can open (all of these routes are open to all POS roles)
const QUICK_ACTIONS = [
  { to: "/billing/walk-in-sale", icon: "bi-bag-check", title: "New Sale", desc: "Ring up a walk-in sale",
    iconBg: "var(--primary-50)", iconColor: "var(--primary-600)" },
  { to: "/billing/payments", icon: "bi-receipt", title: "Payments", desc: "Transactions & balances",
    iconBg: "var(--info-soft)", iconColor: "var(--info-strong)" },
  { to: "/inventory", icon: "bi-box-seam", title: "Inventory", desc: "Products & stock levels",
    iconBg: "var(--success-soft)", iconColor: "var(--success-strong)" },
];

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

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{label}</div>
      <div className="chart-tooltip__value">{formatCurrency(payload[0].value)}</div>
    </div>
  );
}

function PieValueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{item.name}</div>
      <div className="chart-tooltip__value">{formatCurrency(item.value)}</div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [days, setDays] = useState(14);
  const { data, loading, error } = useFetch(() => getDashboardSummary(days), [days]);

  if (loading && !data) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <span className="loading-screen__label">Loading dashboard…</span>
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

  const trend = data.trend.map((d) => ({ ...d, revenue: Number(d.revenue), label: shortDate(d.date) }));
  const methods = data.payment_methods.map((m) => ({ name: METHOD_LABEL[m.method] || m.method, value: Number(m.total) }));
  const top = data.top_medicines.map((m) => ({ name: m.name, revenue: Number(m.revenue) }));
  const trendTotal = trend.reduce((s, d) => s + d.revenue, 0);
  const name = user?.first_name || user?.username;

  return (
    <div className="dash-compact">
      <style>{METRIC_CARD_CSS}</style>

      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Overview</div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Welcome back, {name}! {user?.role === "CASHIER" ? "Here's your sales overview." : "Here's how the shop is doing."}
          </p>
        </div>
        <div className="page-header__actions">
          <select className="select" style={{ width: 160 }} value={days}
            onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <Link to="/billing/walk-in-sale" className="btn btn-primary">
            <i className="bi bi-plus-lg" aria-hidden="true" /> New sale
          </Link>
        </div>
      </div>

      {/* ==================== KEY METRICS ==================== */}
      <div className="stat-grid mb-5">
        <MetricCard icon="bi-cash-stack" variant="primary" label="Today's Sales"
          value={formatCurrency(data.today.revenue)} sub={`${data.today.sales} sale(s) today`} />
        <MetricCard icon="bi-bag-check" variant="info" label="Items Sold Today"
          value={data.today.items_sold} sub="units sold across all sales" />
        <MetricCard icon="bi-cash-coin" variant="warning" label="Outstanding Balances"
          value={formatCurrency(data.outstanding)} sub={<Link to="/billing/payments?unpaid=1">View unpaid</Link>} />
        <MetricCard icon="bi-exclamation-triangle" variant="danger" label="Low Stock"
          value={data.low_stock_count} sub={`${data.out_of_stock_count} out of stock`} />
        <MetricCard icon="bi-hourglass-split" variant="warning" label="Expiring Soon"
          value={data.expiring_count} sub={<Link to="/inventory?tab=expiring">Review batches</Link>} />
      </div>

      {/* ==================== ANALYTICS ==================== */}
      <h2 className="section-title mb-3">Analytics</h2>

      <div className="dashboard-grid mb-4">
        <div className="chart-card">
          <div className="chart-card__header">
            <h5 className="card-title">Revenue (Last {days} Days)</h5>
            <span className="font-semibold text-sm">{formatCurrency(trendTotal)}</span>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.35} />
                    <stop offset="60%" stopColor="#4f46e5" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={kFormat} fontSize={12} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<MoneyTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2.5}
                  fill="url(#revenueFill)" dot={{ r: 3, fill: "#4f46e5" }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card__header">
            <h5 className="card-title">Payment Methods</h5>
          </div>
          {methods.length === 0 ? (
            <div className="text-center text-tertiary py-6">No sales in this period.</div>
          ) : (
            <>
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={methods} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={44} outerRadius={70} paddingAngle={2}>
                      {methods.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<PieValueTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-legend mt-2" style={{ flexWrap: "wrap", justifyContent: "center" }}>
                {methods.map((m, i) => (
                  <span key={m.name} className="chart-legend__item">
                    <span className="chart-legend__swatch" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    {m.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid-2 mb-4">
        <div className="chart-card min-w-0">
          <div className="chart-card__header">
            <h5 className="card-title">Top Selling Products</h5>
            <span className="text-tertiary text-xs">By revenue</span>
          </div>
          <div style={{ height: 240 }}>
            {top.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                  <XAxis type="number" tickFormatter={kFormat} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" width={120} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(22, 163, 74, 0.08)" }} />
                  <Bar dataKey="revenue" fill="#16a34a" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-tertiary py-6">No sales in this period.</div>
            )}
          </div>
        </div>

        <div className="table-wrap min-w-0">
          <div className="table-toolbar">
            <h5 className="card-title">Low Stock Alerts</h5>
            <Link to="/inventory?tab=low" className="link-btn">See all</Link>
          </div>
          {data.low_stock.length === 0 ? (
            <div className="text-center text-tertiary py-6">All products are above their reorder level.</div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Product</th><th className="text-right">In stock</th><th className="text-right">Reorder at</th></tr>
                </thead>
                <tbody>
                  {data.low_stock.map((m) => (
                    <tr key={m.id}>
                      <td className="cell-primary">{m.name}</td>
                      <td className="cell-numeric">
                        <span className={`badge ${m.current_stock === 0 ? "badge-danger" : "badge-warning"}`}>
                          {m.current_stock}
                        </span>
                      </td>
                      <td className="cell-numeric">{m.reorder_level}</td>
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
          <h5 className="card-title">Recent Sales</h5>
          <Link to="/billing/payments" className="link-btn">All payments</Link>
        </div>
        {data.recent_sales.length === 0 ? (
          <div className="text-center text-tertiary py-6">No sales yet. Make your first sale from the POS.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sale</th><th>Customer</th><th>Served by</th><th>Method</th><th>When</th>
                  <th className="text-right">Total</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_sales.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-mono">{s.sale_number}</td>
                    <td className="cell-primary">{s.customer_name || "Walk-in"}</td>
                    <td>{s.served_by_name}</td>
                    <td>{METHOD_LABEL[s.payment_method] || s.payment_method}</td>
                    <td className="cell-muted">{formatDateTime(s.sold_at)}</td>
                    <td className="cell-numeric">{formatCurrency(s.total_amount)}</td>
                    <td>
                      {Number(s.balance) > 0
                        ? <span className="badge badge-warning">Owes {formatCurrency(s.balance)}</span>
                        : <span className="badge badge-success">Paid</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}