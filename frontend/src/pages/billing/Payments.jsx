// src/pages/billing/Payments.jsx
// Restyled to match the compact Dashboard: same metric cards, 8px radius cards/tables,
// design-system buttons, inputs, badges and data-table.
// Receipts: every sale can be viewed, downloaded (PDF) and printed, using the exact same
// receipt as the Walk-in Sale screen.
// Export: the payments list is exported as a PDF that uses the same look as the receipt
// (shop header, navy rule, navy table headers, grey label cells, footer).
// The payment summary is printed AFTER the transactions table.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "../../context/ToastContext";
import {
  DateRange, METHOD_LABEL, Modal, isoDate, useFetch,
} from "../../components/PageKit";
import { addOTCSalePayment, getOTCSales, getPaymentsSummary } from "../../services/api";
import { formatCurrency, formatDateTime } from "../../utils/formatters";
import { useShopProfile, loadShopProfile } from "../../utils/shopProfile";
import {
  ReceiptModal, WalkInSaleStyles, resolveReceiptQr, downloadReceiptPdf, printReceiptPdf,
} from "./WalkInSale";

// ---------------------------------------------------------------------------
// PDF REPORT (same visual format as the Walk-in Sale receipt)
// ---------------------------------------------------------------------------
const RC_NAVY = [31, 56, 100];
const RC_GREY = [242, 242, 242];
const RC_BORDER = [166, 166, 166];
const RC_BLACK = [0, 0, 0];
const POWERED_BY = "Powered by Cloud 360 (www.Cloud 360.com)"; // "" to hide

const money = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Same header lines the receipt uses, built from the shop profile.
const reportHeader = (profile) => {
  const s = profile?.settings || {};
  const name = s.name || profile?.shopName || "My Shop";
  const contact = [s.phone && `Tel: ${s.phone}`, s.email && `Email: ${s.email}`]
    .filter(Boolean)
    .join("  |  ");
  return {
    name: name.toUpperCase(),
    footerName: name,
    subtitle: s.kra_pin ? `KRA PIN: ${s.kra_pin}` : "",
    addressLine1: s.address || "",
    addressLine2: contact,
    poweredBy: POWERED_BY,
  };
};

