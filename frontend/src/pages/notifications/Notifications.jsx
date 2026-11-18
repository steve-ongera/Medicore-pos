// src/pages/notifications/Notifications.jsx
// Full-page inbox for the bell alerts (low stock, expiry, etc.).
// Uses only endpoints that already exist: /notifications/, mark-read, mark-all-read.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../services/api";
import { asList, timeAgo } from "../../utils/timeAgo";
import { notifyUnreadChanged, onUnreadChanged } from "../../utils/unreadEvents";
import "../../styles/messaging.css";

const POLL_MS = 30000;

const PRIORITY = {
  CRITICAL: { label: "Critical", icon: "bi-exclamation-octagon-fill", badge: "badge-danger", key: "critical" },
  HIGH: { label: "High", icon: "bi-exclamation-triangle-fill", badge: "badge-warning", key: "high" },
  NORMAL: { label: "Normal", icon: "bi-info-circle-fill", badge: "badge-primary", key: "normal" },
  LOW: { label: "Low", icon: "bi-dot", badge: "badge-neutral", key: "low" },
};

export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); // all | unread
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async (silent = false) => {
    try {
      setItems(asList(await getNotifications()));
      setError("");
    } catch (e) {
      if (!silent) setError(e.message || "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    const off = onUnreadChanged(() => load(true)); // e.g. the navbar bell marked something read
    return () => { clearInterval(t); off(); };
  }, [load]);

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items]);
  const visible = useMemo(
    () => (filter === "unread" ? items.filter((n) => !n.is_read) : items),
    [items, filter]
  );

  const markRead = async (n) => {
    if (n.is_read) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))); // optimistic
    try {
      await markNotificationRead(n.id);
      notifyUnreadChanged();
    } catch (e) {
      setError(e.message || "Could not mark as read.");
      load(true);
    }
  };

  const openNotification = async (n) => {
    await markRead(n);
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
      notifyUnreadChanged();
    } catch (e) {
      setError(e.message || "Could not mark all as read.");
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">
            {unreadCount > 0
              ? `${unreadCount} unread alert${unreadCount === 1 ? "" : "s"}`
              : "You're all caught up"}
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className={`btn btn-outline${markingAll ? " is-loading" : ""}`}
            onClick={markAll}
            disabled={markingAll || unreadCount === 0}
          >
            <i className="bi bi-check2-all" aria-hidden="true" /> Mark all as read
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger mb-4" role="alert">
          <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
          <div>
            <div className="alert-message">{error}</div>
            <button type="button" className="link-btn mt-1" onClick={() => { setLoading(true); load(); }}>
              Try again
            </button>
          </div>
        </div>
      )}

      <div className="card ntf-card">
        <div className="tabs ntf-tabs" role="tablist" aria-label="Filter notifications">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={`tabs__item${filter === "all" ? " is-active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All <span className="pill-count ml-2">{items.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "unread"}
            className={`tabs__item${filter === "unread" ? " is-active" : ""}`}
            onClick={() => setFilter("unread")}
          >
            Unread <span className="pill-count ml-2">{unreadCount}</span>
          </button>
        </div>

        {loading ? (
          <div aria-busy="true" aria-label="Loading notifications">
            {[0, 1, 2, 3].map((i) => (
              <div className="skeleton-row" key={i}>
                <div className="skeleton skeleton-avatar" />
                <div style={{ flex: 1 }}>
                  <div className="skeleton skeleton-text w-50" />
                  <div className="skeleton skeleton-text w-75" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon"><i className="bi bi-bell-slash" aria-hidden="true" /></div>
            <div className="empty-state__title">
              {filter === "unread" ? "No unread notifications" : "No notifications yet"}
            </div>
            <p className="empty-state__desc">
              Low-stock and expiry alerts will show up here as they happen.
            </p>
          </div>
        ) : (
          <ul className="ntf-list">
            {visible.map((n) => {
              const p = PRIORITY[n.priority] || PRIORITY.NORMAL;
              const Body = n.link ? "button" : "div";
              return (
                <li key={n.id} className={`ntf-item ntf-item--${p.key}${n.is_read ? "" : " is-unread"}`}>
                  <span className={`ntf-icon ntf-icon--${p.key}`} aria-hidden="true">
                    <i className={`bi ${p.icon}`} />
                  </span>

                  <Body
                    className="ntf-main"
                    {...(n.link ? { type: "button", onClick: () => openNotification(n) } : {})}
                  >
                    <span className="ntf-title">
                      {n.title}
                      {!n.is_read && <span className="ntf-dot" role="img" aria-label="Unread" />}
                    </span>
                    {n.message && <span className="ntf-text">{n.message}</span>}
                    <span className="ntf-meta">
                      <span className={`badge ${p.badge}`}>{p.label}</span>
                      <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                    </span>
                  </Body>

                  {!n.is_read && (
                    <button
                      type="button"
                      className="btn-icon-only"
                      onClick={() => markRead(n)}
                      title="Mark as read"
                      aria-label={`Mark "${n.title}" as read`}
                    >
                      <i className="bi bi-check2" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}