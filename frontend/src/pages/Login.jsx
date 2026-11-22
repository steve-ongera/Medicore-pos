// src/pages/auth/Login.jsx
// Split-card sign-in (POSLINE-style). Logic is unchanged: same useAuth().login,
// redirect and error handling.
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import AuthShell, { PasswordField } from "../../components/AuthShell.jsx";

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    <AuthShell
      title="Log in"
      subtitle="Welcome back! Please enter your details."
      footer={<>Don&apos;t have an account? <Link to="/register">Create your shop account</Link></>}
    >
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

        <PasswordField
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        {error && (
          <div className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-5)" }}>
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