function buildPaymentsPdf({ rows, summary, range, method, search, unpaid, profile }) {
  const hdr = reportHeader(profile);
  const cur = profile?.currency || "KES";
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth(); // 297
  const pageHeight = doc.internal.pageSize.getHeight(); // 210
  const marginX = 10;
  const year = new Date().getFullYear();

  // --- Header (centred shop details, navy rule) ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(hdr.name.length > 32 ? 12 : 15);
  doc.setTextColor(...RC_NAVY);
  doc.text(hdr.name, pageWidth / 2, 11, { align: "center" });

  if (hdr.subtitle) {
    doc.setFontSize(8);
    doc.text(hdr.subtitle, pageWidth / 2, 15.5, { align: "center" });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...RC_BLACK);
  if (hdr.addressLine1) doc.text(hdr.addressLine1, pageWidth / 2, 19, { align: "center" });
  if (hdr.addressLine2) doc.text(hdr.addressLine2, pageWidth / 2, 22.5, { align: "center" });

  doc.setDrawColor(...RC_NAVY);
  doc.setLineWidth(0.6);
  doc.line(marginX, 26.8, pageWidth - marginX, 26.8);

  // --- Title row (generated date on the right) ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...RC_NAVY);
  doc.text("PAYMENTS REPORT", pageWidth / 2, 32, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(110, 110, 110);
  doc.text(
    `Generated ${new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}`,
    pageWidth - marginX, 32, { align: "right" }
  );

  // --- Period + filters ---
  const filters = [
    method ? `Method: ${METHOD_LABEL[method] || method}` : "Method: All",
    unpaid ? "Unpaid only" : null,
    search ? `Search: "${search}"` : null,
  ].filter(Boolean).join("   |   ");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...RC_BLACK);
  doc.text(`Period: ${range.from} to ${range.to}`, marginX, 37.5);
  doc.text(filters, pageWidth - marginX, 37.5, { align: "right" });

  // --- Transactions table (first) ---
  const totalAll = rows.reduce((a, r) => a + Number(r.total_amount || 0), 0);
  const paidAll = rows.reduce((a, r) => a + Number(r.amount_paid || 0), 0);
  const owedAll = rows.reduce((a, r) => a + Math.max(Number(r.balance || 0), 0), 0);

  autoTable(doc, {
    startY: 41,
    margin: { left: marginX, right: marginX, top: 14, bottom: 18 },
    head: [["No", "Sale", "Date", "Customer", "Method", "Reference", "Total", "Paid", "Balance", "Served By"]],
    body: rows.map((r, i) => [
      String(i + 1),
      r.sale_number,
      r.sold_at ? new Date(r.sold_at).toLocaleString("en-KE") : "-",
      r.customer_name || "Walk-in",
      METHOD_LABEL[r.payment_method] || r.payment_method || "-",
      r.reference_number || "-",
      money(r.total_amount),
      money(r.amount_paid),
      Number(r.balance) > 0 ? money(r.balance) : "Paid",
      r.served_by_name || "-",
    ]),
    foot: [["", "", "", "", "", "TOTAL", money(totalAll), money(paidAll), money(owedAll), ""]],
    showFoot: "lastPage",
    theme: "grid",
    styles: {
      font: "helvetica", fontSize: 7, cellPadding: 1.1, overflow: "ellipsize",
      textColor: RC_BLACK, lineColor: [191, 191, 191], lineWidth: 0.2,
    },
    headStyles: { fillColor: RC_NAVY, textColor: [255, 255, 255], fontStyle: "bold", lineColor: RC_NAVY },
    footStyles: { fillColor: RC_GREY, textColor: RC_BLACK, fontStyle: "bold", lineColor: RC_BORDER },
    alternateRowStyles: { fillColor: RC_GREY },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      1: { cellWidth: 28 },
      2: { cellWidth: 36 },
      3: { cellWidth: "auto" },
      4: { cellWidth: 20 },
      5: { cellWidth: 28 },
      6: { cellWidth: 24, halign: "right" },
      7: { cellWidth: 24, halign: "right" },
      8: { cellWidth: 22, halign: "right" },
      9: { cellWidth: 30 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 8 && data.cell.raw !== "Paid") {
        data.cell.styles.textColor = [185, 28, 28];
        data.cell.styles.fontStyle = "bold";
      }
      if (data.section === "foot" && data.column.index >= 5) {
        data.cell.styles.halign = "right";
      }
    },
  });

  // --- Payment summary (AFTER the transactions table) ---
  if (summary) {
    const summaryRows = [
      ["Sales", String(summary.sales ?? rows.length)],
      ["Billed", `${cur} ${money(summary.billed)}`],
      ["Collected", `${cur} ${money(summary.collected)}`],
      ["Outstanding", `${cur} ${money(summary.outstanding)}`],
      ...(summary.by_method || []).map((m) => [
        `${METHOD_LABEL[m.method] || m.method} (${m.count})`,
        `${cur} ${money(m.total)}`,
      ]),
    ];

    // Move to a fresh page if the heading + table will not fit under the transactions table.
    const neededHeight = 8 + summaryRows.length * 5.6;
    let summaryY = doc.lastAutoTable.finalY + 8;
    if (summaryY + neededHeight > pageHeight - 18) {
      doc.addPage();
      summaryY = 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...RC_NAVY);
    doc.text("PAYMENT SUMMARY", marginX, summaryY);

    autoTable(doc, {
      startY: summaryY + 3,
      margin: { left: marginX, right: pageWidth / 2 + 10, top: 14, bottom: 18 },
      pageBreak: "avoid",
      body: summaryRows,
      theme: "grid",
      styles: {
        font: "helvetica", fontSize: 7.5, cellPadding: 1.2,
        lineColor: RC_BORDER, lineWidth: 0.2, textColor: RC_BLACK,
      },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 45, fillColor: RC_GREY },
        1: { halign: "right" },
      },
    });
  }

  // --- Footer on every page (same as receipt footer + page numbers) ---
  const pages = doc.getNumberOfPages();
  const footerLineY = pageHeight - 12;
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...RC_BLACK);
    doc.setLineWidth(0.15);
    doc.line(marginX, footerLineY, pageWidth - marginX, footerLineY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(...RC_BLACK);
    doc.text(`© ${year} ${hdr.footerName}. All rights reserved.`, marginX, footerLineY + 4);

    if (hdr.poweredBy) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(5.5);
      doc.setTextColor(90, 90, 90);
      doc.text(hdr.poweredBy, pageWidth - marginX, footerLineY + 4, { align: "right" });
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    doc.setTextColor(90, 90, 90);
    doc.text("This is an official payments report. Duplication is prohibited.", marginX, footerLineY + 7.5);
    doc.text(`Page ${p} of ${pages}`, pageWidth - marginX, footerLineY + 7.5, { align: "right" });
  }

  return doc;
}

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

  /* Receipt action buttons (View / Download / Print) */
  .pay-actions{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
  .pay-actions__btn{width:30px;height:30px;display:inline-grid;place-items:center;border:1px solid #e6ebf1;border-radius:6px;background:var(--surface,#fff);color:#475569;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
  .pay-actions__btn:hover:not(:disabled){background:#eaf1ff;color:#2f5fd0;border-color:#c9d8f7}
  .pay-actions__btn:disabled{opacity:.5;cursor:wait}

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
  const profile = useShopProfile();
  const [params, setParams] = useSearchParams();
  const today = isoDate(new Date());
  const [range, setRange] = useState({ from: today, to: today });
  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const [unpaid, setUnpaid] = useState(params.get("unpaid") === "1");
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Receipt state: `receipt` is the sale shown in the preview window,
  // `busy` is "<saleId>:<view|download|print>" while something is being prepared.
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState("");

  const q = { date_from: range.from, date_to: range.to, payment_method: method, search, unpaid: unpaid ? 1 : "" };
  const sales = useFetch(() => getOTCSales(q), [range.from, range.to, method, search, unpaid]);
  const summary = useFetch(() => getPaymentsSummary({ date_from: range.from, date_to: range.to }), [range.from, range.to]);

  const refresh = () => { sales.reload(); summary.reload(); };
  const rows = sales.data || [];
  const s = summary.data;

  // ---- PDF export (replaces the old CSV export) ---------------------------
  const exportPdf = async () => {
    if (exporting || !rows.length) return;
    setExporting(true);
    try {
      const doc = buildPaymentsPdf({
        rows, summary: s, range, method, search, unpaid,
        profile: profile?.loaded ? profile : await loadShopProfile(),
      });
      doc.save(`payments_${range.from}_${range.to}.pdf`);
    } catch {
      toast.error("Could not generate the payments PDF");
    } finally {
      setExporting(false);
    }
  };

  // ---- receipt actions ----------------------------------------------------
  // The list API returns the sale without a browser-made QR, so build it first.
  const withQr = async (sale) => ({ ...sale, qr_code: await resolveReceiptQr(sale) });

  const runReceipt = async (sale, kind) => {
    const key = `${sale.id}:${kind}`;
    if (busy) return;
    setBusy(key);
    try {
      const full = await withQr(sale);
      if (kind === "view") setReceipt(full);
      else if (kind === "download") await downloadReceiptPdf(full, profile);
      else await printReceiptPdf(full, profile);
    } catch {
      toast.error(
        kind === "view" ? "Could not open the receipt"
          : kind === "download" ? "Could not generate the receipt PDF"
          : "Could not prepare the receipt for printing"
      );
    } finally {
      setBusy("");
    }
  };

  const viewReceipt = (sale) => runReceipt(sale, "view");
  const downloadReceipt = (sale) => runReceipt(sale, "download");
  const printReceipt = (sale) => runReceipt(sale, "print");

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
          <button className="btn btn-secondary" onClick={exportPdf} disabled={!rows.length || exporting}>
            <i className={`bi ${exporting ? "bi-hourglass-split" : "bi-file-earmark-pdf"}`} aria-hidden="true" />{" "}
            {exporting ? "Preparing..." : "Export PDF"}
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
                  <th className="text-right">Receipt</th>
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
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <span className="pay-actions">
                        <button type="button" className="pay-actions__btn" title="View receipt"
                          aria-label={`View receipt ${r.sale_number}`}
                          disabled={!!busy} onClick={() => viewReceipt(r)}>
                          <i className={`bi ${busy === `${r.id}:view` ? "bi-hourglass-split" : "bi-eye"}`} />
                        </button>
                        <button type="button" className="pay-actions__btn" title="Download PDF"
                          aria-label={`Download receipt ${r.sale_number}`}
                          disabled={!!busy} onClick={() => downloadReceipt(r)}>
                          <i className={`bi ${busy === `${r.id}:download` ? "bi-hourglass-split" : "bi-file-earmark-pdf"}`} />
                        </button>
                        <button type="button" className="pay-actions__btn" title="Print receipt"
                          aria-label={`Print receipt ${r.sale_number}`}
                          disabled={!!busy} onClick={() => printReceipt(r)}>
                          <i className={`bi ${busy === `${r.id}:print` ? "bi-hourglass-split" : "bi-printer"}`} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <SaleModal sale={selected} onClose={() => setSelected(null)}
          onPaid={() => { setSelected(null); refresh(); }}
          onView={() => viewReceipt(selected)}
          onDownload={() => downloadReceipt(selected)}
          onPrint={() => printReceipt(selected)}
          receiptBusy={!!busy} />
      )}

      {/* Receipt preview (same window as the Walk-in Sale screen) */}
      {receipt && (
        <>
          <WalkInSaleStyles />
          <ReceiptModal
            receipt={receipt}
            onClose={() => setReceipt(null)}
            onPrint={() => printReceipt(receipt)}
            onDownload={() => downloadReceipt(receipt)}
            printing={!!busy && busy.endsWith(":print")}
            downloading={!!busy && busy.endsWith(":download")}
          />
        </>
      )}
    </div>
  );
}

function SaleModal({ sale, onClose, onPaid, onView, onDownload, onPrint, receiptBusy }) {
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
      footer={(
        <>
          <button className="btn btn-outline" onClick={onView} disabled={receiptBusy}>
            <i className="bi bi-eye" aria-hidden="true" /> View receipt
          </button>
          <button className="btn btn-outline" onClick={onDownload} disabled={receiptBusy}>
            <i className="bi bi-file-earmark-pdf" aria-hidden="true" /> Download
          </button>
          <button className="btn btn-outline" onClick={onPrint} disabled={receiptBusy}>
            <i className="bi bi-printer" aria-hidden="true" /> Print
          </button>
          {owed > 0 ? (
            <button className={`btn btn-primary${busy ? " is-loading" : ""}`} disabled={busy || !Number(amount)} onClick={collect}>
              <i className="bi bi-check2" aria-hidden="true" /> {busy ? "Saving…" : "Record payment"}
            </button>
          ) : <button className="btn btn-secondary" onClick={onClose}>Close</button>}
        </>
      )}>
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