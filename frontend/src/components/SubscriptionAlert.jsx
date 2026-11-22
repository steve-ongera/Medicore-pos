// src/components/SubscriptionAlert.jsx
//
// "Upgrade" pop-up, mounted once in DashboardLayout.
//
// When it shows:
//   - once, as soon as a bundle expires, ends soon, or the sales credits run low;
//   - again when things get worse (warning -> critical, or credits run out);
//   - then as a reminder after it was closed: every 3 minutes when critical, every 10 when a warning.
// It never shows on the walk-in sale page, so it cannot get in the way of a customer being served;
// the navbar battery stays visible there. Being closed is remembered for the browser session,
// so a page refresh does not bring it straight back.
// The thresholds live in utils/subscriptionStatus.js (shared with the navbar battery).
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { evaluateSubscription, refreshSubscription, useSubscription } from "../utils/subscriptionStatus";

// ---- Tune these ------------------------------------------------------------
const CONFIG = {
  repeatMs: { critical: 3 * 60 * 1000, warning: 10 * 60 * 1000 }, // reminder after it was closed
  tickMs: 15 * 1000, // refresh the "ends in ..." text
  hideOn: ["/subscriptions", "/wallet", "/billing/walk-in-sale"], // pages where it stays quiet
};
// ----------------------------------------------------------------------------

const STORAGE_KEY = "sub_alert_closed";

const readClosed = () => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || { sig: "", until: 0 };
  } catch {
    return { sig: "", until: 0 };
  }
};
const writeClosed = (value) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage blocked: it just comes back on the next check */
  }
};

export default function SubscriptionAlert() {
  const { pathname } = useLocation();
  const sub = useSubscription();
  const [now, setNow] = useState(Date.now());
  const [closed, setClosed] = useState(readClosed);

  // Re-read on every page change, on top of the shared poll.
  useEffect(() => {
    refreshSubscription();
  }, [pathname]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CONFIG.tickMs);
    return () => clearInterval(t);
  }, []);

  const issues = useMemo(() => evaluateSubscription(sub, now), [sub, now]);
  const sig = issues.map((i) => i.key).join("|");
  const level = issues.some((i) => i.level === "critical") ? "critical" : "warning";
  const quietHere = CONFIG.hideOn.some((p) => pathname.startsWith(p));

  // Wake up exactly when the "closed" period ends, so the reminder comes on time.
  useEffect(() => {
    const wait = closed.until - Date.now();
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setNow(Date.now()), wait + 25);
    return () => clearTimeout(t);
  }, [closed]);

  const visible = issues.length > 0 && !quietHere && (closed.sig !== sig || now >= closed.until);

  const close = () => {
    const value = { sig, until: Date.now() + CONFIG.repeatMs[level] };
    writeClosed(value);
    setClosed(value);
  };

  if (!visible) return null;

  const bar = issues.find((i) => i.pct !== undefined);
  const critical = level === "critical";

  return (
    <>
      <style>{`
        .sub-alert {
          position: fixed;
          top: 72px;
          right: 16px;
          z-index: 1200;
          width: min(340px, calc(100vw - 24px));
          padding: 16px;
          border-radius: 14px;
          background: var(--surface, #fff);
          color: var(--text-primary, #111827);
          border: 1px solid var(--border-subtle, #e5e7eb);
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.2);
          animation: sub-alert-in 0.25s ease;
        }
        @keyframes sub-alert-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .sub-alert__top {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }
        .sub-alert__icon {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          font-size: 1.05rem;
          background: #fef3c7;
          color: #b45309;
        }
        .sub-alert.is-critical .sub-alert__icon {
          background: #fee2e2;
          color: #b91c1c;
        }
        .sub-alert__body {
          flex: 1;
          min-width: 0;
        }
        .sub-alert__title {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 700;
        }
        .sub-alert__text {
          margin: 4px 0 0;
          font-size: 0.85rem;
          line-height: 1.4;
          color: var(--text-secondary, #4b5563);
        }
        .sub-alert__close {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          display: grid;
          place-items: center;
          border: none;
          border-radius: 50%;
          background: transparent;
          color: var(--text-secondary, #6b7280);
          cursor: pointer;
        }
        .sub-alert__close:hover {
          background: var(--surface-hover, #f3f4f6);
        }
        .sub-alert__bar {
          height: 6px;
          margin-top: 12px;
          border-radius: 999px;
          overflow: hidden;
          background: var(--border-subtle, #e5e7eb);
        }
        .sub-alert__bar > span {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: #d97706;
        }
        .sub-alert.is-critical .sub-alert__bar > span {
          background: #dc2626;
        }
        .sub-alert__cta {
          width: 100%;
          min-height: 40px;
          margin-top: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
        }
        @media (max-width: 900px) {
          .sub-alert {
            top: 64px;
            left: 12px;
            right: 12px;
            width: auto;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sub-alert { animation: none; }
        }
      `}</style>

      <div className={`sub-alert ${critical ? "is-critical" : ""}`} role="alert">
        <div className="sub-alert__top">
          <span className="sub-alert__icon" aria-hidden="true">
            <i className={`bi ${critical ? "bi-exclamation-octagon-fill" : "bi-exclamation-triangle-fill"}`} />
          </span>

          <div className="sub-alert__body">
            <h3 className="sub-alert__title">
              {critical ? "Upgrade to keep selling" : "Your bundle is running low"}
            </h3>
            {issues.map((i) => (
              <p key={i.key} className="sub-alert__text">
                {i.text}
              </p>
            ))}
          </div>

          <button type="button" className="sub-alert__close" onClick={close} aria-label="Close">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        {bar && (
          <div className="sub-alert__bar" aria-hidden="true">
            <span style={{ width: `${Math.max(Math.min(bar.pct, 100), 3)}%` }} />
          </div>
        )}

        <Link to="/subscriptions" className="btn btn-primary sub-alert__cta" onClick={close}>
          Upgrade now
        </Link>
      </div>
    </>
  );
}