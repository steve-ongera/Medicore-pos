// src/context/ToastContext.jsx
// Same API your pages use:  import { toast } from ".../ToastContext"
// then toast.success("...") / toast.error("...") / toast.info("...").
// Styled with the global main.css toast classes (toast-stack / toast / tone-*).
import { createContext, useCallback, useContext, useEffect, useState } from "react";

let push = () => {};
export const toast = {
  success: (m) => push("success", m),
  error: (m) => push("error", m),
  info: (m) => push("info", m),
};

const ToastCtx = createContext(toast);
export const useToast = () => useContext(ToastCtx);

// Maps our toast types to the main.css tone classes and Bootstrap icons.
const TONE = { success: "success", error: "danger", info: "info" };
const ICON = {
  success: "bi-check-circle-fill",
  error: "bi-exclamation-circle-fill",
  info: "bi-info-circle-fill",
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const dismiss = useCallback((id) => {
    setItems((l) => l.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((type, message) => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, type, message }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  useEffect(() => {
    push = add;
    return () => { push = () => {}; };
  }, [add]);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast tone-${TONE[t.type] || "info"}`}
            role={t.type === "error" ? "alert" : "status"}
          >
            <i
              className={`bi ${ICON[t.type] || ICON.info} toast__icon`}
              style={{ fontSize: 18, lineHeight: 1 }}
              aria-hidden="true"
            />
            <div className="toast__title">{t.message}</div>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}