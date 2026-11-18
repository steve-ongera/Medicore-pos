// src/pages/auth/Login.jsx
// HMIS-style sign-in card. Logic is unchanged: same useAuth().login, redirect and error handling.
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import medicoreLogo from "../../assets/login_logo.png";

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      nav(location.state?.from?.pathname || "/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-layout-simple__panel auth-card" style={{ maxWidth: 440 }}>
      <div style={{ textAlign: "center", marginBottom: "var(--space-8)" }}>
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: "var(--space-5)",
          }}
        >
          <img
            src={medicoreLogo}
            alt="Medicore POS"
            style={{ height: 120, width: "auto", maxWidth: 240, display: "block" }}
          />
          <span
            style={{
              marginTop: "var(--space-3)",
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
        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">Sign in to your account to continue</p>
      </div>

      <form onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor="username">Username</label>
          <div className="input-icon-wrap">
            <i className="bi bi-person icon" aria-hidden="true" />
            <input
              id="username"
              type="text"
              className="input"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="password">Password</label>
          <div className="input-icon-wrap" style={{ position: "relative" }}>
            <i className="bi bi-lock icon" aria-hidden="true" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              className="input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete="current-password"
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
              Signing in...
            </>
          ) : (
            "Sign In"
          )}
        </button>
      </form>

      <div
        className="auth-card__footer"
        style={{ marginTop: "var(--space-6)", fontSize: "var(--fs-sm)" }}
      >
        New pharmacy? <Link to="/register">Create an account</Link>
      </div>

      <div
        className="auth-card__footer"
        style={{ marginTop: "var(--space-4)", fontSize: "0.7rem", color: "var(--text-tertiary)" }}
      >
        &copy; {new Date().getFullYear()} Medicore POS
      </div>
    </div>
  );
}