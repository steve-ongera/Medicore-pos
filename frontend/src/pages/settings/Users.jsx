// src/pages/settings/Users.jsx
// Same page structure and styling as the Dashboard (page-header, table-wrap, data-table).
import { useEffect, useState } from "react";
import { fullName, useFetch } from "../../components/PageKit";
import { toast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext.jsx";
import { createUser, getUsers, updateUser } from "../../services/api";
import { ROLE_LABELS } from "../../utils/roles";

export default function Users() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useFetch(() => getUsers(), []);
  const [modal, setModal] = useState(null); // {} = new, {user} = edit

  const toggle = async (u) => {
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      toast.success(u.is_active ? "Account deactivated" : "Account activated");
      reload();
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (loading && !data) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <span className="loading-screen__label">Loading users…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
        <div className="alert-message">{error}</div>
      </div>
    );
  }

  return (
    <div>
      {/* ==================== HEADER ==================== */}
      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Administration</div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">People who can sign in to this shop's POS.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-primary" onClick={() => setModal({})}>
            <i className="bi bi-plus-lg" aria-hidden="true" /> Add user
          </button>
        </div>
      </div>

      {/* ==================== TABLE ==================== */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <h5 className="card-title">All users</h5>
        </div>

        {!data?.length ? (
          <div className="text-center text-tertiary py-6">No users yet. Add your first user.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-primary">{fullName(u) || u.username}</td>
                    <td className="cell-mono">{u.username}</td>
                    <td><span className="badge badge-primary">{ROLE_LABELS[u.role] || u.role}</span></td>
                    <td className="cell-muted">{u.phone || "-"}</td>
                    <td>
                      {u.is_active
                        ? <span className="badge badge-success">Active</span>
                        : <span className="badge badge-danger">Inactive</span>}
                    </td>
                    <td className="cell-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal({ user: u })}>
                        <i className="bi bi-pencil" aria-hidden="true" /> Edit
                      </button>{" "}
                      {u.id !== me.id && (
                        <button
                          type="button"
                          className={`btn btn-sm ${u.is_active ? "btn-danger-outline" : "btn-outline"}`}
                          onClick={() => toggle(u)}
                        >
                          {u.is_active ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <UserModal
          user={modal.user}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); reload(); }}
        />
      )}
    </div>
  );
}

function UserModal({ user, onClose, onDone }) {
  const editing = !!user;
  const [f, setF] = useState({
    username: user?.username || "",
    first_name: user?.first_name || "",
    last_name: user?.last_name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    role: user?.role || "CASHIER",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const invalid = !f.username || (!editing && f.password.length < 6);

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        const { password, username, ...rest } = f;
        await updateUser(user.id, rest);
      } else {
        await createUser(f);
      }
      toast.success(editing ? "User updated" : "User added");
      onDone();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true" aria-label={editing ? "Edit user" : "Add user"}>
        <div className="modal-header">
          <div>
            <h4 className="modal-title">{editing ? `Edit ${user.username}` : "Add user"}</h4>
            <p className="modal-desc">
              {editing ? "Update this person's details and role." : "Create a login for a new member of staff."}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="u-username">Username <span className="required">*</span></label>
              <input id="u-username" className="input" value={f.username} onChange={set("username")} disabled={editing} />
            </div>
            {!editing && (
              <div className="field">
                <label className="field-label" htmlFor="u-password">Password <span className="required">*</span></label>
                <input id="u-password" className="input" type="password" value={f.password} onChange={set("password")} />
                <span className="field-hint">Minimum 6 characters</span>
              </div>
            )}
            <div className="field">
              <label className="field-label" htmlFor="u-first">First name</label>
              <input id="u-first" className="input" value={f.first_name} onChange={set("first_name")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="u-last">Last name</label>
              <input id="u-last" className="input" value={f.last_name} onChange={set("last_name")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="u-email">Email</label>
              <input id="u-email" className="input" type="email" value={f.email} onChange={set("email")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="u-phone">Phone</label>
              <input id="u-phone" className="input" value={f.phone} onChange={set("phone")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="u-role">Role</label>
              <select id="u-role" className="select" value={f.role} onChange={set("role")}>
                {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={`btn btn-primary${busy ? " is-loading" : ""}`}
            disabled={busy || invalid}
            onClick={save}
          >
            {editing ? "Save changes" : "Add user"}
          </button>
        </div>
      </div>
    </div>
  );
}