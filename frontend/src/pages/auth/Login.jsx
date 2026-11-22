// src/pages/auth/Login.jsx
// Sign in with email OR username + password. A value containing "@" is sent as
// an email, anything else as a username (api.js login()).
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import AuthShell, { PasswordField } from "../../components/AuthShell.jsx";

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(identifier, password);
      nav(location.state?.from?.pathname || "/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Cloud 360 POS account."
      footer={<>New here? <Link to="/register">Create a shop account</Link></>}
    >
      <form onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor="identifier">Email / Username</label>
          <div className="input-icon-wrap">
            <i className="bi bi-person icon" aria-hidden="true" />
            <input
              id="identifier"
              type="text"
              className="input"
              placeholder="Email or username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={busy}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
            />
          </div>
        </div>

        <PasswordField
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        <div style={{ textAlign: "right", marginTop: "-0.5rem", marginBottom: "var(--space-4)" }}>
          <Link to="/forgot-password" className="text-xs">Forgot password?</Link>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-4)" }}>
            <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
            <div className="alert-message">{error}</div>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner spinner-inverse" style={{ width: "1rem", height: "1rem" }} aria-hidden="true" />
              Signing in...
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>
    </AuthShell>
  );
}