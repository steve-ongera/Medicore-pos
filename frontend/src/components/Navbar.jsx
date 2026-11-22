// src/components/Navbar.jsx
// The current page is shown as the title (like "Overview" in the reference);
// parent crumbs sit before it in a lighter weight and are hidden on small screens.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLES, ROLE_LABELS } from "../utils/roles";
import ChatDropdown from "./ChatDropdown.jsx";
import NotificationBell from "./NotificationBell.jsx";
import PageSearch from "./PageSearch.jsx";
import useFullscreen from "../hooks/useFullscreen.js";
import { useUnreadCounts } from "../utils/unreadCounts.js";

const UUID_RE = /^[0-9a-f]{8}(-?[0-9a-f]{4}){3}-?[0-9a-f]{12}$/i;
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const label = (s) => {
  const d = decode(s);
  return UUID_RE.test(d) ? d.slice(0, 8) + "…" : d.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};
const initials = (u) =>
  ((u?.first_name?.[0] || u?.username?.[0] || "") + (u?.last_name?.[0] || "")).toUpperCase() || "?";

const mq = (q) => typeof window !== "undefined" && !!window.matchMedia?.(q).matches;

export default function Navbar({ onToggleSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isMobile = mq("(max-width: 640px)");
  const isTouch = mq("(pointer: coarse)");

  // Shared unread counts (one poll for the whole app). ChatDropdown and NotificationBell
  // draw their own badges from the same source; the total is also shown in the tab title.
  const { notifications: unreadNotifications, messages: unreadMessages } = useUnreadCounts();

  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef(null);

  const { isFullscreen, wantsFullscreen, enter, toggle } = useFullscreen();
  // Fullscreen API is missing on iPhone and pointless on phones
  const canFullscreen =
    !isMobile && typeof document !== "undefined" &&
    (document.fullscreenEnabled || document.webkitFullscreenEnabled);

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.length
    ? segments.map((s, i) => ({ label: label(s), full: decode(s), to: "/" + segments.slice(0, i + 1).join("/") }))
    : [{ label: "Dashboard", full: "Dashboard", to: "/dashboard" }];

  // Browser tab title, e.g. "(3) Cloud 360 POS", so new messages and alerts are noticed
  // while staff work in another tab.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
    const total = unreadNotifications + unreadMessages;
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${base}` : base;
    return () => { document.title = base; };
  }, [unreadNotifications, unreadMessages]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const down = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const key = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [menuOpen]);

  useEffect(() => setMenuOpen(false), [pathname]);

  const go = useCallback((to) => { setMenuOpen(false); navigate(to); }, [navigate]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setMenuOpen(false);
    setLoggingOut(true);
    try { await logout(); navigate("/login"); } finally { setLoggingOut(false); }
  };

  const name = user?.first_name ? `${user.first_name} ${user.last_name || ""}`.trim() : user?.username;
  const roleLabel = ROLE_LABELS?.[user?.role] || user?.role;

  return (
    <>
      {/* Browsers drop fullscreen on refresh and need a click to re-enter it */}
      {canFullscreen && wantsFullscreen && !isFullscreen && (
        <div className="fullscreen-resume-banner" onClick={enter} role="button" tabIndex={0}>
          <i className="bi bi-arrows-fullscreen me-1" aria-hidden="true" />
          {isTouch ? "Tap to resume fullscreen" : "Click to resume fullscreen"}
        </div>
      )}

      <div className={`page-loader${loggingOut ? " is-active" : ""}`} role="progressbar"
        aria-label="Signing out" aria-hidden={!loggingOut} />

      <header className="navbar">
        <div className="navbar__left">
          <button type="button" className="navbar__toggle" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <i className="bi bi-list" style={{ fontSize: "1.375rem" }} aria-hidden="true" />
          </button>
          <nav className="navbar__breadcrumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.to} className="navbar__crumb">
                {i > 0 && <i className="bi bi-chevron-right navbar__crumb-sep" aria-hidden="true" />}
                {i === crumbs.length - 1
                  ? <span className="is-current" aria-current="page" title={c.full}>{c.label}</span>
                  : <Link to={c.to} title={c.full}>{c.label}</Link>}
              </span>
            ))}
          </nav>
        </div>

        {/* Page search: filtered by the signed-in user's role; hidden by CSS below 768px */}
        <PageSearch />

        <div className="navbar__right">
          {/* Chat icon with unread message count */}
          <ChatDropdown />

          {canFullscreen && (
            <button type="button" className="navbar__icon-btn navbar__fullscreen"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"} onClick={toggle}>
              <i className={`bi ${isFullscreen ? "bi-fullscreen-exit" : "bi-arrows-fullscreen"}`}
                style={{ fontSize: "1.0625rem" }} aria-hidden="true" />
            </button>
          )}

          {/* Bell with unread notification count */}
          <NotificationBell />

          <div className="navbar__divider" />

          <div className="dropdown" ref={menuRef}>
            <button type="button" className="navbar__user" onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Account menu">
              <span className="avatar avatar-sm">{initials(user)}</span>
              <span className="navbar__user-meta">
                <span className="navbar__user-name">{name}</span>
                <span className="navbar__user-role">{roleLabel}</span>
              </span>
              <i className="bi bi-chevron-down text-faint" style={{ fontSize: "0.6875rem" }} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div className="dropdown-menu" role="menu">
                {isMobile && (
                  <>
                    <div className="dropdown-label">{name}</div>
                    <div className="dropdown-label" style={{ paddingTop: 0 }}>{roleLabel}</div>
                    <div className="dropdown-divider" />
                  </>
                )}
                <button type="button" role="menuitem" className="dropdown-item" onClick={() => go("/profile")}>
                  <i className="bi bi-person-circle" aria-hidden="true" /> My Profile
                </button>
                {user?.role === ROLES.SUPER_ADMIN && (
                  <button type="button" role="menuitem" className="dropdown-item" onClick={() => go("/settings")}>
                    <i className="bi bi-gear" aria-hidden="true" /> Settings
                  </button>
                )}
                <div className="dropdown-divider" />
                <button type="button" role="menuitem" className="dropdown-item is-danger"
                  onClick={handleLogout} disabled={loggingOut}>
                  <i className="bi bi-box-arrow-right" aria-hidden="true" /> {loggingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}