// src/pages/billing/WalkInSale.jsx
//
// Walk-in POS screen for any kind of shop (pharmacy, supermarket, retail...).
// Wording, currency and the receipt header/footer come from the shop's settings
// via useShopProfile(), so there is nothing shop-specific hardcoded here.
import { useEffect, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode"; // npm i qrcode
import { toast } from "../../context/ToastContext";
import ProductSearch, {
  ProductEditModal,
  ProductAddModal,
  useCanEditProduct,
} from "../../components/ProductSearch";
import { searchMedicines, createOTCSale, getOTCSales, amendOTCSale } from "../../services/api";
import { formatDateTime } from "../../utils/formatters";
import { useShopProfile, loadShopProfile } from "../../utils/shopProfile";
// Default picture for products that have no image (save it as src/assets/no_image_available.png)
import noImage from "../../assets/no_image_available.png";
// Optional receipt logos: import an image and put it in RC_LOGOS below, e.g.
// import shopLogo from "../../assets/shop-logo.png";

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "MPESA", label: "M-Pesa" },
  { value: "CARD", label: "Card" },
];

const toArray = (data) => (Array.isArray(data) ? data : data?.results ?? []);

// Product photo: the uploaded image, or the default "no image" picture.
const imageOf = (m) => m?.image || noImage;
const onImgError = (e) => {
  e.currentTarget.onerror = null; // never loop if the default fails too
  e.currentTarget.src = noImage;
};
function ProductImg({ product, className }) {
  return (
    <img
      src={imageOf(product)}
      alt=""
      className={className}
      loading="lazy"
      onError={onImgError}
    />
  );
}

// ---------------------------------------------------------------------------
// Editable cart amounts
// The cashier may overwrite the amount of any cart line (e.g. 6 items listed at
// 60 sold for 100). `customAmount` holds that typed LINE TOTAL as a string;
// when it is undefined the normal list price (unit_price x quantity) is used.
// ---------------------------------------------------------------------------
const listAmountOf = (item) => Number(item.medicine.unit_price) * item.quantity;

const hasCustomAmount = (item) => item.customAmount !== undefined && item.customAmount !== null;

const lineAmountOf = (item) => {
  if (!hasCustomAmount(item)) return listAmountOf(item);
  const n = Number(item.customAmount);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// A custom amount that is empty or not a valid non-negative number.
const isInvalidCustomAmount = (item) =>
  hasCustomAmount(item) &&
  (String(item.customAmount).trim() === "" || !(Number(item.customAmount) >= 0));

// Change a line's quantity. If the cashier edited the amount, keep the edited
// per-unit price (6 for 100 -> 7 for 116.67) instead of snapping back.
const withQuantity = (item, quantity) => {
  if (!hasCustomAmount(item)) return { ...item, quantity };
  if (String(item.customAmount).trim() === "") return { ...item, quantity };
  const perUnit = lineAmountOf(item) / item.quantity;
  return { ...item, quantity, customAmount: String(Math.round(perUnit * quantity * 100) / 100) };
};

// ---------------------------------------------------------------------------
// RECEIPT: header / footer text comes from the shop settings (Settings page).
// ---------------------------------------------------------------------------
const POWERED_BY = "Powered by Cloud 360 (www.Cloud 360.com)"; // "" to hide

// Optional header logos (PDF: far left / far right; preview: above the name).
// Leave null for none, or point at an imported image.
const RC_LOGOS = {
  left: null, // e.g. shopLogo
  right: null,
};

// Builds the receipt header/footer lines from the shop profile.
const receiptHeader = (profile) => {
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
    thanks: s.receipt_footer || "Thank you for shopping with us.",
    poweredBy: POWERED_BY,
  };
};

const RC_NAVY = [31, 56, 100];
const RC_GREY = [242, 242, 242];
const RC_BORDER = [166, 166, 166];
const RC_BLACK = [0, 0, 0];

const METHOD_LABEL = { CASH: "Cash", MPESA: "M-Pesa", CARD: "Card", INSURANCE: "Insurance" };

const money = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Verification QR code
// Generated in the browser as a base64 PNG data URL, so it always shows in the
// receipt preview AND in the PDF (no backend URL / CORS problems).
// If the backend already sends a data-URL QR, that one is kept.
// CHANGE the fallback path below to your real receipt-verification route.
// ---------------------------------------------------------------------------
export async function resolveReceiptQr(sale) {
  if (sale?.qr_code && String(sale.qr_code).startsWith("data:")) return sale.qr_code;
  try {
    const text =
      sale.verify_url ||
      `${window.location.origin}/verify-receipt/${encodeURIComponent(sale.sale_number)}`;
    return await QRCode.toDataURL(text, { margin: 1, width: 256 });
  } catch {
    return null;
  }
}

// Loads an image URL as a base64 PNG data URL (null if it fails)
const getImageBase64 = (url) =>
  new Promise((resolve) => {
    if (!url) return resolve(null);
    // Data URLs are already base64 — no need to round-trip through a canvas.
    if (String(url).startsWith("data:image/png")) return resolve(url);
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
  });

