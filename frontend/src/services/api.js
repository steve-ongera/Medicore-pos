// src/services/api.js  -  Medicore POS API client
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// ── token helpers ────────────────────────────────────────────────────────────
const getAccess = () => localStorage.getItem("access_token");
const getRefresh = () => localStorage.getItem("refresh_token");
export const setTokens = ({ access, refresh }) => {
  if (access) localStorage.setItem("access_token", access);
  if (refresh) localStorage.setItem("refresh_token", refresh);
};
export const clearTokens = () => {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("user");
};

// ── request: attach Bearer token ─────────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = getAccess();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── response: 401 -> refresh once, queue concurrent requests ─────────────────
let refreshing = false;
let waiters = [];
const flush = (err, token) => {
  waiters.forEach((p) => (err ? p.reject(err) : p.resolve(token)));
  waiters = [];
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.includes("/auth/login/") ||
      original?.url?.includes("/auth/refresh/") ||
      original?.url?.includes("/auth/register/");

    if (error.response?.status === 401 && !original._retry && !isAuthCall && getRefresh()) {
      if (refreshing) {
        return new Promise((resolve, reject) => waiters.push({ resolve, reject })).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }
      original._retry = true;
      refreshing = true;
      try {
        const { data } = await axios.post(`${BASE_URL}/auth/refresh/`, { refresh: getRefresh() });
        setTokens({ access: data.access, refresh: data.refresh });
        flush(null, data.access);
        original.headers.Authorization = `Bearer ${data.access}`;
        return api(original);
      } catch (e) {
        flush(e, null);
        clearTokens();
        window.location.href = "/login";
        return Promise.reject(e);
      } finally {
        refreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

// ── helpers ──────────────────────────────────────────────────────────────────
// Normalises every failure into an Error with .message / .status / .errors
const unwrap = async (promise) => {
  try {
    const res = await promise;
    return res.data;
  } catch (err) {
    const data = err.response?.data;
    let message = "Something went wrong";
    if (typeof data === "string") message = data;
    else if (data?.detail) message = data.detail;
    else if (data && typeof data === "object") {
      const first = Object.entries(data)[0];
      if (first) {
        const [k, v] = first;
        const text = Array.isArray(v) ? v[0] : typeof v === "object" ? JSON.stringify(v) : v;
        message = k === "non_field_errors" ? text : `${k}: ${text}`;
      }
    } else if (err.message) message = err.message;
    const e = new Error(message);
    e.status = err.response?.status;
    e.errors = data;
    throw e;
  }
};

const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : "";
};

// ── Auth ─────────────────────────────────────────────────────────────────────
export const login = async (username, password) => {
  const data = await unwrap(api.post("/auth/login/", { username, password }));
  setTokens(data);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
};
// Self-service sign-up: creates the shop + owner + free trial, then signs the owner in.
export const registerShop = async (payload) => {
  const data = await unwrap(api.post("/auth/register/", payload));
  setTokens(data);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
};
export const logout = async () => {
  try {
    await api.post("/auth/logout/", { refresh: getRefresh() });
  } catch {
    /* ignore */
  }
  clearTokens();
};
export const getMe = () => unwrap(api.get("/auth/me/"));
export const updateMe = (d) => unwrap(api.patch("/auth/me/", d));
export const changePassword = (payload) => unwrap(api.post("/auth/change-password/", payload));

// ── Shop, subscription, dashboard/report data ────────────────────────────────
export const getShop = () => unwrap(api.get("/shop/"));
export const getSubscription = () => unwrap(api.get("/subscription/"));
export const getReportsSummary = (p) => unwrap(api.get(`/reports/summary/${qs(p)}`));
export const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
};
export const isAuthenticated = () => !!getAccess();

// ── Users (admin) ────────────────────────────────────────────────────────────
export const getUsers = (p) => unwrap(api.get(`/users/${qs(p)}`));
export const createUser = (d) => unwrap(api.post("/users/", d));
export const updateUser = (id, d) => unwrap(api.patch(`/users/${id}/`, d));
export const deleteUser = (id) => unwrap(api.delete(`/users/${id}/`));

// ── Medicines ────────────────────────────────────────────────────────────────
export const getMedicines = (p) => unwrap(api.get(`/medicines/${qs(p)}`));
export const createMedicine = (d) => unwrap(api.post("/medicines/", d));
export const updateMedicine = (id, d) => unwrap(api.patch(`/medicines/${id}/`, d));
export const deleteMedicine = (id) => unwrap(api.delete(`/medicines/${id}/`));
export const getLowStockMedicines = () => unwrap(api.get("/medicines/low-stock/"));
export const searchMedicines = (query = "", { includeHidden = false } = {}) =>
  unwrap(api.get(`/medicines/autocomplete/${qs({ q: query, include_hidden: includeHidden ? 1 : "" })}`));
export const quickAddMedicine = (d) => unwrap(api.post("/medicines/quick-add/", d));
export const getMedicineBranchStock = (id) => unwrap(api.get(`/medicines/${id}/branch-stock/`));
export const setMedicineStock = (id, d) => unwrap(api.post(`/medicines/${id}/set-stock/`, d));

// ── Suppliers ────────────────────────────────────────────────────────────────
export const getSuppliers = (p) => unwrap(api.get(`/suppliers/${qs(p)}`));
export const createSupplier = (d) => unwrap(api.post("/suppliers/", d));
export const updateSupplier = (id, d) => unwrap(api.patch(`/suppliers/${id}/`, d));
export const deleteSupplier = (id) => unwrap(api.delete(`/suppliers/${id}/`));

// ── Batches & stock ledger ───────────────────────────────────────────────────
export const getMedicineBatches = (p) => unwrap(api.get(`/medicine-batches/${qs(p)}`));
export const createMedicineBatch = (d) => unwrap(api.post("/medicine-batches/", d));
export const updateMedicineBatch = (id, d) => unwrap(api.patch(`/medicine-batches/${id}/`, d));
export const getExpiringBatches = (days = 90) => unwrap(api.get(`/medicine-batches/expiring-soon/${qs({ days })}`));
export const getStockTransactions = (p) => unwrap(api.get(`/stock-transactions/${qs(p)}`));

// ── Walk-in (OTC) sales ──────────────────────────────────────────────────────
export const getOTCSales = (p) => unwrap(api.get(`/otc-sales/${qs(p)}`));
export const getOTCSale = (id) => unwrap(api.get(`/otc-sales/${id}/`));
export const createOTCSale = (d) => unwrap(api.post("/otc-sales/", d));
export const getOTCSaleReceipt = (id) => unwrap(api.get(`/otc-sales/${id}/receipt/`));
export const amendOTCSale = (id, d) => unwrap(api.post(`/otc-sales/${id}/amend/`, d));
export const getOTCSaleAmendments = (id) => unwrap(api.get(`/otc-sales/${id}/amendments/`));
export const addOTCSalePayment = (id, d) => unwrap(api.post(`/otc-sales/${id}/add-payment/`, d));

// ── Dashboard, reports, payments summary ────────────────────────────────────
export const getDashboardSummary = (days = 14) => unwrap(api.get(`/dashboard/summary/${qs({ days })}`));
export const getSalesReport = (p) => unwrap(api.get(`/reports/sales/${qs(p)}`));
export const getProductReport = (p) => unwrap(api.get(`/reports/products/${qs(p)}`));
export const getStockReport = () => unwrap(api.get("/reports/stock/"));
export const getPaymentsSummary = (p) => unwrap(api.get(`/payments/summary/${qs(p)}`));

// ── Shop settings & subscription ────────────────────────────────────────────
export const getShopSettings = () => unwrap(api.get("/settings/shop/"));
export const updateShopSettings = (d) => unwrap(api.patch("/settings/shop/", d));
export const requestSubscription = (d) => unwrap(api.post("/subscription/", d));

// ── SaaS: wallet, bundles, M-Pesa top-up (owner only on the server) ─────────
// getSubscription() now also returns: wallet_balance, sales_remaining, limits, features, bundles.
export const getWallet = () => unwrap(api.get("/billing/wallet/"));
export const buyBundle = ({ bundle, quantity = 1, autoRenew = false }) =>
  unwrap(api.post("/billing/buy-bundle/", { bundle, quantity, auto_renew: autoRenew }));
export const topUpWallet = ({ phone, amount }) => unwrap(api.post("/billing/topup/", { phone, amount }));

// ── Branch stubs (single-shop POS: kept so existing pages don't break) ──────
export const getMyAccessibleBranches = async () => [];
export const setBranchContext = () => {};

// ── Notifications (bell) ─────────────────────────────────────────────────────
export const getNotifications = (p) => unwrap(api.get(`/notifications/${qs(p)}`));
export const getUnreadNotifications = () => unwrap(api.get("/notifications/unread/"));
export const getNotificationUnreadCount = () => unwrap(api.get("/notifications/unread-count/"));
export const markNotificationRead = (id) => unwrap(api.post(`/notifications/${id}/mark-read/`));
export const markAllNotificationsRead = () => unwrap(api.post("/notifications/mark-all-read/"));
 
// ── Messages (staff chat) ────────────────────────────────────────────────────
export const getConversations = () => unwrap(api.get("/conversations/"));
export const getConversation = (id) => unwrap(api.get(`/conversations/${id}/`));
export const startConversation = (userId) => unwrap(api.post("/conversations/", { user_id: userId }));
export const createGroupConversation = (userIds, title) =>
  unwrap(api.post("/conversations/", { user_ids: userIds, title }));
export const getConversationMessages = (id, p) => unwrap(api.get(`/conversations/${id}/messages/${qs(p)}`));
export const sendConversationMessage = (id, body) =>
  unwrap(api.post(`/conversations/${id}/messages/`, { body }));
export const markConversationRead = (id) => unwrap(api.post(`/conversations/${id}/read/`));
export const getUnreadMessageCount = () => unwrap(api.get("/messages/unread-count/"));
export const getChatUsers = (p) => unwrap(api.get(`/chat/users/${qs(p)}`));
 

export const payForBundle = ({ phone, bundle, quantity = 1 }) =>
  unwrap(api.post("/billing/topup/", { phone, bundle, quantity }));
export const getPaymentStatus = (checkoutId) => unwrap(api.get(`/billing/payment/${checkoutId}/`));

export default api;