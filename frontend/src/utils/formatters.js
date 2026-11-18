// src/utils/formatters.js  - skip this file if your HMIS copy already has these.
export const formatCurrency = (n, currency = "KES") =>
  `${currency} ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "-";

export const formatDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-KE", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "-";
