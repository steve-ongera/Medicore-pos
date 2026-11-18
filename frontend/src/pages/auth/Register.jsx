// src/pages/auth/Register.jsx
// Public sign-up: creates a new pharmacy (tenant), its owner account and a free trial.
// Styled to match the Login page, with a two-column form to keep the card short.
// Logic is unchanged: same registerShop call, validation and redirect.
import { useState } from "react";
import { Link } from "react-router-dom";
import { registerShop } from "../../services/api.js";
import medicoreLogo from "../../assets/login_logo.png";

const empty = { shop_name: "", first_name: "", username: "", phone: "", email: "", password: "", confirm: "" };

// Two equal columns that stack on narrow screens.
const TWO_COL = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  columnGap: "var(--space-4)",
};

export default function Register() {
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (f.password !== f.confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const { confirm, ...payload } = f;
      await registerShop(payload);
      // Full reload so AuthContext picks up the new session from localStorage.
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // Text field with a leading icon, same look as the Login inputs.
  const field = (key, label, icon, props = {}) => (
    <div className="field" style={{ minWidth: 0 }}>
      <label className="field-label" htmlFor={`reg-${key}`}>{label}</label>
      <div className="input-icon-wrap">
        <i className={`bi ${icon} icon`} aria-hidden="true" />
        <input
          id={`reg-${key}`}
          className="input"
          value={f[key]}
          onChange={set(key)}
          disabled={busy}
          {...props}
        />
      </div>
    </div>
  );

  // Password field with the show/hide toggle used on the Login page.
  const passwordField = (key, label, placeholder) => (
    <div className="field" style={{ minWidth: 0 }}>
      <label className="field-label" htmlFor={`reg-${key}`}>{label}</label>
      <div className="input-icon-wrap" style={{ position: "relative" }}>
        <i className="bi bi-lock icon" aria-hidden="true" />
        <input
          id={`reg-${key}`}
          type={showPassword ? "text" : "password"}
          className="input"
          placeholder={placeholder}
          value={f[key]}
          onChange={set(key)}
          disabled={busy}
          autoComplete="new-password"
          style={{ paddingRight: 40 }}
          required
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-tertiary)",
            fontSize: "1.2rem",
            lineHeight: 1,
            zIndex: 10,
          }}
        >
          <i className={`bi bi-eye${showPassword ? "-slash" : ""}`} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="auth-layout-simple__panel auth-card" style={{ maxWidth: 640 }}>
      <div style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: "var(--space-4)",
          }}
        >
          <img
            src={medicoreLogo}
            alt="Medicore POS"
            style={{ height: 90, width: "auto", maxWidth: 200, display: "block" }}
          />
          <span
            style={{
              marginTop: "var(--space-2)",
              fontSize: "0.8rem",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            Medicore POS
          </span>
        </div>
        <h1 className="auth-card__title">Create your pharmacy account</h1>
        <p className="auth-card__subtitle">Start with a free trial. No card needed.</p>
      </div>

      <form onSubmit={submit}>
        {/* Pharmacy name spans the full width */}
        {field("shop_name", "Pharmacy name", "bi-shop", {
          placeholder: "Enter your pharmacy name",
          required: true,
          autoFocus: true,
        })}

        <div style={TWO_COL}>
          {field("first_name", "Your name", "bi-person", { placeholder: "Enter your name" })}
          {field("phone", "Phone", "bi-telephone", { placeholder: "0712345678", inputMode: "tel" })}
          {field("email", "Email", "bi-envelope", { type: "email", placeholder: "you@example.com" })}
          {field("username", "Username", "bi-person-badge", {
            placeholder: "Choose a username",
            required: true,
            autoComplete: "username",
          })}
          {passwordField("password", "Password", "Create a password")}
          {passwordField("confirm", "Confirm password", "Repeat your password")}
        </div>

        {error && (
          <div className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-5)" }}>
            <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
            <div className="alert-message">{error}</div>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? (
            <>
              <span
                className="spinner spinner-inverse"
                style={{ width: 16, height: 16 }}
                aria-hidden="true"
              />
              Creating account...
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <div
        className="auth-card__footer"
        style={{ marginTop: "var(--space-5)", fontSize: "var(--fs-sm)" }}
      >
        Already registered? <Link to="/login">Sign in</Link>
      </div>

      <div
        className="auth-card__footer"
        style={{ marginTop: "var(--space-3)", fontSize: "0.7rem", color: "var(--text-tertiary)" }}
      >
        &copy; {new Date().getFullYear()} Medicore POS
      </div>
    </div>
  );
}