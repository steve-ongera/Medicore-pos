// src/components/NotificationBell.jsx
// Navbar bell: unread badge + dropdown with the latest unread alerts.
// Put it inside <div className="navbar__right"> in your Navbar.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../services/api";
import { asList, timeAgo } from "../utils/timeAgo";
import { notifyUnreadChanged, onUnreadChanged } from "../utils/unreadEvents";
import { adjustNotificationCount, useUnreadCounts } from "../utils/unreadCounts";
import "../styles/messaging.css";

const PRIORITY_KEY = { CRITICAL: "critical", HIGH: "high", NORMAL: "normal", LOW: "low" };

export default function NotificationBell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const { notifications: unreadCount } = useUnreadCounts(); // shared, polled once for the whole app
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      setNotifications(asList(await getUnreadNotifications()));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  // refresh the open list when something is marked read elsewhere (e.g. the Notifications page)
  useEffect(() => {
    if (!open) return undefined;
    return onUnreadChanged(loadNotifications);
  }, [open, loadNotifications]);

  useEffect(() => { if (open) loadNotifications(); }, [open, loadNotifications]);

  // close on outside click, Escape and route change
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { setOpen(false); }, [pathname]);

  const openNotification = async (n) => {
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
    adjustNotificationCount(-1);
    setOpen(false);
    if (n.link) navigate(n.link);
    try {
      await markNotificationRead(n.id);
      notifyUnreadChanged();
    } catch { notifyUnreadChanged(); }
  };

  const markAll = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications([]);
      adjustNotificationCount(-unreadCount);
      notifyUnreadChanged();
    } catch { /* silent */ }
  };

  return (
    <div ref={rootRef} className="nav-pop">
      <button
        type="button"
        className="navbar__icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <i className="bi bi-bell" style={{ fontSize: 17 }} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="navbar__icon-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="nav-pop__panel" role="region" aria-label="Notifications">
          <div className="nav-pop__head">
            <span className="nav-pop__title">Notifications</span>
            {notifications.length > 0 && (
              <button type="button" className="link-btn" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>

          <div className="nav-pop__body">
            {loading && notifications.length === 0 ? (
              <div className="nav-pop__empty">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="nav-pop__empty">
                <i className="bi bi-bell-slash" aria-hidden="true" />
                No unread notifications
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`nav-pop__item nav-pop__item--${PRIORITY_KEY[n.priority] || "normal"} is-unread`}
                  onClick={() => openNotification(n)}
                >
                  <span className="nav-pop__main">
                    <span className="nav-pop__row">
                      <span className="nav-pop__item-title">{n.title}</span>
                      <span className="nav-pop__item-time">{timeAgo(n.created_at)}</span>
                    </span>
                    {n.message && <span className="nav-pop__item-text">{n.message}</span>}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="nav-pop__foot">
            <button type="button" className="nav-pop__all" onClick={() => { setOpen(false); navigate("/notifications"); }}>
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}