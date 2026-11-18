// src/components/Sidebar.jsx
// Same links and role rules as the old DashboardLayout NAV; HMIS look.
import { useEffect, useMemo, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLES } from "../utils/roles";
import { useUnreadCounts } from "../utils/unreadCounts";
import medicoreLogo from "../assets/logo.jpg";

const ALL = [ROLES.SUPER_ADMIN, ROLES.PHARMACIST, ROLES.CASHIER, ROLES.ACCOUNTANT];
const STOCK = [ROLES.SUPER_ADMIN, ROLES.PHARMACIST];
const REPORTS = [ROLES.SUPER_ADMIN, ROLES.PHARMACIST, ROLES.ACCOUNTANT];

export const NAV_GROUPS = [
  { label: "Overview", links: [
    { to: "/dashboard", label: "Dashboard", icon: "bi-speedometer2", roles: ALL },
  ]},
  { label: "Inbox", links: [
    { to: "/notifications", label: "Notifications", icon: "bi-bell", roles: ALL, badge: "notifications" },
    { to: "/messages", label: "Messages", icon: "bi-chat-dots", roles: ALL, badge: "messages" },
  ]},
  { label: "Counter", links: [
    { to: "/billing/walk-in-sale", label: "New sale (POS)", icon: "bi-bag-check", roles: ALL },
    { to: "/billing/payments", label: "Payments", icon: "bi-receipt", roles: ALL },
  ]},
  { label: "Stock", links: [
    { to: "/inventory", label: "Inventory", icon: "bi-box-seam", roles: ALL },
    { to: "/suppliers", label: "Suppliers", icon: "bi-truck", roles: STOCK },
  ]},
  { label: "Insights", links: [
    // `end` stops this link from staying active on /reports/sales, /reports/products, /reports/stock
    { to: "/reports", label: "Reports", icon: "bi-bar-chart-line", roles: REPORTS, end: true },
    { to: "/reports/sales", label: "Sales report", icon: "bi-graph-up-arrow", roles: REPORTS },
    { to: "/reports/products", label: "Product report", icon: "bi-capsule", roles: REPORTS },
    { to: "/reports/stock", label: "Stock report", icon: "bi-boxes", roles: REPORTS },
  ]},
  { label: "Administration", links: [
    { to: "/settings", label: "Settings", icon: "bi-gear", roles: [ROLES.SUPER_ADMIN] },
    { to: "/users", label: "Users", icon: "bi-people", roles: [ROLES.SUPER_ADMIN] },
  ]},
  { label: "Account", links: [
    { to: "/subscriptions", label: "Subscription", icon: "bi-award", roles: ALL },
    { to: "/profile", label: "My profile", icon: "bi-person-circle", roles: ALL },
  ]},
];

export default function Sidebar({ onNavigate, onClose }) {
  const { user } = useAuth();
  const counts = useUnreadCounts();
  const { pathname } = useLocation();
  const scrollRef = useRef(null);
  const close = onClose ?? onNavigate;

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
    scrollRef.current?.querySelector(".sidebar__link.is-active")?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  return (
    <>
      <div className="sidebar-backdrop" onClick={close} aria-hidden="true" />
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar__brand">
          <img
            src={medicoreLogo}
            alt="Medicore POS"
            width={34}
            height={34}
            decoding="async"
            style={{ height: 34, width: "auto", borderRadius: "5px", flexShrink: 0 }}
          />
          <span className="sidebar__brand-text">Medicore POS</span>
          <button type="button" className="sidebar__close" onClick={close} aria-label="Close menu">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <div className="sidebar__scroll" ref={scrollRef}>
          {groups.map((g) => (
            <div className="sidebar__group" key={g.label}>
              <div className="sidebar__group-label">{g.label}</div>
              <nav className="sidebar__nav">
                {g.links.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    end={l.end}
                    className={({ isActive }) => `sidebar__link${isActive ? " is-active" : ""}`}
                    onClick={onNavigate}
                  >
                    <span className="sidebar__link-icon"><i className={`bi ${l.icon}`} aria-hidden="true" /></span>
                    <span className="sidebar__link-text">{l.label}</span>
                    {l.badge && counts[l.badge] > 0 && (
                      <span className="sidebar__link-badge" aria-label={`${counts[l.badge]} unread`}>
                        {counts[l.badge] > 99 ? "99+" : counts[l.badge]}
                      </span>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <div className="sidebar__footer">Medicore POS</div>
      </aside>
    </>
  );
}