// Builds the A5 receipt. ALWAYS exactly one page (no addPage anywhere).
// `sale` is the object returned by POST /otc-sales/; `profile` is the shop profile.
async function buildReceiptPdf(sale, profile) {
  const hdr = receiptHeader(profile);
  const cur = profile?.currency || "KES";
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
  const pageWidth = doc.internal.pageSize.getWidth(); // 148
  const pageHeight = doc.internal.pageSize.getHeight(); // 210
  const marginX = 10;
  const year = new Date().getFullYear();

  const [base64LogoLeft, base64LogoRight, base64Qr] = await Promise.all([
    getImageBase64(RC_LOGOS.left),
    getImageBase64(RC_LOGOS.right),
    getImageBase64(sale.qr_code),
  ]);

  // --- Header: optional logo at the far LEFT / far RIGHT,
  //     shop details centred between them ---
  const LOGO_TOP = 6;
  const LOGO_MAX_H = 13;
  const LOGO_MAX_W = 22; // kept narrow so the centred text never runs under a logo

  const drawLogo = (base64, side) => {
    if (!base64) return;
    const props = doc.getImageProperties(base64);
    const ratio = props.width / props.height || 1;
    let drawW = LOGO_MAX_H * ratio;
    let drawH = LOGO_MAX_H;
    if (drawW > LOGO_MAX_W) {
      drawW = LOGO_MAX_W;
      drawH = drawW / ratio;
    }
    const x = side === "left" ? marginX : pageWidth - marginX - drawW;
    const yPos = LOGO_TOP + (LOGO_MAX_H - drawH) / 2; // vertically centre each logo
    doc.addImage(base64, "PNG", x, yPos, drawW, drawH);
  };

  drawLogo(base64LogoLeft, "left");
  drawLogo(base64LogoRight, "right");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(hdr.name.length > 32 ? 10.5 : 13);
  doc.setTextColor(...RC_NAVY);
  doc.text(hdr.name, pageWidth / 2, 11, { align: "center" });

  if (hdr.subtitle) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...RC_NAVY);
    doc.text(hdr.subtitle, pageWidth / 2, 15, { align: "center" });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...RC_BLACK);
  if (hdr.addressLine1) doc.text(hdr.addressLine1, pageWidth / 2, 18.5, { align: "center" });
  if (hdr.addressLine2) doc.text(hdr.addressLine2, pageWidth / 2, 21.5, { align: "center" });

  doc.setDrawColor(...RC_NAVY);
  doc.setLineWidth(0.6);
  doc.line(marginX, 26.8, pageWidth - marginX, 26.8);

  // --- Title (generated date sits on the right of the title row) ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...RC_NAVY);
  doc.text(sale.amended_at ? "CORRECTED SALES RECEIPT" : "OFFICIAL SALES RECEIPT", pageWidth / 2, 31.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(110, 110, 110);
  doc.text(
    `Generated ${new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}`,
    pageWidth - marginX,
    31.5,
    { align: "right" }
  );

  // --- Receipt no + date ---
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...RC_BLACK);
  doc.text(`Receipt No: ${sale.sale_number}`, marginX, 36.5);
  doc.text(`Date: ${new Date(sale.sold_at).toLocaleString("en-KE")}`, pageWidth - marginX, 36.5, {
    align: "right",
  });

  // --- Customer / payment info table ---
  autoTable(doc, {
    startY: 39.5,
    margin: { left: marginX, right: marginX },
    pageBreak: "avoid",
    body: [
      ["Customer", sale.customer_name || "Walk-in Customer"],
      ["Phone", sale.customer_phone || "-"],
      ["Payment Method", METHOD_LABEL[sale.payment_method] || sale.payment_method],
      ["Reference", sale.reference_number || "-"],
      ["Served By", sale.served_by_name || "-"],
    ],
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 1.2,
      lineColor: RC_BORDER,
      lineWidth: 0.2,
      textColor: RC_BLACK,
      overflow: "ellipsize",
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 30, fillColor: RC_GREY },
      1: { cellWidth: "auto" },
    },
  });

  // --- Items table (font shrinks for long carts so it stays on one page) ---
  const items = sale.items || [];
  const itemFont = items.length > 12 ? 5.8 : items.length > 8 ? 6.5 : 7;
  const itemPad = items.length > 12 ? 0.6 : items.length > 8 ? 0.9 : 1.1;

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 3,
    margin: { left: marginX, right: marginX },
    pageBreak: "avoid",
    head: [["No", "Item", "Qty", "Unit Price", "Amount"]],
    body: items.map((it, i) => [
      String(i + 1),
      it.medicine_name,
      String(it.quantity),
      money(it.unit_price),
      money(it.subtotal),
    ]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: itemFont,
      cellPadding: itemPad,
      overflow: "ellipsize",
      textColor: RC_BLACK,
      lineColor: [191, 191, 191],
      lineWidth: 0.2,
    },
    headStyles: { fillColor: RC_NAVY, textColor: [255, 255, 255], fontStyle: "bold", lineColor: RC_NAVY },
    alternateRowStyles: { fillColor: RC_GREY },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 24, halign: "right" },
      4: { cellWidth: 24, halign: "right" },
    },
  });

  // --- Totals table ---
  const balance = Number(sale.balance || 0);
  const totalsRows = [
    ["Subtotal", `${cur} ${money(sale.subtotal)}`],
    ["Discount", `${cur} ${money(sale.discount)}`],
    ["Total", `${cur} ${money(sale.total_amount)}`],
    ["Amount Paid", `${cur} ${money(sale.amount_paid)}`],
  ];
  if (balance > 0) totalsRows.push(["Balance Due", `${cur} ${money(balance)}`]);
  else if (balance < 0) totalsRows.push(["Change Given", `${cur} ${money(Math.abs(balance))}`]);

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 3,
    margin: { left: pageWidth / 2, right: marginX },
    pageBreak: "avoid",
    body: totalsRows,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 1.1,
      lineColor: RC_BORDER,
      lineWidth: 0.2,
      textColor: RC_BLACK,
    },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: RC_GREY, cellWidth: 26 },
      1: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === 2) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 8.5;
      }
      if (data.section === "body" && data.row.index === 4 && data.column.index === 1 && balance > 0) {
        data.cell.styles.textColor = [185, 28, 28];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // ================================================================
  // BOTTOM BLOCK pinned from page bottom: QR + stamp -> signatures -> footer
  // ================================================================
  const footerLineY = pageHeight - 15;
  const sigY = footerLineY - 12;
  const qrSize = 28;
  const qrX = marginX;
  const qrY = sigY - qrSize - 10;

  if (base64Qr) {
    doc.addImage(base64Qr, "PNG", qrX, qrY, qrSize, qrSize);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(110, 110, 110);
    doc.text("Scan to verify this receipt", qrX + qrSize / 2, qrY + qrSize + 3, { align: "center" });
  } else {
    doc.setDrawColor(...RC_BORDER);
    doc.setLineWidth(0.2);
    doc.rect(qrX, qrY, qrSize, qrSize);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(110, 110, 110);
    doc.text("Verification QR", qrX + qrSize / 2, qrY + qrSize / 2 - 1, { align: "center" });
    doc.text("unavailable", qrX + qrSize / 2, qrY + qrSize / 2 + 3, { align: "center" });
  }

  // Official stamp box
  const stampX = qrX + qrSize + 5;
  const stampWidth = pageWidth - stampX - marginX;
  doc.setDrawColor(...RC_BLACK);
  doc.setLineWidth(0.25);
  doc.rect(stampX, qrY, stampWidth, qrSize);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...RC_BLACK);
  doc.text("Official Shop Stamp", stampX + stampWidth / 2, qrY + 5, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(120, 120, 120);
  doc.text("(Stamp here)", stampX + stampWidth / 2, qrY + qrSize / 2 + 2, { align: "center" });

  // Thank-you line from the shop settings (receipt footer)
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 90);
  doc.text(hdr.thanks, pageWidth / 2, sigY - 4, { align: "center", maxWidth: pageWidth - marginX * 2 });

  // Signature lines
  doc.setDrawColor(...RC_BLACK);
  doc.setLineWidth(0.25);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...RC_BLACK);
  doc.text("Cashier's Signature:", marginX, sigY);
  doc.line(marginX, sigY + 6, pageWidth / 2 - 3, sigY + 6);
  doc.text("Customer's Signature:", pageWidth / 2 + 3, sigY);
  doc.line(pageWidth / 2 + 3, sigY + 6, pageWidth - marginX, sigY + 6);

  // Footer
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
  doc.text("This is an official sales receipt. Duplication is prohibited.", marginX, footerLineY + 7.5);

  return doc;
}

// Save the receipt as a PDF file.
// `profile` is optional: other pages can keep calling downloadReceiptPdf(sale);
// the shop profile is then loaded automatically.
export async function downloadReceiptPdf(sale, profile) {
  const doc = await buildReceiptPdf(sale, profile || (await loadShopProfile()));
  doc.save(`receipt_${sale.sale_number}.pdf`);
}

// Print the exact same PDF (hidden iframe, falls back to opening a tab).
// `profile` is optional, as above.
export async function printReceiptPdf(sale, profile) {
  const doc = await buildReceiptPdf(sale, profile || (await loadShopProfile()));
  const blobUrl = URL.createObjectURL(doc.output("blob"));

  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "1px",
    height: "1px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  iframe.src = blobUrl;

  const cleanup = () =>
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      URL.revokeObjectURL(blobUrl);
    }, 60000);

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        window.open(blobUrl, "_blank");
      } finally {
        cleanup();
      }
    }, 300);
  };

  document.body.appendChild(iframe);
}

