// src/components/AuthShell.jsx
// Shared layout for Login and Register: plain illustration panel on the left,
// plain white form side on the right (no card). On phones the illustration
// panel is hidden and a compact logo sits above the form.
import { useState } from "react";
import cloud360Logo from "../assets/login_logo.png";
import cashier from "../assets/auth_cashier.png";

export function PasswordField({
  id,
  label = "Password",
  value,
  onChange,
  placeholder = "Enter your password",
  autoComplete = "current-password",
  disabled,
  required = true,
  hasError,
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="input-icon-wrap">
        <i className="bi bi-lock icon" aria-hidden="true" />
        <input
          id={id}
          type={show ? "text" : "password"}
          className={`input${hasError ? " has-error" : ""}`}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          autoComplete={autoComplete}
          style={{ paddingRight: "2.5rem" }}
          required={required}
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          tabIndex={-1}
        >
          <i className={`bi bi-eye${show ? "-slash" : ""}`} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function AuthShell({ title, subtitle, children, footer, wide = false }) {
  const year = new Date().getFullYear();
  return (
    <div className="auth-page">
      <aside className="auth-aside" aria-hidden="true">
        <div className="auth-art">
          <div className="auth-art__blob" />
          <div className="auth-art__blob auth-art__blob--back" />
          <img className="auth-art__person" src={cashier} alt="" />
          <div className="auth-art__counter" />
        </div>

        <div className="auth-aside__foot">&copy; {year} Cloud 360 POS</div>
      </aside>

      <main className="auth-main">
        <div className={`auth-panel${wide ? " is-wide" : ""}`}>
          <div className="auth-mbrand">
            <img src={cloud360Logo} alt="Cloud 360 POS" />
            <span>Cloud 360 POS</span>
          </div>

          <h1 className="auth-heading">{title}</h1>
          <p className="auth-sub">{subtitle}</p>

          {children}

          {footer && <div className="auth-footer-line">{footer}</div>}
          <div className="auth-copy">&copy; {year} Cloud 360 POS</div>
        </div>
      </main>
    </div>
  );
}