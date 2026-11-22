// src/components/Sidebar.jsx
// Same links and role rules as before. New look: blue active pill, collapsible
// groups with an indented tree, and a Log out button at the bottom.
// Groups with a single visible link render as a plain link (no dropdown).
// NAV_GROUPS keeps the same shape (links unchanged), so PageSearch keeps working.
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLES } from "../utils/roles";
import { useUnreadCounts } from "../utils/unreadCounts";
import { useShopProfile } from "../utils/shopProfile";
import cloud360Logo from "../assets/logo.jpg";

const ALL = [ROLES.SUPER_ADMIN, ROLES.PHARMACIST, ROLES.CASHIER, ROLES.ACCOUNTANT];
const STOCK = [ROLES.SUPER_ADMIN, ROLES.PHARMACIST];
const REPORTS = [ROLES.SUPER_ADMIN, ROLES.PHARMACIST, ROLES.ACCOUNTANT];

export const NAV_GROUPS = [
  { label: "Overview", icon: "bi-speedometer2", links: [
    { to: "/dashboard", label: "Dashboard", icon: "bi-speedometer2", roles: ALL },
  ]},
  { label: "Inbox", icon: "bi-inbox", links: [
    { to: "/notifications", label: "Notifications", icon: "bi-bell", roles: ALL, badge: "notifications" },
    { to: "/messages", label: "Messages", icon: "bi-chat-dots", roles: ALL, badge: "messages" },
  ]},
  { label: "Counter", icon: "bi-shop", links: [
    { to: "/billing/walk-in-sale", label: "New sale (POS)", icon: "bi-bag-check", roles: ALL },
    { to: "/billing/payments", label: "Payments", icon: "bi-receipt", roles: ALL },
  ]},
  { label: "Stock", icon: "bi-box-seam", links: [
    { to: "/inventory", label: "Inventory", icon: "bi-box-seam", roles: ALL },
    { to: "/suppliers", label: "Suppliers", icon: "bi-truck", roles: STOCK },
  ]},
  { label: "Insights", icon: "bi-bar-chart-line", links: [
    // `end` stops this link from staying active on /reports/sales, /reports/products, /reports/stock
    { to: "/reports", label: "Reports", icon: "bi-bar-chart-line", roles: REPORTS, end: true },
    { to: "/reports/sales", label: "Sales report", icon: "bi-graph-up-arrow", roles: REPORTS },
    { to: "/reports/products", label: "Product report", icon: "bi-tags", roles: REPORTS },
    { to: "/reports/stock", label: "Stock report", icon: "bi-boxes", roles: REPORTS },
  ]},
  { label: "Administration", icon: "bi-sliders", links: [
    { to: "/settings", label: "Settings", icon: "bi-gear", roles: [ROLES.SUPER_ADMIN] },
    { to: "/users", label: "Users", icon: "bi-people", roles: [ROLES.SUPER_ADMIN] },
  ]},
  { label: "Account", icon: "bi-person-circle", links: [
    { to: "/subscriptions", label: "Subscription", icon: "bi-award", roles: ALL },
    { to: "/profile", label: "My profile", icon: "bi-person-circle", roles: ALL },
  ]},
];

const isLinkActive = (l, pathname) =>
  l.end ? pathname === l.to : pathname === l.to || pathname.startsWith(l.to + "/");

function Badge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span className="sidebar__link-badge" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function Sidebar({ onNavigate, onClose }) {
  const { user, logout } = useAuth();
  const counts = useUnreadCounts();
  const profile = useShopProfile();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const close = onClose ?? onNavigate;
  const [open, setOpen] = useState({});
  const [loggingOut, setLoggingOut] = useState(false);

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({ ...g, links: g.links.filter((l) => l.roles.includes(user?.role)) }))
        .filter((g) => g.links.length > 0),
    [user]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && document.querySelector(".app-shell.is-sidebar-open")) close?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    scrollRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  // Every group is open by default; a group only closes when the user closes it
  const toggle = (label) => setOpen((prev) => ({ ...prev, [label]: prev[label] === false }));

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <>
      <div className="sidebar-backdrop" onClick={close} aria-hidden="true" />
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar__brand">
          <img
            src={cloud360Logo}
            alt="Cloud 360 POS"
            width={34}
            height={34}
            decoding="async"
            style={{ height: "2.125rem", width: "auto", borderRadius: "6px" }}
          />
          <div className="sidebar__brand-text">
            <span className="sidebar__brand-name">Cloud 360 POS</span>
            <span className="sidebar__brand-sub">Your shop assistant</span>
          </div>
          <button type="button" className="sidebar__close" onClick={close} aria-label="Close menu">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar__scroll" ref={scrollRef}>
          {groups.map((g) => {
            /* One visible link: plain top-level item */
            if (g.links.length === 1) {
              const l = g.links[0];
              return (
                <NavLink
                  key={g.label}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) => `sidebar__link${isActive ? " is-active" : ""}`}
                  onClick={onNavigate}
                >
                  <span className="sidebar__link-icon"><i className={`bi ${l.icon}`} aria-hidden="true" /></span>
                  <span className="sidebar__link-text">{l.label}</span>
                  <Badge count={l.badge ? counts[l.badge] : 0} />
                </NavLink>
              );
            }

            /* Several links: collapsible group */
            const isOpen = open[g.label] !== false;
            const hasActive = g.links.some((l) => isLinkActive(l, pathname));
            const total = g.links.reduce((n, l) => n + (l.badge ? counts[l.badge] || 0 : 0), 0);
            const panelId = `nav-group-${g.label.toLowerCase().replace(/\s+/g, "-")}`;

            return (
              <div className="sidebar__group" key={g.label}>
                <button
                  type="button"
                  className={`sidebar__group-header${isOpen ? " is-open" : ""}${hasActive ? " has-active" : ""}`}
                  onClick={() => toggle(g.label)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                >
                  <span className="sidebar__link-icon"><i className={`bi ${g.icon}`} aria-hidden="true" /></span>
                  <span className="sidebar__link-text">{g.label}</span>
                  {!isOpen && <Badge count={total} />}
                  <i className="bi bi-chevron-down sidebar__group-chevron" aria-hidden="true" />
                </button>

                <div id={panelId} className={`sidebar__group-collapse${isOpen ? " is-open" : ""}`}>
                  <div className="sidebar__collapse-inner">
                    <div className="sidebar__sub">
                      {g.links.map((l) => (
                        <NavLink
                          key={l.to}
                          to={l.to}
                          end={l.end}
                          tabIndex={isOpen ? 0 : -1}
                          className={({ isActive }) => `sidebar__sublink${isActive ? " is-active" : ""}`}
                          onClick={onNavigate}
                        >
                          {({ isActive }) => (
                            <>
                              <span className="sidebar__link-text">{l.label}</span>
                              <Badge count={l.badge ? counts[l.badge] : 0} />
                              {isActive && <i className="bi bi-check2 sidebar__sublink-check" aria-hidden="true" />}
                            </>
                          )}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__shop">{profile.loaded ? profile.shopName : "Cloud 360 POS"}</div>
          <button
            type="button"
            className="sidebar__link sidebar__logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span className="sidebar__link-icon"><i className="bi bi-box-arrow-left" aria-hidden="true" /></span>
            <span className="sidebar__link-text">{loggingOut ? "Signing out…" : "Log out"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}