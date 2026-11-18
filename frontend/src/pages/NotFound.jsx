// src/pages/NotFound.jsx
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="pos-empty">
      <h2>Page not found</h2>
      <Link to="/dashboard">Go to dashboard</Link>
    </div>
  );
}
