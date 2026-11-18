// src/config/pageRegistry.js
// Pages that the navbar search can open. Built from the sidebar links so the two
// never drift apart; extra pages that are not in the sidebar are added below.
import { NAV_GROUPS } from "../components/Sidebar.jsx";
import { ROLES } from "../utils/roles";

const REPORTS = [ROLES.SUPER_ADMIN, ROLES.PHARMACIST, ROLES.ACCOUNTANT];

const fromNav = NAV_GROUPS.flatMap((g) =>
  g.links.map((l) => ({ to: l.to, label: l.label, icon: l.icon, roles: l.roles, group: g.label }))
);

const extra = [
  { to: "/reports/sales", label: "Sales report", icon: "bi-graph-up", roles: REPORTS, group: "Insights" },
  { to: "/reports/products", label: "Product report", icon: "bi-capsule", roles: REPORTS, group: "Insights" },
  { to: "/reports/stock", label: "Stock report", icon: "bi-boxes", roles: REPORTS, group: "Insights" },
];

export const PAGE_REGISTRY = [...fromNav, ...extra];