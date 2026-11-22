// src/components/SubscriptionBattery.jsx
//
// Navbar battery:
//   - bundles with a sales limit  -> shows the % of sales left
//   - unlimited-sales bundles     -> shows the time left (days), with a bolt while it is healthy
// Green = fine, amber = running low, red = critical (pulses). Click it for the details
// and a link to the subscription page.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getBattery, timeLeftText, useSubscription } from "../utils/subscriptionStatus";

const COLORS = { ok: "#16a34a", warning: "#d97706", critical: "#dc2626" };
const FILL_MAX = 17.5; // width of the inner bar when the battery is full

const MESSAGE = {
  ok: "Everything is in order.",
  warning: "Running low. Upgrade soon to avoid interruption.",
  critical: "Upgrade now to keep selling.",
};

function BatteryIcon({ pct, showBolt }) {
  const fill = pct <= 0 ? 0 : Math.max((FILL_MAX * pct) / 100, 2);
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
      <rect x="0.75" y="0.75" width="21.5" height="12.5" rx="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="23.5" y="4.5" width="2" height="5" rx="1" fill="currentColor" />
      <rect x="2.75" y="2.75" width={fill} height="8.5" rx="1.5" fill="currentColor" />
      {showBolt && <path d="M12.8 2.6 8.6 7.5h2.8l-.9 3.9 4.2-4.9h-2.8z" fill="var(--surface, #fff)" />}
    </svg>
  );
}

export default function SubscriptionBattery() {
  const { pathname } = useLocation();
  const sub = useSubscription();
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const key = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const b = getBattery(sub, now);
  if (!b) return null;

  const color = COLORS[b.level];
  const showBolt = b.unlimited && b.level === "ok"; // "charging" look for a healthy unlimited bundle
  const title =
    b.mode === "expired"
      ? "Bundle expired"
      : b.mode === "time"
      ? `Unlimited sales · ${timeLeftText(b.msLeft)} left`
      : b.salesTotal > 0
      ? `${b.salesLeft} of ${b.salesTotal} sales left (${b.pct}%)`
      : `${b.salesLeft} sales left`;

  return (
    <div className="sub-battery" ref={ref}>
      <style>{`
        .sub-battery {
          position: relative;
        }
        .sub-battery__btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 36px;
          padding: 0 10px;
          border: none;
          border-radius: 10px;
          background: transparent;
          cursor: pointer;
          font-size: 0.8rem;
          font-weight: 600;
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .sub-battery__btn:hover,
        .sub-battery__btn[aria-expanded="true"] {
          background: var(--surface-hover, #f3f4f6);
        }
        .sub-battery__btn.is-critical svg {
          animation: sub-battery-pulse 1.1s ease-in-out infinite;
        }
        @keyframes sub-battery-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .sub-battery__pop {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 1100;
          width: 290px;
          padding: 14px;
          border-radius: 14px;
          background: var(--surface, #fff);
          color: var(--text-primary, #111827);
          border: 1px solid var(--border-subtle, #e5e7eb);
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.2);
        }
        .sub-battery__plan {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 700;
        }
        .sub-battery__msg {
          margin: 2px 0 12px;
          font-size: 0.8rem;
          color: var(--text-secondary, #4b5563);
        }
        .sub-battery__bar {
          height: 6px;
          margin-bottom: 12px;
          border-radius: 999px;
          overflow: hidden;
          background: var(--border-subtle, #e5e7eb);
        }
        .sub-battery__bar > span {
          display: block;
          height: 100%;
          border-radius: inherit;
        }
        .sub-battery__row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 5px 0;
          font-size: 0.82rem;
        }
        .sub-battery__row > span:first-child {
          color: var(--text-secondary, #6b7280);
        }
        .sub-battery__row > span:last-child {
          text-align: right;
          font-weight: 600;
        }
        .sub-battery__link {
          display: inline-block;
          margin-top: 12px;
          font-size: 0.82rem;
          font-weight: 500;
          color: var(--brand, #2563eb);
          text-decoration: underline;
        }
        .sub-battery__link:hover {
          opacity: 0.75;
        }
        @media (max-width: 640px) {
          .sub-battery__btn { padding: 0 6px; }
          .sub-battery__pop {
            position: fixed;
            top: 64px;
            left: 12px;
            right: 12px;
            width: auto;
          }
        }
        @media (max-width: 480px) {
          .sub-battery__label { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sub-battery__btn.is-critical svg { animation: none; }
        }
      `}</style>

      <button
        type="button"
        className={`sub-battery__btn ${b.level === "critical" ? "is-critical" : ""}`}
        style={{ color }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Subscription: ${title}`}
        title={title}
      >
        <BatteryIcon pct={b.pct} showBolt={showBolt} />
        <span className="sub-battery__label">{b.label}</span>
      </button>

      {open && (
        <div className="sub-battery__pop" role="dialog" aria-label="Subscription details">
          <h3 className="sub-battery__plan">{b.mode === "expired" ? "No active bundle" : b.planLabel}</h3>
          <p className="sub-battery__msg">{MESSAGE[b.level]}</p>

          <div className="sub-battery__bar" aria-hidden="true">
            <span style={{ width: `${Math.max(b.pct, b.pct > 0 ? 3 : 0)}%`, background: color }} />
          </div>

          <div className="sub-battery__row">
            <span>Sales left</span>
            <span>
              {b.unlimited
                ? "Unlimited"
                : b.salesTotal > 0
                ? `${b.salesLeft} of ${b.salesTotal} (${b.pct}%)`
                : b.salesLeft}
            </span>
          </div>
          <div className="sub-battery__row">
            <span>Time left</span>
            <span>{b.msLeft > 0 ? timeLeftText(b.msLeft) : "Expired"}</span>
          </div>
          {b.endsAt && (
            <div className="sub-battery__row">
              <span>Ends</span>
              <span>
                {new Date(b.endsAt).toLocaleString("en-KE", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })}
              </span>
            </div>
          )}

          <Link to="/subscriptions" className="sub-battery__link">
            View subscription
          </Link>
        </div>
      )}
    </div>
  );
}