// src/pages/profile/Profile.jsx
// Restructured to use the global stylesheet (patient-header, card, field, input, btn, badge).
// Logic, state and API calls are unchanged.
import { useState } from "react";
import { toast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext.jsx";
import { changePassword, updateMe } from "../../services/api";
import { ROLE_LABELS } from "../../utils/roles";

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const [f, setF] = useState({
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    email: user.email || "",
    phone: user.phone || "",
  });
  const [pw, setPw] = useState({ old_password: "", new_password: "", confirm: "" });
  const [busy, setBusy] = useState("");

  const saveProfile = async () => {
    setBusy("profile");
    try { refreshUser(await updateMe(f)); toast.success("Profile updated"); }
    catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };

  const savePassword = async () => {
    if (pw.new_password !== pw.confirm) return toast.error("New passwords do not match");
    setBusy("pw");
    try {
      await changePassword({ old_password: pw.old_password, new_password: pw.new_password });
      toast.success("Password changed");
      setPw({ old_password: "", new_password: "", confirm: "" });
    } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;
  const initials = (
    (user.first_name?.[0] || "") + (user.last_name?.[0] || "") || user.username?.slice(0, 2) || "?"
  ).toUpperCase();

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Account</div>
          <h1 className="page-title">My profile</h1>
          <p className="page-subtitle">Manage your personal details and password.</p>
        </div>
      </div>

      {/* Identity summary */}
      <div className="patient-header">
        <div className="avatar avatar-xl">{initials}</div>
        <div className="patient-header__meta">
          <div className="patient-header__name">{fullName}</div>
          <div className="patient-header__sub">
            <span className="patient-header__id">@{user.username}</span>
            <span className="badge badge-primary">{roleLabel}</span>
          </div>
        </div>
        <div className="info-grid" style={{ flex: "2 1 320px" }}>
          <div className="info-item">
            <div className="info-item__label">Email</div>
            <div className="info-item__value">{user.email || "-"}</div>
          </div>
          <div className="info-item">
            <div className="info-item__label">Phone</div>
            <div className="info-item__value">{user.phone || "-"}</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Personal details */}
        <div className="card">
          <div className="card-header">
            <div>
              <h5 className="card-title">Personal details</h5>
              <div className="card-subtitle">Your name and contact information.</div>
            </div>
            <div className="stat-card__icon tone-info"><i className="bi bi-person" aria-hidden="true" /></div>
          </div>
          <div className="card-body">
            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="pf-first">First name</label>
                <input id="pf-first" className="input" value={f.first_name}
                  onChange={(e) => setF({ ...f, first_name: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="pf-last">Last name</label>
                <input id="pf-last" className="input" value={f.last_name}
                  onChange={(e) => setF({ ...f, last_name: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pf-email">Email</label>
              <input id="pf-email" className="input" type="email" value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })} />
            </div>
            <div className="field mb-0">
              <label className="field-label" htmlFor="pf-phone">Phone</label>
              <input id="pf-phone" className="input" value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </div>
          </div>
          <div className="card-footer" style={{ justifyContent: "flex-end" }}>
            <button className={`btn btn-primary ${busy === "profile" ? "is-loading" : ""}`}
              disabled={busy === "profile"} onClick={saveProfile}>
              <i className="bi bi-check-lg" aria-hidden="true" /> Save changes
            </button>
          </div>
        </div>

        {/* Change password */}
        <div className="card">
          <div className="card-header">
            <div>
              <h5 className="card-title">Change password</h5>
              <div className="card-subtitle">Use a strong password you don't use elsewhere.</div>
            </div>
            <div className="stat-card__icon tone-warning"><i className="bi bi-shield-lock" aria-hidden="true" /></div>
          </div>
          <div className="card-body">
            <div className="field">
              <label className="field-label" htmlFor="pf-old">Current password</label>
              <input id="pf-old" className="input" type="password" autoComplete="current-password"
                value={pw.old_password} onChange={(e) => setPw({ ...pw, old_password: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pf-new">New password</label>
              <input id="pf-new" className="input" type="password" autoComplete="new-password"
                value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            </div>
            <div className="field mb-0">
              <label className="field-label" htmlFor="pf-confirm">Confirm new password</label>
              <input id="pf-confirm" className="input" type="password" autoComplete="new-password"
                value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </div>
          </div>
          <div className="card-footer" style={{ justifyContent: "flex-end" }}>
            <button className={`btn btn-primary ${busy === "pw" ? "is-loading" : ""}`}
              disabled={busy === "pw" || !pw.old_password || !pw.new_password} onClick={savePassword}>
              <i className="bi bi-key" aria-hidden="true" /> Update password
            </button>
          </div>
        </div>
      </div>
    </>
  );
}