// src/utils/subscriptionStatus.js
//
// One shared source of subscription data for the navbar battery and the upgrade
// pop-up: a single poll of /subscription/ for the whole app, refreshed on focus
// and right after a sale is created.
import { useEffect, useState } from "react";
import api, { getSubscription } from "../services/api";

// ---- Thresholds (used by the battery colour AND the pop-up) -----------------
export const THRESHOLDS = {
  lowSalesPct: 20, // warning when this % (or less) of the sales is left
  criticalSalesPct: 10, // critical at this % (or less)
  lowSalesFallback: 10, // if the server sends no total: warn at this many sales left
  maxExpiryWarnMs: 3 * 24 * 3600 * 1000, // warn up to 3 days before the end...
  expiryWarnFraction: 0.25, // ...but not earlier than 25% of the bundle's length
};
const POLL_MS = 60 * 1000;

// ---- Shared store -----------------------------------------------------------
let current = null;
let timer = null;
let interceptorId = null;
const listeners = new Set();

export async function refreshSubscription() {
  try {
    current = await getSubscription();
    listeners.forEach((fn) => fn(current));
  } catch {
    /* offline or signed out: keep the last value, try again on the next poll */
  }
}

function start() {
  refreshSubscription();
  timer = setInterval(refreshSubscription, POLL_MS);
  window.addEventListener("focus", refreshSubscription);
  // After a sale is created, re-read so the count drops on screen straight away.
  interceptorId = api.interceptors.response.use((res) => {
    const url = res?.config?.url || "";
    if (res?.config?.method === "post" && url.includes("/otc-sales/") && !/amend|add-payment/.test(url)) {
      setTimeout(refreshSubscription, 400);
    }
    return res;
  });
}

function stop() {
  clearInterval(timer);
  window.removeEventListener("focus", refreshSubscription);
  if (interceptorId !== null) api.interceptors.response.eject(interceptorId);
  timer = null;
  interceptorId = null;
  current = null; // never show the previous user's data after a sign-out
}

export function useSubscription() {
  const [sub, setSub] = useState(current);
  useEffect(() => {
    listeners.add(setSub);
    if (listeners.size === 1) start();
    else setSub(current);
    return () => {
      listeners.delete(setSub);
      if (listeners.size === 0) stop();
    };
  }, []);
  return sub;
}

// ---- Helpers ----------------------------------------------------------------
export const timeLeftText = (ms) => {
  const mins = Math.max(Math.ceil(ms / 60000), 1);
  if (mins >= 2880) return `${Math.floor(mins / 1440)} days`;
  if (mins >= 120) return `${Math.floor(mins / 60)} hours`;
  if (mins >= 60) return "1 hour";
  return `${mins} minute${mins !== 1 ? "s" : ""}`;
};

// "12 days", "5 hrs", "20 min": always a number AND a unit, for the battery label.
const compactTime = (ms) => {
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days} day${days !== 1 ? "s" : ""}`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours} hr${hours !== 1 ? "s" : ""}`;
  return `${Math.max(Math.ceil(ms / 60000), 1)} min`;
};

const clamp = (n) => Math.max(0, Math.min(100, n));

// Turns the /subscription/ response into a list of problems (empty = all good).
export function evaluateSubscription(sub, nowMs) {
  if (!sub) return [];
  if (!sub.is_active) {
    return [{ key: "expired", level: "critical", text: "Your bundle has expired. Upgrade to keep selling." }];
  }

  const T = THRESHOLDS;
  const issues = [];

  // Sales credits
  if (sub.sales_remaining !== null && sub.sales_remaining !== undefined) {
    const remaining = Number(sub.sales_remaining);
    const total = Number(sub.sales_total);

    if (remaining <= 0) {
      issues.push({ key: "sales-0", level: "critical", text: "You have no sales left. Upgrade to keep selling." });
    } else {
      const pct = total > 0 ? Math.round((remaining / total) * 100) : undefined;
      let level = null;
      if (pct !== undefined) {
        if (pct <= T.criticalSalesPct) level = "critical";
        else if (pct <= T.lowSalesPct) level = "warning";
      } else if (remaining <= T.lowSalesFallback) {
        level = "warning";
      }
      if (level) {
        issues.push({
          key: `sales-${level}`, // changes only when things get worse (warning -> critical)
          level,
          pct,
          text:
            pct !== undefined
              ? `Only ${remaining} of ${total} sales left (${pct}%).`
              : `Only ${remaining} sale${remaining !== 1 ? "s" : ""} left.`,
        });
      }
    }
  }

  // End date
  if (sub.expires_at) {
    const end = new Date(sub.expires_at).getTime();
    const start = sub.started_at ? new Date(sub.started_at).getTime() : 0;
    const msLeft = end - nowMs;
    const threshold = start
      ? Math.min(T.maxExpiryWarnMs, (end - start) * T.expiryWarnFraction)
      : T.maxExpiryWarnMs;
    if (msLeft > 0 && msLeft <= threshold) {
      const level = msLeft <= threshold / 3 ? "critical" : "warning";
      issues.push({ key: `expiry-${level}`, level, text: `Your bundle ends in ${timeLeftText(msLeft)}.` });
    }
  }

  return issues;
}

// What the navbar battery shows.
//   limited sales  -> the battery is the % of sales left
//   unlimited sales -> the battery is the % of the bundle's time left (label = days left)
// `level` is "ok" | "warning" | "critical" and always agrees with the pop-up.
export function getBattery(sub, nowMs) {
  if (!sub) return null;

  const issues = evaluateSubscription(sub, nowMs);
  const level = issues.some((i) => i.level === "critical") ? "critical" : issues.length ? "warning" : "ok";

  if (!sub.is_active) {
    return {
      mode: "expired", pct: 0, label: "Expired", level: "critical", unlimited: false,
      salesLeft: 0, salesTotal: 0, msLeft: 0, endsAt: null, planLabel: sub.plan_label,
    };
  }

  const end = new Date(sub.expires_at).getTime();
  const start = sub.started_at ? new Date(sub.started_at).getTime() : 0;
  const msLeft = Math.max(end - nowMs, 0);
  const length = end - start;
  const timePct = length > 0 ? clamp(Math.round((msLeft / length) * 100)) : 100;

  const unlimited = sub.sales_remaining === null || sub.sales_remaining === undefined;
  const salesLeft = unlimited ? null : Number(sub.sales_remaining);
  const salesTotal = unlimited ? null : Number(sub.sales_total) || 0;

  let pct;
  let label;
  if (unlimited) {
    pct = timePct;
    label = compactTime(msLeft); // "12 days"
  } else {
    pct = salesTotal > 0 ? clamp(Math.round((salesLeft / salesTotal) * 100)) : salesLeft <= 10 ? salesLeft * 10 : 100;
    label = `${salesLeft} sale${salesLeft !== 1 ? "s" : ""}`; // "37 sales"; the fill still shows the %
  }

  return {
    mode: unlimited ? "time" : "sales",
    pct, label, level, unlimited, salesLeft, salesTotal, msLeft, endsAt: end, planLabel: sub.plan_label,
  };
}