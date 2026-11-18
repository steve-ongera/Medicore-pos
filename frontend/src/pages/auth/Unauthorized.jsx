// src/pages/auth/Unauthorized.jsx
import { Link } from "react-router-dom";

export default function Unauthorized() {
  return (
    <div className="pos-card" style={{ width: 380 }}>
      <div className="pos-card-body" style={{ textAlign: "center" }}>
        <h2 style={{ marginTop: 0 }}>No access</h2>
        <p style={{ color: "var(--pos-muted)" }}>Your role isn't allowed to open that page.</p>
        <Link to="/dashboard" className="pos-btn pos-btn-primary">Back to dashboard</Link>
      </div>
    </div>
  );
}
