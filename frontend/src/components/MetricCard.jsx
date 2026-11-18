// src/components/MetricCard.jsx
// Shared compact card styling used by Dashboard and report pages.
// Wrap a page in <div className="dash-compact"> and render <style>{METRIC_CARD_CSS}</style> once.

export const METRIC_CARD_CSS = `
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

  .dash-compact .stat-grid{grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:var(--space-3);padding-bottom:var(--space-2)}
  .dash-compact .chart-card,
  .dash-compact .table-wrap{border-radius:8px}
  .dash-compact .chart-card{padding:var(--space-4)}
  .dash-compact .chart-card__header{margin-bottom:var(--space-3)}
  .dash-compact .table-toolbar{padding:var(--space-3) var(--space-4)}
  .dash-compact .data-table thead th{padding:var(--space-2) var(--space-3)}
  .dash-compact .data-table tbody td{padding:var(--space-2) var(--space-3)}
`;

export function MetricCard({ icon, variant = "primary", label, value, sub }) {
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