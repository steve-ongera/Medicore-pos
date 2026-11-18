// src/layouts/AuthLayout.jsx  - fallback; use your HMIS AuthLayout if you prefer.
import { Outlet } from "react-router-dom";

export default function AuthLayout() {
  return <div className="pos-auth"><Outlet /></div>;
}
