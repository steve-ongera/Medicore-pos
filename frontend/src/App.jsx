/**
 * ============================================================================
 * Cloud 360 POS — Application routes  (src/App.jsx)
 * ============================================================================
 *
 * Same layout as the HMIS App.jsx: imports grouped by module, an `allow()`
 * access helper, then <App /> with public routes followed by the authenticated
 * shell (DashboardLayout) holding every module.
 *
 * ACCESS CONTROL
 *   - <ProtectedRoute>                       -> any logged-in user
 *   - <ProtectedRoute allowedRoles={[...]}>  -> only those roles
 *   - Build `allowedRoles` with `allow(...)`; role names live in utils/roles.js.
 *   - The backend enforces the same rules (api/permissions.py); this is UX gating.
 *
 * ADDING A NEW PAGE
 *   1. Create it under src/pages/<module>/.
 *   2. Import it in the matching group below.
 *   3. Add a <Route> in the matching section, wrapped in <ProtectedRoute>.
 *   4. Add a sidebar link (components/Sidebar.jsx NAV_GROUPS) if it should be navigable.
 *
 * Providers (Router, Auth, Toast) are mounted in main.jsx, not here.
 */
import { Routes, Route, Navigate, useLocation } from "react-router-dom";

// ---------------------------------------------------------------------------
// Layouts, guards & shared utilities
// ---------------------------------------------------------------------------
import DashboardLayout from "./layouts/DashboardLayout.jsx";
import AuthLayout from "./layouts/AuthLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import { ROLES } from "./utils/roles.js";

// ---------------------------------------------------------------------------
// Auth & generic pages
// ---------------------------------------------------------------------------
import Login from "./pages/auth/Login.jsx";
import Register from "./pages/auth/Register.jsx";
import ForgotPassword from "./pages/auth/ForgotPassword.jsx";
import Unauthorized from "./pages/auth/Unauthorized.jsx";
import NotFound from "./pages/NotFound.jsx";
import Profile from "./pages/profile/Profile.jsx";

// ---------------------------------------------------------------------------
// Home dashboard
// ---------------------------------------------------------------------------
import Dashboard from "./pages/dashboard/Dashboard.jsx";

// ---------------------------------------------------------------------------
// Notifications & staff chat
// ---------------------------------------------------------------------------
import Notifications from "./pages/notifications/Notifications.jsx";
import Messages from "./pages/messages/Messages.jsx";

// ---------------------------------------------------------------------------
// Billing & walk-in sales
// ---------------------------------------------------------------------------
import Payments from "./pages/billing/Payments.jsx";
import WalkInSale from "./pages/billing/WalkInSale.jsx"; // copied unchanged from the HMIS

// ---------------------------------------------------------------------------
// Pharmacy, inventory & suppliers
// ---------------------------------------------------------------------------
import Inventory from "./pages/inventory/Inventory.jsx";
import Suppliers from "./pages/pharmacy/Suppliers.jsx"; // copied unchanged from the HMIS

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
import Reports from "./pages/reports/Reports.jsx";
import SalesReport from "./pages/reports/SalesReport.jsx";
import ProductReport from "./pages/reports/ProductReport.jsx";
import StockReport from "./pages/reports/StockReport.jsx";

// ---------------------------------------------------------------------------
// Administration & settings
// ---------------------------------------------------------------------------
import Settings from "./pages/settings/Settings.jsx";
import Users from "./pages/settings/Users.jsx";

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------
import Subscriptions from "./pages/support/Subscriptions.jsx";
import Wallet from "./pages/support/Wallet.jsx"; // wallet, M-Pesa top-up, buy a bundle

// ===========================================================================
// ACCESS CONTROL HELPER
// ===========================================================================

// The shop owner (SUPER_ADMIN) can open every page. `allow(...)` takes the roles a route
// was meant for and adds SUPER_ADMIN on top (de-duplicated).
//
// Usage:  allowedRoles={allow(ROLES.PHARMACIST)}  ->  [PHARMACIST, SUPER_ADMIN]
// To change who gets blanket access, edit FULL_ACCESS_ROLES only.
const FULL_ACCESS_ROLES = [ROLES.SUPER_ADMIN];
const allow = (...roles) => [...new Set([...roles, ...FULL_ACCESS_ROLES])];

