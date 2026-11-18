// src/pages/Login.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../services/api";

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      nav("/pos", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f4f6f8" }}>
      <form
        onSubmit={submit}
        style={{ width: 340, background: "#fff", padding: 28, borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}
      >
        <h2 style={{ margin: "0 0 4px" }}>Medicore POS</h2>
        <p style={{ margin: "0 0 20px", color: "#666", fontSize: 14 }}>Sign in to continue</p>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
          style={{ width: "100%", padding: 10, marginBottom: 10, boxSizing: "border-box" }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: "100%", padding: 10, marginBottom: 10, boxSizing: "border-box" }}
        />
        {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 10 }}>{error}</div>}
        <button disabled={busy} style={{ width: "100%", padding: 10, cursor: "pointer" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
