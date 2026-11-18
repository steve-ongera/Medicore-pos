// src/layouts/DashboardLayout.jsx
// HMIS-style shell (sidebar + navbar + content). Routing, roles and auth are unchanged.
import { useState } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "../components/Navbar.jsx";
import Sidebar from "../components/Sidebar.jsx";

export default function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false); // desktop: hide sidebar
  const [mobileOpen, setMobileOpen] = useState(false); // phone/tablet: drawer

  const toggleSidebar = () => {
    if (window.innerWidth < 960) setMobileOpen((v) => !v);
    else setCollapsed((v) => !v);
  };
  const closeMobile = () => setMobileOpen(false);

  return (
    <div className={`app-shell${collapsed ? " is-sidebar-collapsed" : ""}${mobileOpen ? " is-sidebar-open" : ""}`}>
      <Sidebar onNavigate={closeMobile} onClose={closeMobile} />
      <div className="app-main">
        <Navbar onToggleSidebar={toggleSidebar} />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}