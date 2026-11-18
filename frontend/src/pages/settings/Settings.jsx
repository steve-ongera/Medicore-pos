// src/pages/settings/Settings.jsx
// Same page structure and styling as the Dashboard (page-header, card, field, input, btn).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFetch } from "../../components/PageKit";
import { toast } from "../../context/ToastContext";
import { getShopSettings, updateShopSettings } from "../../services/api";

export default function Settings() {
  const { data, loading, error } = useFetch(() => getShopSettings(), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data) setF(data); }, [data]);

  if (loading && !f) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <span className="loading-screen__label">Loading settings…</span>
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

  if (!f) return null;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      setF(await updateShopSettings(f));
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* ==================== HEADER ==================== */}
      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="page-eyebrow">Administration</div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Shop details printed on receipts, and alert thresholds.</p>
        </div>
        <div className="page-header__actions">
          <Link to="/users" className="btn btn-secondary">
            <i className="bi bi-people" aria-hidden="true" /> Manage users
          </Link>
          <button
            type="button"
            className={`btn btn-primary${busy ? " is-loading" : ""}`}
            disabled={busy}
            onClick={save}
          >
            <i className="bi bi-check-lg" aria-hidden="true" /> Save settings
          </button>
        </div>
      </div>

      {/* ==================== SHOP DETAILS ==================== */}
      <div className="card mb-4">
        <div className="card-header">
          <h5 className="card-title">Shop details</h5>
        </div>
        <div className="card-body">
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="s-name">Shop name</label>
              <input id="s-name" className="input" value={f.name || ""} onChange={set("name")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="s-phone">Phone</label>
              <input id="s-phone" className="input" value={f.phone || ""} onChange={set("phone")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="s-email">Email</label>
              <input id="s-email" className="input" type="email" value={f.email || ""} onChange={set("email")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="s-kra">KRA PIN</label>
              <input id="s-kra" className="input" value={f.kra_pin || ""} onChange={set("kra_pin")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="s-address">Address</label>
              <input id="s-address" className="input" value={f.address || ""} onChange={set("address")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="s-currency">Currency</label>
              <input id="s-currency" className="input" value={f.currency || ""} onChange={set("currency")} maxLength={5} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="s-footer">Receipt footer</label>
              <input id="s-footer" className="input" value={f.receipt_footer || ""} onChange={set("receipt_footer")} />
            </div>
          </div>
        </div>
      </div>

      {/* ==================== ALERTS ==================== */}
      <div className="card">
        <div className="card-header">
          <h5 className="card-title">Alerts</h5>
        </div>
        <div className="card-body">
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="s-expiry">Warn about batches expiring within (days)</label>
              <input
                id="s-expiry"
                className="input"
                type="number"
                min="1"
                value={f.expiry_alert_days ?? ""}
                onChange={set("expiry_alert_days")}
              />
              <span className="field-hint">Used by the dashboard and the expiry reports.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}