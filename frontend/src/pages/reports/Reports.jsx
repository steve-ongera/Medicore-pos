// src/pages/reports/Reports.jsx - hub page linking to each report
// Styled to match the Dashboard: compact cards (shared MetricCard CSS), same header markup.
import { Link } from "react-router-dom";
import { METRIC_CARD_CSS } from "../../components/MetricCard.jsx";

const REPORTS = [
  { to: "/reports/sales", icon: "bi-graph-up-arrow", variant: "primary", title: "Sales report",
    text: "Revenue by day, payment method and cashier, with discounts and unpaid balances." },
  { to: "/reports/products", icon: "bi-capsule", variant: "success", title: "Product performance",
    text: "Best and slowest sellers - quantity and revenue per medicine." },
  { to: "/reports/stock", icon: "bi-box-seam", variant: "warning", title: "Stock & expiry",
    text: "Stock value, low / out-of-stock items and batches nearing expiry." },
];

// Report tiles reuse the .dm-card look; these rules only make the whole tile a clean link.
const HUB_CSS = `
  .dash-compact .report-tile{text-decoration:none;color:inherit;gap:10px}
  .dash-compact .report-tile .dm-card__title{font-size:.95rem;font-weight:600;color:#0f172a;line-height:1.25}
  .dash-compact .report-tile .dm-card__text{font-size:.8rem;color:#64748b;line-height:1.45;margin:0}
  .dash-compact .report-tile .dm-card__sub{display:flex;align-items:center;justify-content:space-between;font-weight:500;color:#2f5fd0}
  .dash-compact .report-tile:focus-visible{outline:2px solid #4f46e5;outline-offset:2px}
`;

export default function Reports() {
  return (
    <div className="dash-compact">
      <style>{METRIC_CARD_CSS + HUB_CSS}</style>

      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Overview</div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Pick a report. Every report can be exported to CSV.</p>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        {REPORTS.map((r) => (
          <Link key={r.to} to={r.to} className={`dm-card dm-card--${r.variant} report-tile`}>
            <div className="dm-card__top">
              <span className="dm-card__title">{r.title}</span>
              <span className="dm-card__icon"><i className={`bi ${r.icon}`} aria-hidden="true" /></span>
            </div>
            <p className="dm-card__text">{r.text}</p>
            <div className="dm-card__sub">
              <span>Open report</span>
              <i className="bi bi-arrow-right" aria-hidden="true" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}