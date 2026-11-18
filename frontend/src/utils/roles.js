// src/utils/roles.js  - role names must match the backend `Role` choices (api/models.py).
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  PHARMACIST: "PHARMACIST",
  CASHIER: "CASHIER",
  ACCOUNTANT: "ACCOUNTANT",
};

export const ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin / Owner",
  PHARMACIST: "Pharmacist",
  CASHIER: "Cashier",
  ACCOUNTANT: "Accountant",
};

// Same rules as api/permissions.py
export const canEditMedicines = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.PHARMACIST;
export const canViewShopReports = (role) =>
  role === ROLES.SUPER_ADMIN || role === ROLES.ACCOUNTANT || role === ROLES.PHARMACIST;