// Everyone who can ring up a sale.
const ALL_STAFF = allow(ROLES.PHARMACIST, ROLES.CASHIER, ROLES.ACCOUNTANT);

// Shop-wide reports: owner, pharmacist, accountant.
const REPORT_ROLES = allow(ROLES.PHARMACIST, ROLES.ACCOUNTANT);

// ===========================================================================
// ROUTE HELPER COMPONENTS
// ===========================================================================

// Keeps query params (e.g. ?invoice=xxx) when forwarding old /payments links.
function LegacyPaymentsRedirect() {
  const location = useLocation();
  return <Navigate to={`/billing/payments${location.search}`} replace />;
}

// ===========================================================================
// ROUTES
// ===========================================================================
export default function App() {
  return (
    <Routes>
      {/* ===================================================================
          PUBLIC ROUTES (no login required) — rendered inside AuthLayout
          =================================================================== */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
      </Route>

      {/* ===================================================================
          AUTHENTICATED SHELL — everything below renders inside DashboardLayout
          =================================================================== */}
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* ---------------- Home dashboard (data is scoped to the user's role on the server) ---------------- */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

        {/* ---------------- Profile (any authenticated user) ---------------- */}
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

        {/* ---------------- Notifications & staff chat (any authenticated user) ---------------- */}
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
        <Route path="/messages/:conversationId" element={<ProtectedRoute><Messages /></ProtectedRoute>} />

        {/* ===============================================================
            BILLING & WALK-IN SALES
            =============================================================== */}
        <Route path="/billing" element={<Navigate to="/billing/payments" replace />} />
        <Route path="/billing/payments" element={<ProtectedRoute allowedRoles={ALL_STAFF}><Payments /></ProtectedRoute>} />
        <Route path="/billing/walk-in-sale" element={<ProtectedRoute allowedRoles={ALL_STAFF}><WalkInSale /></ProtectedRoute>} />

        {/* Legacy redirect: old /payments links forward to /billing/payments */}
        <Route path="/payments" element={<LegacyPaymentsRedirect />} />

        {/* ===============================================================
            PHARMACY & INVENTORY
            =============================================================== */}
        <Route path="/inventory" element={<ProtectedRoute allowedRoles={ALL_STAFF}><Inventory /></ProtectedRoute>} />
        <Route path="/suppliers" element={<ProtectedRoute allowedRoles={allow(ROLES.PHARMACIST)}><Suppliers /></ProtectedRoute>} />

        {/* ===============================================================
            REPORTS (owner, pharmacist, accountant)
            =============================================================== */}
        <Route path="/reports" element={<ProtectedRoute allowedRoles={REPORT_ROLES}><Reports /></ProtectedRoute>} />
        <Route path="/reports/sales" element={<ProtectedRoute allowedRoles={REPORT_ROLES}><SalesReport /></ProtectedRoute>} />
        <Route path="/reports/products" element={<ProtectedRoute allowedRoles={REPORT_ROLES}><ProductReport /></ProtectedRoute>} />
        <Route path="/reports/stock" element={<ProtectedRoute allowedRoles={REPORT_ROLES}><StockReport /></ProtectedRoute>} />

        {/* ===============================================================
            ADMINISTRATION & SETTINGS (owner only)
            =============================================================== */}
        <Route path="/settings" element={<ProtectedRoute allowedRoles={allow()}><Settings /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute allowedRoles={allow()}><Users /></ProtectedRoute>} />

        {/* ===============================================================
            SUPPORT (visible to every authenticated user)
            =============================================================== */}
        <Route path="/subscriptions" element={<ProtectedRoute><Subscriptions /></ProtectedRoute>} />
        {/* Wallet & bundles: owner only (the server enforces this too) */}
        <Route path="/wallet" element={<ProtectedRoute allowedRoles={allow()}><Wallet /></ProtectedRoute>} />

        {/* ---------------- Catch-all: must stay LAST ---------------- */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}