// ---------------------------------------------------------------------------
// "Sale Complete" window: a large, paper-style receipt preview with the
// Download PDF / Print buttons pinned underneath it.
// ---------------------------------------------------------------------------
export function ReceiptModal({ receipt, onClose, onPrint, onDownload, printing, downloading }) {
  const profile = useShopProfile();
  const hdr = receiptHeader(profile);
  const cur = profile.currency;
  const items = receipt.items || [];
  const corrected = Boolean(receipt.amended_at);
  const subtotal = Number(receipt.subtotal ?? 0);
  const discount = Number(receipt.discount || 0);
  const balance = Number(receipt.balance || 0);
  const soldAt = receipt.sold_at ? new Date(receipt.sold_at).toLocaleString("en-KE") : "";
  const unitsTotal = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);

  return (
    <div className="modal-overlay">
      <div className="wis-rcpt-modal" role="dialog" aria-modal="true" aria-label="Sales receipt">
        <div className="wis-rcpt-head">
          <div>
            <h3 className="wis-rcpt-head__title">
              <i
                className={`bi ${corrected ? "bi-pencil-square" : "bi-check-circle-fill"}`}
                style={{ color: "var(--success-strong, #047857)", marginRight: 8 }}
              ></i>
              {corrected ? "Sale Corrected" : "Sale Complete"}
            </h3>
            <p className="wis-rcpt-head__sub">{receipt.sale_number}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close receipt">
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="wis-rcpt-scroll">
          <div className="wis-rcpt-paper">
            {/* Header (from shop settings) */}
            <div className="wis-rcpt__center">
              {RC_LOGOS.left && <img src={RC_LOGOS.left} alt={hdr.name} className="wis-rcpt__logo" />}
              <div className="wis-rcpt__org">{hdr.name}</div>
              {hdr.subtitle && <div className="wis-rcpt__sub">{hdr.subtitle}</div>}
              {hdr.addressLine1 && <div className="wis-rcpt__small">{hdr.addressLine1}</div>}
              {hdr.addressLine2 && <div className="wis-rcpt__small">{hdr.addressLine2}</div>}
            </div>

            <div className="wis-rcpt__dash" />

            <div className="wis-rcpt__title">{corrected ? "CORRECTED SALES RECEIPT" : "OFFICIAL SALES RECEIPT"}</div>

            <div className="wis-rcpt__dash" />

            {/* Sale details */}
            <div className="wis-rcpt__kv">
              <span>Receipt No</span>
              <strong>{receipt.sale_number}</strong>
            </div>
            <div className="wis-rcpt__kv">
              <span>Date</span>
              <span>{soldAt}</span>
            </div>
            <div className="wis-rcpt__kv">
              <span>Customer</span>
              <span>{receipt.customer_name || "Walk-in Customer"}</span>
            </div>
            {receipt.customer_phone && (
              <div className="wis-rcpt__kv">
                <span>Phone</span>
                <span>{receipt.customer_phone}</span>
              </div>
            )}
            <div className="wis-rcpt__kv">
              <span>Payment</span>
              <span>{METHOD_LABEL[receipt.payment_method] || receipt.payment_method}</span>
            </div>
            {receipt.reference_number && (
              <div className="wis-rcpt__kv">
                <span>Reference</span>
                <span>{receipt.reference_number}</span>
              </div>
            )}
            {receipt.served_by_name && (
              <div className="wis-rcpt__kv">
                <span>Served by</span>
                <span>{receipt.served_by_name}</span>
              </div>
            )}

            <div className="wis-rcpt__dash" />

            {/* Items */}
            <table className="wis-rcpt__items">
              <thead>
                <tr>
                  <th className="is-left">Item</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id ?? i}>
                    <td className="is-left">{item.medicine_name}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.unit_price)}</td>
                    <td>{money(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="wis-rcpt__dash" />

            {/* Totals */}
            <div className="wis-rcpt__kv">
              <span>
                Subtotal ({unitsTotal} unit{unitsTotal !== 1 ? "s" : ""})
              </span>
              <span>{cur} {money(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="wis-rcpt__kv">
                <span>Discount</span>
                <span>- {cur} {money(discount)}</span>
              </div>
            )}
            <div className="wis-rcpt__total">
              <span>TOTAL</span>
              <span>{cur} {money(receipt.total_amount)}</span>
            </div>
            <div className="wis-rcpt__kv">
              <span>Amount Paid</span>
              <span>{cur} {money(receipt.amount_paid)}</span>
            </div>
            {balance > 0 && (
              <div className="wis-rcpt__kv is-due">
                <span>Balance Due</span>
                <strong>{cur} {money(balance)}</strong>
              </div>
            )}
            {balance < 0 && (
              <div className="wis-rcpt__kv">
                <span>Change Given</span>
                <strong>{cur} {money(Math.abs(balance))}</strong>
              </div>
            )}

            <div className="wis-rcpt__dash" />

            {/* QR + thank-you */}
            <div className="wis-rcpt__center">
              {receipt.qr_code ? (
                <>
                  <img src={receipt.qr_code} alt="Receipt verification QR code" className="wis-rcpt__qr" />
                  <div className="wis-rcpt__small">Scan to verify this receipt</div>
                </>
              ) : null}
              <div className="wis-rcpt__thanks">THANK YOU FOR YOUR PURCHASE</div>
              <div className="wis-rcpt__small">{hdr.thanks} Keep this receipt for any returns.</div>
              {hdr.poweredBy && <div className="wis-rcpt__powered">{hdr.poweredBy}</div>}
            </div>
          </div>
        </div>

        <div className="wis-rcpt-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-success" onClick={onDownload} disabled={downloading}>
            <i className="bi bi-file-earmark-pdf" style={{ marginRight: "var(--space-2)" }}></i>
            {downloading ? "Preparing..." : "Download PDF"}
          </button>
          <button type="button" className="btn btn-primary" onClick={onPrint} disabled={printing}>
            <i className="bi bi-printer" style={{ marginRight: "var(--space-2)" }}></i>
            {printing ? "Preparing..." : "Print Receipt"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WalkInSaleStyles() {
  return (
    <style>{`
      .wis-catalog {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--space-3);
        max-height: 420px;
        overflow-y: auto;
        padding-right: var(--space-1);
      }
      .wis-catalog__item {
        position: relative;
        display: flex;
      }
      .wis-catalog__item .wis-catalog__card {
        width: 100%;
      }
      .wis-catalog__card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
        text-align: left;
        background: var(--surface, #fff);
        transition: border-color var(--duration-fast) var(--ease-standard),
                    box-shadow var(--duration-fast) var(--ease-standard),
                    background var(--duration-fast) var(--ease-standard);
      }
      .wis-catalog__card:hover:not(:disabled) {
        border-color: var(--brand, var(--border-strong));
        box-shadow: var(--shadow-sm);
        background: var(--surface-hover);
      }
      .wis-catalog__card:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .wis-catalog__card.is-in-cart {
        border-color: var(--brand, #2563eb);
        box-shadow: 0 0 0 1px var(--brand, #2563eb) inset;
      }
      .wis-catalog__qty {
        position: absolute;
        top: 6px;
        left: 6px;
        min-width: 22px;
        height: 22px;
        padding: 0 6px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: var(--brand, #2563eb);
        color: #fff;
        font-size: 0.75rem;
        font-weight: 700;
        line-height: 1;
        pointer-events: none;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
      }
      /* Underlined "Edit" text link (catalog card + cart row) */
      .wis-link-edit {
        background: none;
        border: none;
        padding: 0;
        font-size: 12px;
        font-weight: 500;
        color: var(--brand, #2563eb);
        text-decoration: underline;
        cursor: pointer;
      }
      .wis-link-edit:hover {
        opacity: 0.75;
      }
      .wis-catalog__edit {
        position: absolute;
        top: 8px;
        right: 10px;
        z-index: 1;
      }

      .wis-catalog__img {
        width: 100%;
        height: 92px;
        object-fit: cover;
        border-radius: var(--radius-md);
        background: #fff;
        border: 1px solid var(--border-subtle);
        flex-shrink: 0;
      }
      .wis-thumb {
        width: 44px;
        height: 44px;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid var(--border-subtle);
        background: #fff;
        flex-shrink: 0;
      }
      .wis-thumb--sm {
        width: 30px;
        height: 30px;
        border-radius: 6px;
      }
      .wis-catalog__name {
        font-weight: var(--fw-medium);
        font-size: var(--fs-sm);
        color: var(--text-primary);
        line-height: 1.2;
      }
      .wis-catalog__price {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--text-secondary);
      }
      .wis-catalog__stock {
        font-size: var(--fs-2xs, 0.7rem);
        padding: 2px 6px;
        border-radius: var(--radius-sm, 4px);
        font-weight: var(--fw-medium);
      }
      .wis-catalog__stock--ok {
        background: var(--success-soft, #ecfdf5);
        color: var(--success-strong, #047857);
      }
      .wis-catalog__stock--low {
        background: var(--warning-soft, #fffbeb);
        color: var(--warning-strong, #b45309);
      }
      .wis-catalog__stock--out {
        background: var(--danger-soft);
        color: var(--danger-strong);
      }

      .wis-stepper {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        overflow: hidden;
      }
      .wis-stepper button {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        color: var(--text-secondary);
        transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
      }
      .wis-stepper button:hover {
        background: var(--surface-hover);
        color: var(--text-primary);
      }
      .wis-stepper span {
        width: 32px;
        text-align: center;
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        color: var(--text-primary);
      }

      /* Editable line amount in the cart */
      .wis-cart-row__controls {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .wis-amount {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .wis-amount__label {
        font-size: 12px;
        color: var(--text-secondary);
      }
      .wis-amount__input {
        width: 84px;
        height: 28px;
        padding: 0 6px;
        font-size: 12px;
        font-family: var(--font-mono);
      }
      .wis-amount__input.is-custom {
        border-color: var(--brand, #2563eb);
      }
      .wis-amount__input.is-invalid {
        border-color: var(--danger-strong, #b91c1c);
      }
      .wis-amount__reset {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-secondary);
        padding: 2px;
      }
      .wis-cart-row__name {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
      }
      .wis-cart-row__stock {
        font-size: 11px;
        color: var(--text-secondary);
        margin-top: 2px;
      }
      .wis-cart-row__stock.is-over {
        color: var(--danger-strong, #b91c1c);
        font-weight: 600;
      }
      .wis-amount__hint {
        font-size: 11px;
        color: var(--text-secondary);
        margin-top: 2px;
      }

      .wis-summary-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-2) 0;
        font-size: var(--fs-sm);
      }
      .wis-summary-line--total {
        border-top: 1px solid var(--border-subtle);
        border-bottom: 1px solid var(--border-subtle);
        margin: var(--space-2) 0 var(--space-4);
        padding: var(--space-3) 0;
        font-weight: var(--fw-semibold);
        font-size: var(--fs-md);
        color: var(--text-primary);
      }

      /* ================================================================
         SALE COMPLETE — big receipt-paper preview
         ================================================================ */
      .wis-rcpt-modal {
        width: min(620px, 96vw);
        max-width: 96vw;
        max-height: 94vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--surface, #fff);
        border-radius: var(--radius-lg, 14px);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      }
      .wis-rcpt-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 18px;
        border-bottom: 1px solid var(--border-subtle, #e5e7eb);
        flex-shrink: 0;
      }
      .wis-rcpt-head__title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--text-primary);
      }
      .wis-rcpt-head__sub {
        margin: 2px 0 0;
        font-size: 12px;
        font-family: var(--font-mono, monospace);
        color: var(--text-secondary);
      }
      .wis-rcpt-scroll {
        flex: 1 1 auto;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 26px 18px 30px;
        background: var(--surface-muted, #e9ecf1);
      }

      /* The paper itself — always white/black, like real thermal paper */
      .wis-rcpt-paper {
        position: relative;
        width: 100%;
        max-width: 460px;
        margin: 0 auto;
        padding: 26px 26px 30px;
        background: #fff;
        color: #111;
        font-family: "Courier New", Courier, ui-monospace, monospace;
        font-size: 13.5px;
        line-height: 1.45;
        box-shadow: 0 3px 14px rgba(0, 0, 0, 0.18);
      }
      /* Torn / zig-zag edges at the top and bottom */
      .wis-rcpt-paper::before,
      .wis-rcpt-paper::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        height: 6px;
        background-size: 12px 12px;
      }
      .wis-rcpt-paper::before {
        top: -5px;
        background-image:
          linear-gradient(135deg, transparent 6px, #fff 0),
          linear-gradient(225deg, transparent 6px, #fff 0);
        background-position: left top;
      }
      .wis-rcpt-paper::after {
        bottom: -5px;
        background-image:
          linear-gradient(-45deg, transparent 6px, #fff 0),
          linear-gradient(45deg, transparent 6px, #fff 0);
        background-position: left bottom;
      }

      .wis-rcpt__center {
        text-align: center;
      }
      .wis-rcpt__logo {
        height: 54px;
        width: auto;
        max-width: 160px;
        object-fit: contain;
        margin: 0 auto 8px;
        display: block;
      }
      .wis-rcpt__org {
        font-size: 17px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: #1f3864;
      }
      .wis-rcpt__sub {
        font-size: 12px;
        font-weight: 700;
        color: #1f3864;
      }
      .wis-rcpt__small {
        font-size: 11.5px;
        color: #374151;
      }
      .wis-rcpt__motto {
        margin-top: 2px;
        font-size: 11px;
        font-style: italic;
        color: #6b7280;
      }
      .wis-rcpt__dash {
        border-top: 1.5px dashed #9ca3af;
        margin: 12px 0;
      }
      .wis-rcpt__title {
        text-align: center;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      .wis-rcpt__kv {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        padding: 1px 0;
      }
      .wis-rcpt__kv > span:first-child {
        color: #4b5563;
        flex-shrink: 0;
      }
      .wis-rcpt__kv > :last-child {
        text-align: right;
        word-break: break-word;
      }
      .wis-rcpt__kv.is-due {
        color: #b91c1c;
      }
      .wis-rcpt__kv.is-due > span:first-child {
        color: #b91c1c;
      }

      .wis-rcpt__items {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .wis-rcpt__items th {
        padding: 0 0 6px;
        text-align: right;
        font-weight: 700;
        border-bottom: 1px solid #111;
      }
      .wis-rcpt__items td {
        padding: 5px 0 0;
        text-align: right;
        vertical-align: top;
      }
      .wis-rcpt__items th.is-left,
      .wis-rcpt__items td.is-left {
        text-align: left;
        padding-right: 8px;
        word-break: break-word;
      }
      .wis-rcpt__items th:not(.is-left),
      .wis-rcpt__items td:not(.is-left) {
        white-space: nowrap;
        padding-left: 10px;
      }

      .wis-rcpt__total {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        margin: 8px 0;
        padding: 8px 0;
        border-top: 1.5px solid #111;
        border-bottom: 1.5px solid #111;
        font-size: 18px;
        font-weight: 700;
      }

      .wis-rcpt__qr {
        width: 118px;
        height: 118px;
        display: block;
        margin: 0 auto 4px;
        image-rendering: pixelated;
      }
      .wis-rcpt__thanks {
        margin-top: 12px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.06em;
      }
      .wis-rcpt__powered {
        margin-top: 8px;
        font-size: 10.5px;
        font-style: italic;
        color: #6b7280;
      }

      .wis-rcpt-actions {
        display: flex;
        gap: var(--space-2, 8px);
        padding: 12px 18px;
        border-top: 1px solid var(--border-subtle, #e5e7eb);
        background: var(--surface, #fff);
        flex-shrink: 0;
      }
      .wis-rcpt-actions .btn {
        flex: 1 1 0;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      /* ---- Mobile-only pieces are hidden on laptops/desktops ---- */
      .wis-bar,
      .wis-backdrop,
      .wis-sheet-header {
        display: none;
      }

      /* ================================================================
         MOBILE / TABLET (<= 900px)
         - catalog is a 2-column tap grid; each tapped item shows a quantity badge
         - a sticky bar at the bottom always shows items + total (no scrolling)
         - cart + checkout slide up as a bottom sheet
         ================================================================ */
      @keyframes wis-bump {
        0% { transform: scale(1); }
        40% { transform: scale(1.35); }
        100% { transform: scale(1); }
      }

      @media (max-width: 900px) {
        .wis-root {
          padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px));
        }

        /* Bigger touch-friendly inputs (16px stops iOS zooming on focus) */
        .wis-root .input,
        .wis-root .select,
        .wis-root .textarea,
        .wis-root input[type="text"],
        .wis-root input[type="number"],
        .wis-root input[type="search"] {
          font-size: 16px;
          min-height: 44px;
        }

        .wis-root .page-header {
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        /* Catalog: 2 columns, let the page scroll (no nested scroll box) */
        .wis-catalog {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--space-2);
          max-height: none;
          overflow: visible;
          padding-right: 0;
        }
        .wis-catalog__card {
          padding: var(--space-3) var(--space-2);
          min-height: 128px;
        }
        .wis-catalog__card:active:not(:disabled) {
          transform: scale(0.97);
        }
        .wis-link-edit {
          font-size: 13px;
          padding: 4px 2px;
        }
        .wis-catalog__qty {
          min-width: 26px;
          height: 26px;
          font-size: 0.8rem;
        }

        .wis-catalog__img {
          height: 84px;
        }

        /* Card header: stack title + add button */
        .wis-root .card-header {
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        /* ---- Sticky bottom bar ---- */
        .wis-bar {
          display: block;
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 90;
          padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
          background: var(--surface, #fff);
          border-top: 1px solid var(--border-subtle, #e5e7eb);
          box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.12);
        }
        .wis-bar.is-hidden {
          display: none;
        }
        .wis-bar__btn {
          width: 100%;
          min-height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 0 16px;
          border: none;
          border-radius: 12px;
          background: var(--brand, var(--primary, #2563eb));
          color: #fff;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .wis-bar__left {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .wis-bar__count {
          min-width: 28px;
          height: 28px;
          padding: 0 8px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.25);
          font-size: 0.9rem;
          animation: wis-bump 0.3s ease;
        }
        .wis-bar__total {
          font-family: var(--font-mono);
          font-size: 1rem;
        }

        /* ---- Bottom sheet (cart + order summary) ---- */
        .wis-backdrop {
          display: block;
          position: fixed;
          inset: 0;
          z-index: 95;
          background: rgba(0, 0, 0, 0.45);
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s ease, visibility 0.2s ease;
        }
        .wis-backdrop.is-open {
          opacity: 1;
          visibility: visible;
        }

        .wis-sidebar {
          position: fixed !important;
          left: 0;
          right: 0;
          bottom: 0;
          top: auto;
          z-index: 100;
          width: 100%;
          max-height: 92vh;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          padding: 0 12px calc(12px + env(safe-area-inset-bottom, 0px));
          background: var(--surface-muted, #f3f4f6);
          border-radius: 18px 18px 0 0;
          box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
          transform: translateY(105%);
          visibility: hidden;
          transition: transform 0.28s ease, visibility 0.28s ease;
        }
        .wis-sidebar.is-open {
          transform: translateY(0);
          visibility: visible;
        }

        .wis-sheet-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 2;
          padding: 14px 4px 10px;
          background: var(--surface-muted, #f3f4f6);
        }
        .wis-sheet-header::before {
          content: "";
          position: absolute;
          top: 6px;
          left: 50%;
          width: 40px;
          height: 4px;
          margin-left: -20px;
          border-radius: 4px;
          background: var(--border-strong, #cbd5e1);
        }
        .wis-sheet-title {
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }
        .wis-sheet-close {
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border: none;
          border-radius: 50%;
          background: var(--surface, #fff);
          color: var(--text-secondary);
          font-size: 1rem;
          cursor: pointer;
        }

        /* Easier-to-tap cart controls */
        .wis-sidebar .wis-stepper {
          height: 40px !important;
        }
        .wis-sidebar .wis-stepper button {
          width: 40px !important;
          height: 38px !important;
        }
        .wis-sidebar .wis-stepper span {
          width: 36px !important;
          font-size: 14px !important;
        }
        .wis-sidebar .wis-amount__input {
          width: 96px;
          height: 40px;
          min-height: 40px;
        }
        .wis-cart-remove {
          width: 40px !important;
          height: 40px !important;
          display: grid !important;
          place-items: center !important;
        }

        /* Complete Sale button stays reachable at the bottom of the sheet */
        .wis-sidebar .card-footer {
          position: sticky;
          bottom: 0;
          background: var(--surface, #fff);
        }
        .wis-sidebar .card-footer .btn {
          min-height: 52px;
          font-size: 1rem;
        }

        /* Receipt window: full width, buttons stacked */
        .wis-rcpt-modal {
          width: 100vw;
          max-width: 100vw;
          max-height: 96vh;
          border-radius: 16px 16px 0 0;
          align-self: flex-end;
        }
        .wis-rcpt-scroll {
          padding: 20px 10px 24px;
        }
        .wis-rcpt-paper {
          padding: 22px 16px 26px;
          font-size: 13px;
        }
        .wis-rcpt-actions {
          flex-wrap: wrap;
          padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        }
        .wis-rcpt-actions .btn {
          flex: 1 1 100%;
          min-height: 48px;
        }
      }
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// "Edit a sale": fix a sale that was already processed (wrong item, amount,
// payment...). The corrected sale comes back from the server and is printed
// from the normal receipt window.
// ---------------------------------------------------------------------------
function AmendSaleModal({ catalog, canEditMedicine, onCatalogChanged, onClose, onSaved }) {
  const profile = useShopProfile();
  const cur = profile.currency;
  const [query, setQuery] = useState("");
  const [sales, setSales] = useState([]);
  const [loadingSales, setLoadingSales] = useState(true);
  const [sale, setSale] = useState(null);

  const [lines, setLines] = useState([]);
  const [origQty, setOrigQty] = useState({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchKey, setSearchKey] = useState(0);
  const [editingMed, setEditingMed] = useState(null); // product being edited (name / price / stock)

  // Step 1: find the sale (recent sales, or search by number / customer / phone).
  useEffect(() => {
    if (sale) return undefined;
    let cancelled = false;
    setLoadingSales(true);
    const timer = setTimeout(
      async () => {
        try {
          const data = await getOTCSales({ search: query.trim() || undefined, page_size: 25 });
          if (!cancelled) setSales(toArray(data));
        } catch (err) {
          if (!cancelled) toast.error(err.message || "Failed to load sales");
        } finally {
          if (!cancelled) setLoadingSales(false);
        }
      },
      query ? 300 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, sale]);

  // Step 2: load the chosen sale into the editor.
  const selectSale = (s) => {
    const catalogById = Object.fromEntries(catalog.map((m) => [m.id, m]));
    const qtyById = {};
    const initial = (s.items || []).map((it) => {
      qtyById[it.medicine] = (qtyById[it.medicine] || 0) + it.quantity;
      const med = catalogById[it.medicine] || {
        id: it.medicine,
        name: it.medicine_name,
        unit: it.unit,
        unit_price: it.unit_price,
        current_stock: 0,
      };
      const line = { medicine: med, quantity: it.quantity };
      // Keep the amount that was actually charged when it differs from today's list price.
      if (Number(it.subtotal) !== Number(med.unit_price) * it.quantity) {
        line.customAmount = String(Number(it.subtotal));
      }
      return line;
    });
    setOrigQty(qtyById);
    setLines(initial);
    setCustomerName(s.customer_name || "");
    setCustomerPhone(s.customer_phone || "");
    setDiscount(String(Number(s.discount) || 0));
    setPaymentMethod(s.payment_method || "CASH");
    setReferenceNumber(s.reference_number || "");
    setAmountPaid(String(Number(s.amount_paid) || 0));
    setReason("");
    setSale(s);
  };

  // Stock this sale can use = what is on the shelf now + what this sale already took.
  const availableOf = (line) => (Number(line.medicine.current_stock) || 0) + (origQty[line.medicine.id] || 0);

  const addMedicine = (medicine) => {
    const avail = (Number(medicine.current_stock) || 0) + (origQty[medicine.id] || 0);
    const existing = lines.find((l) => l.medicine.id === medicine.id);
    if (avail <= 0) {
      toast.error(`${medicine.name} shows 0 in stock.`);
    } else if (existing && existing.quantity >= avail) {
      toast.error(`Only ${avail} of ${medicine.name} available.`);
    } else if (existing) {
      setLines((c) => c.map((l) => (l.medicine.id === medicine.id ? withQuantity(l, l.quantity + 1) : l)));
    } else {
      setLines((c) => [...c, { medicine, quantity: 1 }]);
    }
    setSearchKey((k) => k + 1);
  };

  const updateQty = (id, quantity) => {
    if (quantity < 1) return;
    const line = lines.find((l) => l.medicine.id === id);
    if (!line) return;
    if (quantity > availableOf(line)) {
      toast.error(`Only ${availableOf(line)} of ${line.medicine.name} available.`);
      return;
    }
    setLines((c) => c.map((l) => (l.medicine.id === id ? withQuantity(l, quantity) : l)));
  };
  const updateAmount = (id, value) =>
    setLines((c) => c.map((l) => (l.medicine.id === id ? { ...l, customAmount: value } : l)));
  const resetAmount = (id) =>
    setLines((c) =>
      c.map((l) => {
        if (l.medicine.id !== id) return l;
        const { customAmount, ...rest } = l;
        return rest;
      })
    );
  const removeLine = (id) => setLines((c) => c.filter((l) => l.medicine.id !== id));

  // A product was edited (name, price or stock): refresh every line that uses it.
  const applyUpdatedMedicine = (updated) => {
    setLines((c) =>
      c
        .filter((l) => !(l.medicine.id === updated.id && updated.is_visible === false))
        .map((l) => {
          if (l.medicine.id !== updated.id) return l;
          const medicine = { ...l.medicine, ...updated };
          // A corrected list price replaces any amount typed earlier for this line.
          const priceChanged = Number(l.medicine.unit_price) !== Number(medicine.unit_price);
          if (priceChanged && hasCustomAmount(l)) {
            const { customAmount, ...rest } = l;
            return { ...rest, medicine };
          }
          return { ...l, medicine };
        })
    );
    if (onCatalogChanged) onCatalogChanged();
  };

  const handleMedicineSaved = (updated) => {
    setEditingMed(null);
    applyUpdatedMedicine(updated);
  };

  const subtotal = lines.reduce((sum, l) => sum + lineAmountOf(l), 0);
  const discountValue = Number(discount) || 0;
  const total = Math.max(subtotal - discountValue, 0);
  const originalTotal = sale ? Number(sale.total_amount) : 0;
  const difference = total - originalTotal;

  const handleSave = async () => {
    if (lines.length === 0) {
      toast.error("A sale needs at least one item");
      return;
    }
    const bad = lines.find(isInvalidCustomAmount);
    if (bad) {
      toast.error(`Enter a valid amount for ${bad.medicine.name}`);
      return;
    }
    if (!reason.trim()) {
      toast.error("Enter the reason for this correction");
      return;
    }
    setSaving(true);
    try {
      const updated = await amendOTCSale(sale.id, {
        customer_name: customerName,
        customer_phone: customerPhone,
        discount: discountValue,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        amount_paid: amountPaid === "" ? total : Number(amountPaid),
        reason: reason.trim(),
        items: lines.map((l) => ({
          medicine: l.medicine.id,
          quantity: l.quantity,
          ...(hasCustomAmount(l) ? { line_amount: lineAmountOf(l) } : {}),
        })),
      });
      onSaved(updated);
    } catch (err) {
      toast.error(err.message || "Failed to correct the sale");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="modal-overlay">
      <div className="modal" style={{ width: "min(760px, 96vw)", maxWidth: "96vw" }}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{sale ? `Correct sale ${sale.sale_number}` : "Edit a sale"}</h3>
            <p className="modal-desc">
              {sale
                ? `Originally ${cur} ${originalTotal.toLocaleString()} · ${formatDateTime(sale.sold_at)}`
                : "Find the sale that was entered wrongly"}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {!sale ? (
            <>
              <input
                className="input"
                placeholder="Search by receipt no, customer name or phone..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              <div style={{ marginTop: "var(--space-3)" }}>
                {loadingSales ? (
                  <p className="text-xs text-faint">Loading sales...</p>
                ) : sales.length === 0 ? (
                  <p className="text-xs text-faint">No sales found.</p>
                ) : (
                  sales.map((s) => (
                    <div
                      key={s.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "10px 0",
                        borderBottom: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {s.sale_number}
                          {s.amended_at && (
                            <span className="text-xs text-faint" style={{ marginLeft: 6 }}>
                              (corrected)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-faint">
                          {s.customer_name || "Walk-in Customer"} &middot; {formatDateTime(s.sold_at)} &middot;{" "}
                          {(s.items || []).length} item{(s.items || []).length !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="font-mono text-sm">{cur} {Number(s.total_amount).toLocaleString()}</span>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => selectSale(s)}>
                          Edit
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <ProductSearch
                key={searchKey}
                id="amend_medicine_search"
                label={`Add / replace a product`}
                placeholder={`Search the correct product...`}
                onSelect={addMedicine}
                onProductUpdated={applyUpdatedMedicine}
                onProductCreated={onCatalogChanged}
                renderOption={(medicine) => (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)" }}>
                    <span className="font-medium truncate">{medicine.name}</span>
                    <span className="font-mono text-sm flex-shrink-0">
                      {cur} {Number(medicine.unit_price).toLocaleString()}
                    </span>
                  </div>
                )}
              />

              <div style={{ marginTop: "var(--space-3)" }}>
                {lines.length === 0 ? (
                  <p className="text-xs text-faint">No items. Search a product above to add one.</p>
                ) : (
                  lines.map((line) => {
                    const custom = hasCustomAmount(line);
                    const invalid = isInvalidCustomAmount(line);
                    return (
                      <div
                        key={line.medicine.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 8,
                          padding: "8px 0",
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        <ProductImg product={line.medicine} className="wis-thumb wis-thumb--sm" />
                        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{line.medicine.name}</span>
                            {canEditMedicine && (
                              <button
                                type="button"
                                className="wis-link-edit"
                                title="Edit name, price or stock"
                                onClick={() => setEditingMed(line.medicine)}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          <div className="wis-cart-row__stock">
                            Available: {availableOf(line)} &middot; List price: {cur}{" "}
                            {Number(line.medicine.unit_price).toLocaleString()}
                          </div>
                        </div>
                        <div className="wis-stepper" style={{ height: 28 }}>
                          <button type="button" onClick={() => updateQty(line.medicine.id, line.quantity - 1)} style={{ width: 24, height: 24 }}>
                            <i className="bi bi-dash" style={{ fontSize: 12 }}></i>
                          </button>
                          <span style={{ width: 24, fontSize: 12 }}>{line.quantity}</span>
                          <button type="button" onClick={() => updateQty(line.medicine.id, line.quantity + 1)} style={{ width: 24, height: 24 }}>
                            <i className="bi bi-plus" style={{ fontSize: 12 }}></i>
                          </button>
                        </div>
                        <div className="wis-amount">
                          <span className="wis-amount__label">{cur}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            className={`input wis-amount__input ${custom ? "is-custom" : ""} ${invalid ? "is-invalid" : ""}`}
                            value={custom ? line.customAmount : listAmountOf(line)}
                            onChange={(e) => updateAmount(line.medicine.id, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            aria-label={`Amount for ${line.medicine.name}`}
                          />
                          {custom && (
                            <button
                              type="button"
                              className="wis-amount__reset"
                              title={`Reset to list price (${cur} ${listAmountOf(line).toLocaleString()})`}
                              onClick={() => resetAmount(line.medicine.id)}
                            >
                              <i className="bi bi-arrow-counterclockwise" style={{ fontSize: 12 }}></i>
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          style={{ background: "none", border: "none", color: "var(--danger-strong)", cursor: "pointer", padding: 4 }}
                          onClick={() => removeLine(line.medicine.id)}
                          title="Remove this item"
                        >
                          <i className="bi bi-x-lg" style={{ fontSize: 12 }}></i>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
                <div className="field">
                  <label className="field-label">Customer name</label>
                  <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Customer phone</label>
                  <input className="input" type="tel" inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Discount ({cur})</label>
                  <input type="number" inputMode="decimal" min="0" step="0.01" className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Payment method</label>
                  <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                {paymentMethod !== "CASH" && (
                  <div className="field">
                    <label className="field-label">{paymentMethod === "MPESA" ? "M-Pesa code" : "Card auth reference"}</label>
                    <input className="input" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
                  </div>
                )}
                <div className="field">
                  <label className="field-label">Amount paid ({cur})</label>
                  <input type="number" inputMode="decimal" min="0" step="0.01" className="input" placeholder={total.toFixed(2)} value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
                </div>
              </div>

              <div className="field">
                <label className="field-label">Reason for the correction (required)</label>
                <input
                  className="input"
                  placeholder="e.g. Wrong item selected / price entered incorrectly"
                  maxLength={255}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <div className="wis-summary-line wis-summary-line--total">
                <span>New total</span>
                <span className="font-mono">{cur} {total.toLocaleString()}</span>
              </div>
              <div className="text-xs text-faint">
                Was {cur} {originalTotal.toLocaleString()}
                {difference !== 0 && (
                  <>
                    {" "}&middot; {difference > 0 ? "+" : "−"}{cur} {Math.abs(difference).toLocaleString()}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {sale ? (
            <>
              <button type="button" className="btn btn-outline" onClick={() => setSale(null)} disabled={saving}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || lines.length === 0}>
                {saving ? "Saving..." : "Save correction"}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>

    {editingMed && (
      <div style={{ position: "relative", zIndex: 1100 }}>
        <ProductEditModal
          medicine={editingMed}
          onClose={() => setEditingMed(null)}
          onSaved={handleMedicineSaved}
        />
      </div>
    )}
    </>
  );
}

export default function WalkInSale() {
  const profile = useShopProfile();
  const cur = profile.currency;

  // Changing this key clears the ProductSearch box after an item is added to the cart.
  const [searchKey, setSearchKey] = useState(0);

  // Every visible product, loaded once (no pagination) for the tap-to-add grid.
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);

  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Mobile only: is the cart / checkout bottom sheet open?
  const [cartOpen, setCartOpen] = useState(false);

  // "Edit a sale" window (correct a sale that was already processed).
  const [amendOpen, setAmendOpen] = useState(false);

  // Edit / add product (same rights as the ProductSearch dropdown).
  const canEditMedicine = useCanEditProduct();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  const loadCatalog = async () => {
    setCatalogLoading(true);
    try {
      // Empty query = browse mode: the autocomplete endpoint returns every
      // visible product A-Z, unpaginated.
      const data = await searchMedicines("");
      setCatalog(toArray(data));
    } catch (err) {
      toast.error(err.message || "Failed to load the product catalog");
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  // Stop the page behind the sheet from scrolling while it is open on a phone.
  useEffect(() => {
    if (!cartOpen) return undefined;
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    if (!isMobile) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [cartOpen]);

  // Keeps the cart in sync when a product is edited (price, name, stock, hidden).
  const syncUpdatedMedicine = (updated) => {
    setCart((current) =>
      current
        .filter((item) => !(item.medicine.id === updated.id && updated.is_visible === false))
        .map((item) => {
          if (item.medicine.id !== updated.id) return item;
          const medicine = { ...item.medicine, ...updated };
          const max = Number(medicine.current_stock);
          const quantity =
            Number.isFinite(max) && max > 0 ? Math.min(item.quantity, max) : item.quantity;
          // If the list price was corrected, drop any old typed amount so the new price applies.
          const priceChanged = Number(item.medicine.unit_price) !== Number(medicine.unit_price);
          if (priceChanged && hasCustomAmount(item)) {
            const { customAmount, ...rest } = item;
            return { ...rest, medicine, quantity };
          }
          return { ...item, medicine, quantity };
        })
    );
    loadCatalog();
  };

  const handleMedicineSaved = (updated) => {
    setEditing(null);
    syncUpdatedMedicine(updated);
  };

  const handleMedicineCreated = (created) => {
    setAdding(false);
    toast.success(`${created.name} added`);
    loadCatalog();
  };

  const addToCart = (medicine) => {
    const stock = Number(medicine.current_stock);
    if (!(stock > 0)) {
      toast.error(`${medicine.name} shows 0 in stock. Click "Edit" to correct the stock.`);
      return;
    }
    const existing = cart.find((item) => item.medicine.id === medicine.id);
    if (existing && existing.quantity >= stock) {
      toast.error(`Only ${stock} of ${medicine.name} in stock. If that's wrong, click "Edit" to correct it.`);
      return;
    }
    setCart((current) => {
      const found = current.find((item) => item.medicine.id === medicine.id);
      if (found) {
        return current.map((item) =>
          item.medicine.id === medicine.id ? withQuantity(item, item.quantity + 1) : item
        );
      }
      return [...current, { medicine, quantity: 1 }];
    });
  };

  // Called by ProductSearch when a product is picked from the dropdown
  // (or when a barcode scanner finishes a scan).
  const handleMedicineSelect = (medicine) => {
    if (Number(medicine.current_stock) <= 0) {
      toast.error(`${medicine.name} is out of stock`);
    } else {
      addToCart(medicine);
    }
    setSearchKey((k) => k + 1); // clear the search box, ready for the next item
  };

  const updateQuantity = (medicineId, quantity) => {
    if (quantity < 1) return;
    const target = cart.find((item) => item.medicine.id === medicineId);
    if (!target) return;
    const max = Number(target.medicine.current_stock);
    if (Number.isFinite(max) && quantity > max) {
      toast.error(`Only ${max} of ${target.medicine.name} in stock. If that's wrong, click "Edit" to correct it.`);
      return;
    }
    setCart((current) =>
      current.map((item) => (item.medicine.id === medicineId ? withQuantity(item, quantity) : item))
    );
  };

  // Cashier types a new line total (e.g. 60 -> 100).
  const updateLineAmount = (medicineId, value) => {
    setCart((current) =>
      current.map((item) =>
        item.medicine.id === medicineId ? { ...item, customAmount: value } : item
      )
    );
  };

  // Go back to the normal list price for this line.
  const resetLineAmount = (medicineId) => {
    setCart((current) =>
      current.map((item) => {
        if (item.medicine.id !== medicineId) return item;
        const { customAmount, ...rest } = item;
        return rest;
      })
    );
  };

  const removeFromCart = (medicineId) => {
    setCart((current) => {
      const next = current.filter((item) => item.medicine.id !== medicineId);
      // Nothing left to show in the mobile sheet — close it.
      if (next.length === 0) setCartOpen(false);
      return next;
    });
  };

  // Subtotal uses the cashier's edited amounts where present.
  const subtotal = cart.reduce((sum, item) => sum + lineAmountOf(item), 0);
  const discountValue = Number(discount) || 0;
  const total = Math.max(subtotal - discountValue, 0);

  // Total units in the cart + quantity per product (for the badge on each card).
  const cartUnits = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartQtyById = cart.reduce((map, item) => {
    map[item.medicine.id] = item.quantity;
    return map;
  }, {});

  const resetSale = () => {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setDiscount("0");
    setPaymentMethod("CASH");
    setReferenceNumber("");
    setAmountPaid("");
    setCartOpen(false);
  };

  const handleCompleteSale = async (e) => {
    e.preventDefault();
    if (cart.length === 0) {
      toast.error("Add at least one item to the cart");
      return;
    }

    const badLine = cart.find(isInvalidCustomAmount);
    if (badLine) {
      toast.error(`Enter a valid amount for ${badLine.medicine.name}`);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        customer_name: customerName,
        customer_phone: customerPhone,
        discount: discountValue,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        amount_paid: amountPaid === "" ? total : Number(amountPaid),
        items: cart.map((item) => ({
          medicine: item.medicine.id,
          quantity: item.quantity,
          // Only sent when the cashier changed the amount; otherwise the backend uses the list price.
          ...(hasCustomAmount(item) ? { line_amount: lineAmountOf(item) } : {}),
        })),
      };
      const sale = await createOTCSale(payload);
      toast.success(`Sale ${sale.sale_number} completed`);
      // Attach a browser-generated QR so it shows in the preview and the PDF.
      setReceipt({ ...sale, qr_code: await resolveReceiptQr(sale) });
      resetSale();
      loadCatalog();
    } catch (err) {
      toast.error(err.message || "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaleAmended = async (updated) => {
    setAmendOpen(false);
    toast.success(`Sale ${updated.sale_number} corrected`);
    // opens the receipt window so the right figures can be printed
    setReceipt({ ...updated, qr_code: await resolveReceiptQr(updated) });
    loadCatalog();
  };

  const handlePrintReceipt = async () => {
    if (!receipt || printing) return;
    setPrinting(true);
    try {
      await printReceiptPdf(receipt, profile);
    } catch (err) {
      toast.error("Could not prepare the receipt for printing");
    } finally {
      setPrinting(false);
    }
  };

  const handleDownloadReceipt = async () => {
    if (!receipt || downloading) return;
    setDownloading(true);
    try {
      await downloadReceiptPdf(receipt, profile);
    } catch (err) {
      toast.error("Could not generate the receipt PDF");
    } finally {
      setDownloading(false);
    }
  };

  const stockBadgeClass = (medicine) => {
    if (medicine.current_stock <= 0) return "wis-catalog__stock--out";
    if (medicine.is_low_stock) return "wis-catalog__stock--low";
    return "wis-catalog__stock--ok";
  };

  return (
    <div className="wis-root">
      <WalkInSaleStyles />

      <div className="page-header">
        <div>
          <div className="page-eyebrow">{profile.businessLabel}</div>
          <h1 className="page-title">Walk-in Sale / POS</h1>
          <p className="page-subtitle">
            {profile.isPharmacy
              ? "Sell products directly over the counter "
              : `Ring up walk-in sales fast — scan a barcode or tap a product to add it`}
          </p>
        </div>
        <div>
          <button type="button" className="btn btn-outline" onClick={() => setAmendOpen(true)}>
            <i className="bi bi-pencil-square" style={{ marginRight: "var(--space-2)" }}></i>
            Edit a sale
          </button>
        </div>
      </div>

      <div className="grid-8-4">
        {/* Left Column - 8 columns: Product Selection */}
        <div className="grid-8-4__main">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Find Product</h2>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span className="text-xs text-faint">
                  {catalogLoading ? "Loading catalog..." : `${catalog.length} item${catalog.length !== 1 ? "s" : ""}`}
                </span>
                {canEditMedicine && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>
                    <i className="bi bi-plus-lg" style={{ marginRight: "var(--space-1)" }}></i>
                    Add new product
                  </button>
                )}
              </div>
            </div>
            <div className="card-body">
              <ProductSearch
                key={searchKey}
                id="walkin_medicine_search"
                label={`Search product`}
                placeholder={`Scan a barcode, click to browse or type a product name...`}
                onSelect={handleMedicineSelect}
                onProductUpdated={syncUpdatedMedicine}
                onProductCreated={loadCatalog}
                renderOption={(medicine) => (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "var(--space-3)",
                      opacity: Number(medicine.current_stock) <= 0 ? 0.5 : 1,
                    }}
                  >
                    <ProductImg product={medicine} className="wis-thumb wis-thumb--sm" />
                    <div className="min-w-0" style={{ flex: 1 }}>
                      <div className="font-medium truncate">{medicine.name}</div>
                      <div className="text-2xs text-faint truncate">
                        {medicine.generic_name || medicine.barcode || "—"} &middot;{" "}
                        {Number(medicine.current_stock) <= 0
                          ? "Out of stock"
                          : `${medicine.current_stock} ${medicine.unit}${medicine.current_stock !== 1 ? "s" : ""} in stock`}
                      </div>
                    </div>
                    <span className="font-mono text-sm flex-shrink-0">
                      {cur} {Number(medicine.unit_price).toLocaleString()}
                    </span>
                  </div>
                )}
              />

              {catalogLoading ? (
                <p className="text-xs text-faint mt-3">Loading products...</p>
              ) : catalog.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state__icon">
                    <i className={`bi ${profile.icon}`} style={{ fontSize: "1.25rem" }}></i>
                  </div>
                  <div className="empty-state__title">No products in catalog</div>
                  <div className="empty-state__desc">Add products under Stock &middot; Inventory first.</div>
                </div>
              ) : (
                <div className="wis-catalog mt-3">
                  {catalog.map((medicine) => {
                    const qtyInCart = cartQtyById[medicine.id] || 0;
                    return (
                      <div className="wis-catalog__item" key={medicine.id}>
                        <button
                          type="button"
                          className={`wis-catalog__card ${qtyInCart > 0 ? "is-in-cart" : ""}`}
                          onClick={() => addToCart(medicine)}
                          disabled={medicine.current_stock <= 0}
                          title={medicine.current_stock <= 0 ? "Out of stock" : `Add ${medicine.name} to cart`}
                        >
                          <ProductImg product={medicine} className="wis-catalog__img" />
                          <span className="wis-catalog__name">{medicine.name}</span>
                          <span className="wis-catalog__price">
                            {cur} {Number(medicine.unit_price).toLocaleString()}
                          </span>
                          <span className={`wis-catalog__stock ${stockBadgeClass(medicine)}`}>
                            {medicine.current_stock <= 0
                              ? "Out of stock"
                              : `${medicine.current_stock} ${medicine.unit}${medicine.current_stock !== 1 ? "s" : ""}`}
                          </span>
                        </button>
                        {qtyInCart > 0 && <span className="wis-catalog__qty">{qtyInCart}</span>}
                        {canEditMedicine && (
                          <button
                            type="button"
                            className="wis-link-edit wis-catalog__edit"
                            title="Edit name, price or stock"
                            onClick={() => setEditing(medicine)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile only: dark backdrop behind the bottom sheet */}
        <div
          className={`wis-backdrop ${cartOpen ? "is-open" : ""}`}
          onClick={() => setCartOpen(false)}
        />

        {/* Right Column - 4 columns: Cart + Order Summary
            (on phones this becomes a bottom sheet opened from the sticky bar) */}
        <div className={`grid-4-8__sidebar wis-sidebar ${cartOpen ? "is-open" : ""}`}>
          <div className="wis-sheet-header">
            <h2 className="wis-sheet-title">
              Cart &amp; Checkout
              {cartUnits > 0 && <span className="text-xs text-faint"> · {cartUnits} unit{cartUnits !== 1 ? "s" : ""}</span>}
            </h2>
            <button type="button" className="wis-sheet-close" onClick={() => setCartOpen(false)} aria-label="Close cart">
              <i className="bi bi-x-lg"></i>
            </button>
          </div>

          {/* Cart Section */}
          <div className="card" style={{ marginBottom: "var(--space-4)" }}>
            <div className="card-header">
              <h2 className="card-title">Cart</h2>
              <span className="text-xs text-faint">
                {cart.length} item{cart.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="card-body p-0">
              {cart.length === 0 ? (
                <div className="empty-state" style={{ padding: "var(--space-4)" }}>
                  <div className="empty-state__icon">
                    <i className="bi bi-cart" style={{ fontSize: "1.25rem" }}></i>
                  </div>
                  <div className="empty-state__title" style={{ fontSize: "14px" }}>Cart is empty</div>
                  <div className="empty-state__desc" style={{ fontSize: "12px" }}>Tap a product or scan a barcode to add it.</div>
                </div>
              ) : (
                <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                  {cart.map((item) => {
                    const custom = hasCustomAmount(item);
                    const invalid = isInvalidCustomAmount(item);
                    return (
                      <div
                        key={item.medicine.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "var(--space-2)",
                          padding: "var(--space-2) var(--space-3)",
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        <ProductImg product={item.medicine} className="wis-thumb" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="wis-cart-row__name">
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: 500,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.medicine.name}
                            </span>
                            {canEditMedicine && (
                              <button
                                type="button"
                                className="wis-link-edit"
                                title="Edit name, price or stock"
                                onClick={() => setEditing(item.medicine)}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          <div
                            className={`wis-cart-row__stock ${
                              item.quantity >= Number(item.medicine.current_stock) ? "is-over" : ""
                            }`}
                          >
                            In stock: {Number(item.medicine.current_stock)} &middot; List price: {cur}{" "}
                            {Number(item.medicine.unit_price).toLocaleString()}
                          </div>
                          <div className="wis-cart-row__controls">
                            <div className="wis-stepper" style={{ height: "28px" }}>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.medicine.id, item.quantity - 1)}
                                style={{ width: "24px", height: "24px" }}
                              >
                                <i className="bi bi-dash" style={{ fontSize: "12px" }}></i>
                              </button>
                              <span style={{ width: "24px", fontSize: "12px" }}>{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.medicine.id, item.quantity + 1)}
                                style={{ width: "24px", height: "24px" }}
                              >
                                <i className="bi bi-plus" style={{ fontSize: "12px" }}></i>
                              </button>
                            </div>

                            {/* Editable line amount: type 100 instead of the list price 60 */}
                            <div className="wis-amount">
                              <span className="wis-amount__label">{cur}</span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                className={`input wis-amount__input ${custom ? "is-custom" : ""} ${invalid ? "is-invalid" : ""}`}
                                value={custom ? item.customAmount : listAmountOf(item)}
                                onChange={(e) => updateLineAmount(item.medicine.id, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                aria-label={`Amount for ${item.medicine.name}`}
                              />
                              {custom && (
                                <button
                                  type="button"
                                  className="wis-amount__reset"
                                  title={`Reset to list price (${cur} ${listAmountOf(item).toLocaleString()})`}
                                  onClick={() => resetLineAmount(item.medicine.id)}
                                >
                                  <i className="bi bi-arrow-counterclockwise" style={{ fontSize: "12px" }}></i>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="wis-cart-remove"
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--danger-strong)",
                            cursor: "pointer",
                            padding: "4px",
                          }}
                          onClick={() => removeFromCart(item.medicine.id)}
                        >
                          <i className="bi bi-x-lg" style={{ fontSize: "12px" }}></i>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Order Summary Section */}
          <form className="card" onSubmit={handleCompleteSale}>
            <div className="card-header">
              <h2 className="card-title">Order Summary</h2>
            </div>
            <div className="card-body">
              <div className="field">
                <label className="field-label">Customer name (optional)</label>
                <input
                  className="input"
                  placeholder="Walk-in customer"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label">Customer phone (optional)</label>
                <input
                  className="input"
                  type="tel"
                  inputMode="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
              </div>

              <div className="wis-summary-line">
                <span className="text-muted">Subtotal</span>
                <span className="font-mono">{cur} {subtotal.toLocaleString()}</span>
              </div>

              <div className="field">
                <label className="field-label">Discount ({cur})</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="input"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>

              <div className="wis-summary-line wis-summary-line--total">
                <span>Total</span>
                <span className="font-mono">{cur} {total.toLocaleString()}</span>
              </div>

              <div className="field">
                <label className="field-label">Payment method</label>
                <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {paymentMethod !== "CASH" && (
                <div className="field">
                  <label className="field-label">
                    {paymentMethod === "MPESA" ? "M-Pesa code" : "Card auth reference"}
                  </label>
                  <input className="input" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
                </div>
              )}

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Amount paid ({cur})</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="input"
                  placeholder={total.toFixed(2)}
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                />
              </div>
            </div>
            <div className="card-footer" style={{ display: "block" }}>
              <button type="submit" className="btn btn-primary btn-block" disabled={submitting || cart.length === 0}>
                {submitting ? "Processing..." : `Complete Sale — ${cur} ${total.toLocaleString()}`}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Mobile only: sticky bar — always shows what's in the cart, one tap to checkout */}
      {cart.length > 0 && (
        <div className={`wis-bar ${cartOpen ? "is-hidden" : ""}`}>
          <button type="button" className="wis-bar__btn" onClick={() => setCartOpen(true)}>
            <span className="wis-bar__left">
              <span className="wis-bar__count" key={cartUnits}>{cartUnits}</span>
              <span>View cart &amp; checkout</span>
            </span>
            <span className="wis-bar__total">{cur} {total.toLocaleString()}</span>
          </button>
        </div>
      )}

      {amendOpen && (
        <AmendSaleModal
          catalog={catalog}
          canEditMedicine={canEditMedicine}
          onCatalogChanged={loadCatalog}
          onClose={() => setAmendOpen(false)}
          onSaved={handleSaleAmended}
        />
      )}

      {editing && (
        <ProductEditModal
          medicine={editing}
          onClose={() => setEditing(null)}
          onSaved={handleMedicineSaved}
        />
      )}

      {adding && (
        <ProductAddModal
          initialName=""
          onClose={() => setAdding(false)}
          onCreated={handleMedicineCreated}
        />
      )}

      {receipt && (
        <ReceiptModal
          receipt={receipt}
          onClose={() => setReceipt(null)}
          onPrint={handlePrintReceipt}
          onDownload={handleDownloadReceipt}
          printing={printing}
          downloading={downloading}
        />
      )}
    </div>
  );
}