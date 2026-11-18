// src/components/Modal.jsx
import { useState, useRef, useEffect } from "react";

const BASE_Z = 1000;      // normal modal
const NESTED_Z = 1100;    // modal opened on top of another modal

export default function Modal({
  show,
  onClose,
  title,
  description,
  children,
  footer,
  size = "",
  nested = false,          // NEW: render as a stacked modal
  zIndex,                  // NEW: optional explicit override
}) {
  const [isResizing, setIsResizing] = useState(false);
  const [modalWidth, setModalWidth] = useState(null);
  const modalRef = useRef(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    if (!show) setModalWidth(null);
  }, [show]);

  const handleResizeMove = (e) => {
    if (!isResizing) return;
    const delta = e.clientX - startX.current;
    const newWidth = Math.max(
      400,
      Math.min(window.innerWidth - 40, startWidth.current + delta)
    );
    setModalWidth(newWidth);
  };

  const handleResizeEnd = () => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  useEffect(() => {
    if (!isResizing) return;
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
    return () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizing]);

  // Esc: only close if the event is targeted inside this dialog's subtree.
  // A nested modal's capture-phase handler + stopPropagation wins first,
  // and this guard is a second safety net.
  useEffect(() => {
    if (!show) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const root = modalRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show, onClose]);

  if (!show) return null;

  const getSizeClass = () => {
    if (!size) return "";
    return size.startsWith("modal-") ? size : `modal-${size}`;
  };

  const handleResizeStart = (e) => {
    e.preventDefault();
    setIsResizing(true);
    startX.current = e.clientX;
    startWidth.current = modalRef.current?.offsetWidth || 0;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  const modalStyle = modalWidth
    ? { width: `${modalWidth}px`, maxWidth: "100%" }
    : {};

  const styles = {
    overlay: {
      position: "fixed",
      inset: 0,
      // Nested modal: lighter, cooler scrim so the parent dialog remains
      // legible behind it — reads as "one level deeper", not a full reset.
      backgroundColor: nested
        ? "rgba(15, 23, 42, 0.35)"
        : "rgba(0, 0, 0, 0.5)",
      backdropFilter: nested ? "blur(2px)" : "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: zIndex ?? (nested ? NESTED_Z : BASE_Z),
      padding: nested
        ? "clamp(16px, 5vw, 40px)"
        : "clamp(12px, 4vw, 20px)",
      boxSizing: "border-box",
    },
    modal: {
      backgroundColor: "#fff",
      borderRadius: nested ? "10px" : "8px",
      boxShadow: nested
        ? "0 20px 60px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(15, 23, 42, 0.06)"
        : "0 10px 40px rgba(0, 0, 0, 0.2)",
      maxWidth: "100%",
      maxHeight: nested ? "85vh" : "90vh",
      display: "flex",
      flexDirection: "column",
      // Nested dialog is deliberately a bit narrower — signals "child form"
      minWidth: nested ? "min(480px, 100%)" : "min(520px, 100%)",
      boxSizing: "border-box",
      width: modalWidth ? undefined : "auto",
      transition: isResizing ? "none" : "width 0.2s ease",
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      padding: "clamp(12px, 3.5vw, 20px) clamp(14px, 4vw, 24px)",
      borderBottom: "1px solid #e5e7eb",
      gap: "16px",
    },
    headerLeft: { flex: 1, minWidth: 0 },
    title: {
      margin: 0,
      fontSize: nested ? "17px" : "18px",
      fontWeight: 600,
      color: "#111827",
      overflowWrap: "anywhere",
    },
    description: {
      margin: "4px 0 0 0",
      fontSize: "14px",
      color: "#6b7280",
    },
    headerActions: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flexShrink: 0,
    },
    iconBtn: {
      background: "none",
      border: "none",
      color: "#9ca3af",
      padding: "4px 6px",
      fontSize: "16px",
      borderRadius: "4px",
      display: "flex",
      alignItems: "center",
      transition: "color 0.15s ease, background 0.15s ease",
    },
    body: {
      padding: "clamp(14px, 4vw, 24px)",
      overflowY: "auto",
      overflowX: "auto",
      flex: 1,
      minHeight: 0,
    },
    footer: {
      padding: "clamp(12px, 3.5vw, 16px) clamp(14px, 4vw, 24px)",
      borderTop: "1px solid #e5e7eb",
      display: "flex",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      gap: "8px",
    },
  };

  const sizeStyles = {
    "modal-sm": { maxWidth: "min(400px, 100%)" },
    "modal-lg": { maxWidth: "min(800px, 100%)" },
    "modal-xl": { maxWidth: "min(1140px, 100%)" },
    "modal-full": { maxWidth: "100%" },
  };
  const sizeStyle = sizeStyles[getSizeClass()] || {};

  return (
    <div
      style={styles.overlay}
      role="presentation"
      // Backdrop-only close. Only fires when the mousedown STARTED on the
      // overlay itself (not a child, not a nested dialog, not the panel).
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={modalRef}
        style={{ ...styles.modal, ...sizeStyle, ...modalStyle }}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <h5 style={styles.title}>{title}</h5>
            {description && <p style={styles.description}>{description}</p>}
          </div>
          <div style={styles.headerActions}>
            <button
              type="button"
              style={{ ...styles.iconBtn, cursor: "ew-resize" }}
              onMouseDown={handleResizeStart}
              title="Drag to resize"
              aria-label="Resize modal"
              onMouseEnter={(e) => (e.currentTarget.style.color = "#111827")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
            >
              <i className="bi bi-arrows-angle-expand" />
            </button>
            <button
              type="button"
              style={{ ...styles.iconBtn, cursor: "pointer" }}
              onClick={onClose}
              aria-label="Close"
              onMouseEnter={(e) => (e.currentTarget.style.color = "#111827")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
            >
              <i className="bi bi-x-lg" />
            </button>
          </div>
        </div>
        <div style={styles.body}>{children}</div>
        {footer && <div style={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}