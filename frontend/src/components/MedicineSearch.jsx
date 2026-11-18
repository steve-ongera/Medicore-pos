// src/components/MedicineSearch.jsx
//
// Reusable medicine search box. Uses /medicines/autocomplete/ (searchMedicines)
// by default. Mirrors PatientSearch: debounced, ignores out-of-order responses,
// and clears the selection if the user edits the text afterwards, so a stale
// medicine can't be submitted by mistake.
//
// BROWSE MODE
//   With the built-in search, click the box to see EVERY visible medicine
//   (scrollable); type to narrow by name or generic name. Pages that pass their
//   own `searchFn` keep the old "type at least 2 characters" behaviour unless
//   they also pass `minChars`.
//
// Results are shown in a clean two-column table (Medicine | Price). If
// `renderOption` is passed, each row is a single full-width cell containing
// whatever that function returns (the cell is allowed to shrink so long names
// truncate and the Edit column always stays visible).
//
// CLINICAL STAFF TOOLS (fully opt-out)
//   Doctors, nurses, pharmacists, Super Admin and Group Admin get:
//     * an "Edit" button on every result row. The modal changes the medicine's
//       details, its visibility and the stock available at THEIR branch.
//       Save stays disabled until something actually changes.
//     * an "Add new medicine" option when the medicine they need isn't found.
//       It creates the medicine plus a stock batch at their branch, then
//       selects it so the order can continue. Pharmacy can verify it later.
//   Hidden medicines are removed from normal pickers; editors still see them
//   (greyed out, not selectable) so they can un-hide them.
//   Everyone else sees the component exactly as before.
//
// EXTRA EXPORTS (for pages that render their own medicine lists)
//   MedicineEditModal   the edit pop-up
//   MedicineAddModal    the add pop-up
//   useCanEditMedicine  true when the current user may edit/add medicines
//
// Props
//   onSelect(medicine)  called when the user picks a medicine         (required)
//   onClear()           called when the user edits the text after a selection
//   label               field label                      (default "Medicine")
//   required            shows the red * on the label     (default false)
//   error               validation message shown under the input
//   placeholder         input placeholder
//   minChars            characters needed before searching. Default 0 (click to
//                       browse everything) with the built-in search; default 2
//                       when a custom searchFn is passed.
//   debounceMs          wait after typing before calling API (default 300)
//   disabled            disable the input
//   showPrice           show "KES <unit_price>" in results   (default true)
//   id                  input id (use a unique one if several on one page)
//   (Built-in search caches the full list for 1 minute and filters it in the
//    browser. Pages that edit medicines elsewhere should call the exported
//    clearMedicineCache() afterwards.)
//   searchFn(query)     async fn returning an array of medicines. Defaults to
//                       /medicines/autocomplete/. Pass a custom one when a page
//                       needs different data, e.g. the full medicine list:
//                         searchFn={async (q) => {
//                           const d = await getMedicines({ search: q, visible_only: true });
//                           return d.results ?? d;
//                         }}
//   renderOption(m)     optional. Returns the content of each result row, e.g.
//                       to show stock levels or generic names.
//   editable            set false on a page to turn the edit feature off  (default true)
//   allowCreate         set false on a page to turn "Add new medicine" off (default true)
//   canEdit             optional override. By default the component works out
//                       the current user's role itself (one cached /auth/me/ call).
//   onMedicineUpdated(m) called after a successful edit with the updated medicine
//   onMedicineCreated(m) called after a new medicine is added (it is also
//                        passed to onSelect, so most pages need nothing extra)
//
// To clear the box from the parent (e.g. after saving), change the component's
// `key`:  <MedicineSearch key={medKey} ... />  then  setMedKey(k => k + 1).
//
// Example
//   <MedicineSearch
//     required
//     onSelect={(m) => setForm((f) => ({ ...f, medicine: m.id }))}
//     onClear={() => setForm((f) => ({ ...f, medicine: "" }))}
//   />

import { useState, useEffect, useRef, useMemo } from "react";
import {
  searchMedicines,
  updateMedicine,
  getMe,
  quickAddMedicine,
  getMedicineBranchStock,
  setMedicineStock,
} from "../services/api";
import Modal from "./Modal";

// Roles that may edit/add a medicine (must match MEDICINE_EDIT_ROLES on the backend).
const EDIT_ROLES = ["DOCTOR", "NURSE", "PHARMACIST", "SUPER_ADMIN", "GROUP_ADMIN"];

// One shared /auth/me/ lookup for every MedicineSearch on the page.
let rolePromise = null;
const fetchRole = () => {
  if (!rolePromise) {
    rolePromise = getMe()
      .then((u) => u?.role || null)
      .catch(() => {
        rolePromise = null; // allow a retry later
        return null;
      });
  }
  return rolePromise;
};

// For pages that render their own medicine lists and need the same edit rights.
export function useCanEditMedicine() {
  const [role, setRole] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchRole().then((r) => alive && setRole(r));
    return () => {
      alive = false;
    };
  }, []);
  return EDIT_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Medicine list cache (shared by every MedicineSearch on the page).
// The full list is fetched ONCE, then typing filters it in the browser, so
// there is no server round trip per keystroke. Cached per "include hidden"
// mode, expires after CACHE_TTL, and is cleared after any edit / add.
// ---------------------------------------------------------------------------
const CACHE_TTL = 60 * 1000; // 1 minute
const SEARCH_LIMIT = 50; // max rows shown while typing
const medCache = {}; // key -> { at, list, promise }

export const clearMedicineCache = () => {
  Object.keys(medCache).forEach((k) => delete medCache[k]);
};

const loadFullList = (includeHidden) => {
  const key = String(!!includeHidden);
  const entry = medCache[key];
  if (entry && Date.now() - entry.at < CACHE_TTL) {
    return entry.promise; // cached list, or a request already in flight
  }
  const promise = searchMedicines("", { includeHidden })
    .then((data) => (Array.isArray(data) ? data : data?.results || []))
    .catch((err) => {
      delete medCache[key]; // never cache a failure
      throw err;
    });
  medCache[key] = { at: Date.now(), promise };
  return promise;
};

const defaultSearchFn = async (query, includeHidden) => {
  const list = await loadFullList(includeHidden);
  const q = (query || "").trim().toLowerCase();
  if (!q) return list; // browse mode: everything
  return list
    .filter(
      (m) =>
        m.name?.toLowerCase().includes(q) ||
        m.generic_name?.toLowerCase().includes(q)
    )
    .slice(0, SEARCH_LIMIT);
};

const isHidden = (m) => m?.is_visible === false;

// Turns the wrapped API error into one readable sentence.
const errorText = (err, fallback) => {
  const e = err?.errors;
  if (e && typeof e === "object") {
    const parts = Object.entries(e).map(([k, v]) => {
      const msg = Array.isArray(v) ? v.join(" ") : typeof v === "object" ? JSON.stringify(v) : String(v);
      return k === "detail" || k === "non_field_errors" ? msg : `${k.replace(/_/g, " ")}: ${msg}`;
    });
    if (parts.length) return parts.join(" ");
  }
  return err?.message || fallback;
};

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ---------------------------------------------------------------------------
// Edit-form helpers
// ---------------------------------------------------------------------------
const toForm = (m) => ({
  name: m.name ?? "",
  generic_name: m.generic_name ?? "",
  category: m.category ?? "",
  unit: m.unit ?? "",
  unit_price: m.unit_price ?? "",
  insurance_price: m.insurance_price ?? "",
  reorder_level: m.reorder_level ?? "",
  is_visible: m.is_visible !== false,
});

const sameNumber = (a, b) => {
  if ((a === "" || a == null) && (b === "" || b == null)) return true;
  return Number(a) === Number(b);
};

// Only the fields that really changed, in the shape the API expects.
const buildPatch = (original, form) => {
  const o = toForm(original);
  const patch = {};
  ["name", "generic_name", "category", "unit"].forEach((k) => {
    if (form[k].trim() !== String(o[k]).trim()) patch[k] = form[k].trim();
  });
  if (!sameNumber(form.unit_price, o.unit_price)) patch.unit_price = form.unit_price;
  if (!sameNumber(form.insurance_price, o.insurance_price)) {
    patch.insurance_price = form.insurance_price === "" ? null : form.insurance_price;
  }
  if (!sameNumber(form.reorder_level, o.reorder_level)) patch.reorder_level = form.reorder_level;
  if (form.is_visible !== o.is_visible) patch.is_visible = form.is_visible;
  return patch;
};

const validateForm = (form) => {
  const errs = {};
  if (!form.name.trim()) errs.name = "Name is required.";
  if (form.unit_price === "" || Number(form.unit_price) < 0 || Number.isNaN(Number(form.unit_price))) {
    errs.unit_price = "Enter a valid price (0 or more).";
  }
  if (form.insurance_price !== "" && (Number(form.insurance_price) < 0 || Number.isNaN(Number(form.insurance_price)))) {
    errs.insurance_price = "Enter a valid price (0 or more).";
  }
  if (form.reorder_level !== "" && (!Number.isInteger(Number(form.reorder_level)) || Number(form.reorder_level) < 0)) {
    errs.reorder_level = "Whole number, 0 or more.";
  }
  return errs;
};

// ---------------------------------------------------------------------------
// Add-form helpers
// ---------------------------------------------------------------------------
const emptyAddForm = (name = "") => ({
  name,
  generic_name: "",
  category: "",
  unit: "tablet",
  unit_price: "",
  insurance_price: "",
  quantity: "",
  reorder_level: "",
  expiry_date: "",
});

const validateAdd = (form) => {
  const errs = {};
  if (!form.name.trim()) errs.name = "Name is required.";
  if (form.unit_price === "" || Number.isNaN(Number(form.unit_price)) || Number(form.unit_price) <= 0) {
    errs.unit_price = "Enter the selling price (more than 0).";
  }
  if (form.quantity === "" || !Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 1) {
    errs.quantity = "Whole number, 1 or more.";
  }
  if (form.insurance_price !== "" && (Number.isNaN(Number(form.insurance_price)) || Number(form.insurance_price) < 0)) {
    errs.insurance_price = "Enter a valid price (0 or more).";
  }
  if (form.reorder_level !== "" && (!Number.isInteger(Number(form.reorder_level)) || Number(form.reorder_level) < 0)) {
    errs.reorder_level = "Whole number, 0 or more.";
  }
  if (form.expiry_date && form.expiry_date < todayStr()) {
    errs.expiry_date = "Expiry date is in the past.";
  }
  return errs;
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const panelStyle = {
  position: "absolute",
  width: "100%",
  marginTop: "var(--space-1)",
  background: "var(--surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  zIndex: 1000,
};

const messageStyle = {
  ...panelStyle,
  padding: "var(--space-2) var(--space-3)",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
};

const thStyle = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  padding: "var(--space-2) var(--space-3)",
  background: "var(--surface)",
  borderBottom: "1px solid var(--border-default)",
  color: "var(--text-muted, #6b7280)",
  fontSize: "0.75rem",
  fontWeight: 600,
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "var(--space-2) var(--space-3)",
  verticalAlign: "middle",
};

const badgeStyle = {
  display: "inline-block",
  marginLeft: 8,
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid var(--border-default)",
  fontSize: "0.65rem",
  fontWeight: 600,
  color: "var(--text-muted, #6b7280)",
  verticalAlign: "middle",
};

const editBtnStyle = {
  padding: "2px 8px",
  fontSize: "0.75rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-default)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

const addBtnStyle = {
  ...editBtnStyle,
  padding: "3px 10px",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const addFooterStyle = {
  position: "sticky",
  bottom: 0,
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-3)",
  background: "var(--surface)",
  borderTop: "1px solid var(--border-default)",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "var(--space-3)",
};

const footerHintStyle = {
  marginRight: "auto",
};

// ---------------------------------------------------------------------------
// Edit modal (rendered as a NESTED Modal so it stacks cleanly on top of the
// parent dialog without hand-rolled portals or z-index juggling).
// ---------------------------------------------------------------------------
export function MedicineEditModal({ medicine, onClose, onSaved }) {
  const [form, setForm] = useState(() => toForm(medicine));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Stock at the user's own branch (loaded when the modal opens).
  const [stock, setStock] = useState("");
  const [origStock, setOrigStock] = useState(null);
  const [stockState, setStockState] = useState("loading"); // loading | ready | error

  useEffect(() => {
    let alive = true;
    getMedicineBranchStock(medicine.id)
      .then((r) => {
        if (!alive) return;
        if (r?.quantity == null) {
          setStockState("error");
          return;
        }
        setOrigStock(Number(r.quantity));
        setStock(String(r.quantity));
        setStockState("ready");
      })
      .catch(() => alive && setStockState("error"));
    return () => {
      alive = false;
    };
  }, [medicine.id]);

  const patch = useMemo(() => buildPatch(medicine, form), [medicine, form]);
  const patchDirty = Object.keys(patch).length > 0;
  const errors = validateForm(form);

  const stockError =
    stockState === "ready" &&
    (stock === "" || !Number.isInteger(Number(stock)) || Number(stock) < 0)
      ? "Whole number, 0 or more."
      : "";
  const stockDirty =
    stockState === "ready" && !stockError && Number(stock) !== origStock;

  const dirty = patchDirty || stockDirty;
  const valid = Object.keys(errors).length === 0 && !stockError;

  const set = (key) => (e) => {
    setSaveError("");
    setForm((f) => ({
      ...f,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  const handleSave = async () => {
    if (!dirty || !valid || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      let result = medicine;
      if (patchDirty) {
        const updated = await updateMedicine(medicine.id, patch);
        result = { ...result, ...updated };
      }
      if (stockDirty) {
        const r = await setMedicineStock(medicine.id, {
          quantity: Number(stock),
          reason: "Edited from medicine search",
        });
        result = { ...result, ...(r?.medicine || {}) };
      }
      onSaved(result);
    } catch (err) {
      setSaveError(errorText(err, "Could not save changes."));
      setSaving(false);
    }
  };

  const fieldError = (k) =>
    dirty && errors[k] ? <div className="field-error">{errors[k]}</div> : null;

  const footer = (
    <>
      <span className="text-xs text-muted" style={footerHintStyle}>
        {dirty ? "Unsaved changes" : "No changes yet"}
      </span>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={requestClose}
        disabled={saving}
      >
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={handleSave}
        disabled={!dirty || !valid || saving}
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </>
  );

  return (
    <Modal
      nested
      show
      onClose={requestClose}
      title="Edit medicine"
      size="sm"
      footer={footer}
    >
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <div className="field">
          <label className="field-label">
            Name <span className="required">*</span>
          </label>
          <input
            className={`input ${errors.name && dirty ? "has-error" : ""}`}
            value={form.name}
            onChange={set("name")}
            autoFocus
          />
          {fieldError("name")}
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">Generic name</label>
            <input
              className="input"
              value={form.generic_name}
              onChange={set("generic_name")}
            />
          </div>
          <div className="field">
            <label className="field-label">Category</label>
            <input
              className="input"
              value={form.category}
              onChange={set("category")}
            />
          </div>
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">Unit</label>
            <input
              className="input"
              value={form.unit}
              onChange={set("unit")}
              placeholder="tablet, syrup..."
            />
          </div>
          <div className="field">
            <label className="field-label">Reorder level</label>
            <input
              className="input"
              type="number"
              min="0"
              step="1"
              value={form.reorder_level}
              onChange={set("reorder_level")}
            />
            {fieldError("reorder_level")}
          </div>
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">
              Unit price (KES) <span className="required">*</span>
            </label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.unit_price}
              onChange={set("unit_price")}
            />
            {fieldError("unit_price")}
          </div>
          <div className="field">
            <label className="field-label">Insurance price (KES)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.insurance_price}
              onChange={set("insurance_price")}
              placeholder="Same as unit price"
            />
            {fieldError("insurance_price")}
          </div>
        </div>

        <div className="field">
          <label className="field-label">Stock available (this branch)</label>
          <input
            className={`input ${stockError ? "has-error" : ""}`}
            type="number"
            min="0"
            step="1"
            value={stock}
            onChange={(e) => {
              setSaveError("");
              setStock(e.target.value);
            }}
            disabled={stockState !== "ready"}
            placeholder={stockState === "loading" ? "Loading..." : ""}
          />
          {stockError && <div className="field-error">{stockError}</div>}
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            {stockState === "error"
              ? "Couldn't load stock for this branch, so it can't be edited right now."
              : "Changing this adjusts your branch's stock. The change is logged so the pharmacist can see it."}
          </div>
        </div>

        <label
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={form.is_visible}
            onChange={set("is_visible")}
          />
          <span>
            <strong>Visible in medicine search</strong>
            <span className="text-xs text-muted" style={{ display: "block" }}>
              Turn off to hide this medicine from pickers so it can't be selected
              or prescribed.
            </span>
          </span>
        </label>

        {saveError && (
          <div className="field-error" style={{ marginTop: "var(--space-1)" }}>
            {saveError}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Add-medicine modal: creates the medicine AND its first stock batch.
// ---------------------------------------------------------------------------
export function MedicineAddModal({ initialName, onClose, onCreated }) {
  const initial = useMemo(() => emptyAddForm(initialName), [initialName]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [tried, setTried] = useState(false);

  const errors = validateAdd(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const set = (key) => (e) => {
    setSaveError("");
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm("Discard this new medicine?")) return;
    onClose();
  };

  const handleSave = async () => {
    if (saving) return;
    setTried(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload = {
        name: form.name.trim(),
        generic_name: form.generic_name.trim(),
        category: form.category.trim(),
        unit: form.unit.trim() || "tablet",
        unit_price: form.unit_price,
        insurance_price: form.insurance_price === "" ? null : form.insurance_price,
        quantity: Number(form.quantity),
      };
      if (form.reorder_level !== "") payload.reorder_level = Number(form.reorder_level);
      if (form.expiry_date) payload.expiry_date = form.expiry_date;
      const created = await quickAddMedicine(payload);
      onCreated(created);
    } catch (err) {
      setSaveError(errorText(err, "Could not add the medicine."));
      setSaving(false);
    }
  };

  const fieldError = (k) =>
    tried && errors[k] ? <div className="field-error">{errors[k]}</div> : null;

  const footer = (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={requestClose}
        disabled={saving}
      >
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "Adding..." : "Add & select"}
      </button>
    </>
  );

  return (
    <Modal
      nested
      show
      onClose={requestClose}
      title="Add new medicine"
      size="sm"
      footer={footer}
    >
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <div className="text-xs text-muted">
          This adds the medicine and a stock batch at your branch right away, so
          you can prescribe it now. The pharmacist can verify the details later.
        </div>

        <div className="field">
          <label className="field-label">
            Name <span className="required">*</span>
          </label>
          <input
            className={`input ${tried && errors.name ? "has-error" : ""}`}
            value={form.name}
            onChange={set("name")}
            autoFocus
          />
          {fieldError("name")}
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">Generic name</label>
            <input
              className="input"
              value={form.generic_name}
              onChange={set("generic_name")}
            />
          </div>
          <div className="field">
            <label className="field-label">Category</label>
            <input
              className="input"
              value={form.category}
              onChange={set("category")}
            />
          </div>
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">Unit</label>
            <input
              className="input"
              value={form.unit}
              onChange={set("unit")}
              placeholder="tablet, syrup..."
            />
          </div>
          <div className="field">
            <label className="field-label">
              Quantity available <span className="required">*</span>
            </label>
            <input
              className={`input ${tried && errors.quantity ? "has-error" : ""}`}
              type="number"
              min="1"
              step="1"
              value={form.quantity}
              onChange={set("quantity")}
            />
            {fieldError("quantity")}
          </div>
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">
              Unit price (KES) <span className="required">*</span>
            </label>
            <input
              className={`input ${tried && errors.unit_price ? "has-error" : ""}`}
              type="number"
              min="0"
              step="0.01"
              value={form.unit_price}
              onChange={set("unit_price")}
            />
            {fieldError("unit_price")}
          </div>
          <div className="field">
            <label className="field-label">Insurance price (KES)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.insurance_price}
              onChange={set("insurance_price")}
              placeholder="Same as unit price"
            />
            {fieldError("insurance_price")}
          </div>
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">Expiry date</label>
            <input
              className={`input ${tried && errors.expiry_date ? "has-error" : ""}`}
              type="date"
              min={todayStr()}
              value={form.expiry_date}
              onChange={set("expiry_date")}
            />
            {fieldError("expiry_date")}
          </div>
          <div className="field">
            <label className="field-label">Reorder level</label>
            <input
              className="input"
              type="number"
              min="0"
              step="1"
              value={form.reorder_level}
              onChange={set("reorder_level")}
              placeholder="20"
            />
            {fieldError("reorder_level")}
          </div>
        </div>
        <div className="text-xs text-muted" style={{ marginTop: "calc(var(--space-2) * -1)" }}>
          Not sure of the expiry? Leave it blank. The pharmacist can update it.
        </div>

        {saveError && (
          <div className="field-error" style={{ marginTop: "var(--space-1)" }}>
            {saveError}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function MedicineSearch({
  onSelect,
  onClear,
  label = "Medicine",
  required = false,
  error = "",
  placeholder = "Click to browse or type to search medicine...",
  minChars: minCharsProp,
  debounceMs = 300,
  disabled = false,
  showPrice = true,
  id = "medicine_search",
  searchFn,
  renderOption,
  editable = true,
  allowCreate = true,
  canEdit,
  onMedicineUpdated,
  onMedicineCreated,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(null); // string (prefilled name) when the add modal is open
  const [role, setRole] = useState(null);

  const requestId = useRef(0); // ignore out-of-order responses
  const timer = useRef(null);
  const blurTimer = useRef(null);

  // Browse-all mode only applies to the built-in search. Pages that pass their
  // own searchFn keep the old "type 2+ characters" behaviour unless they say
  // otherwise, so existing pages are unaffected.
  const minChars = minCharsProp ?? (searchFn ? 2 : 0);

  // Work out whether this user may edit (skipped when the page passes canEdit).
  useEffect(() => {
    if (!editable || canEdit !== undefined) return;
    let alive = true;
    fetchRole().then((r) => alive && setRole(r));
    return () => {
      alive = false;
    };
  }, [editable, canEdit]);

  const userCanEdit =
    editable && (canEdit !== undefined ? !!canEdit : EDIT_ROLES.includes(role));
  const userCanCreate = userCanEdit && allowCreate;

  // Always call the latest search function (role may arrive after first render).
  const searchRef = useRef();
  searchRef.current = searchFn || ((q) => defaultSearchFn(q, userCanEdit));

  // Clean up pending timers on unmount
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(blurTimer.current);
    },
    []
  );

  const runSearch = (query) => {
    clearTimeout(timer.current);
    const q = (query || "").trim();

    if (q.length < minChars) {
      requestId.current += 1; // invalidate in-flight requests
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    timer.current = setTimeout(async () => {
      const myId = ++requestId.current;
      try {
        const list = await searchRef.current(q);
        if (myId !== requestId.current) return; // a newer search started
        setResults(Array.isArray(list) ? list : []);
      } catch (err) {
        if (myId === requestId.current) setResults([]);
        console.error("Medicine search failed:", err);
      } finally {
        if (myId === requestId.current) setSearching(false);
      }
    }, debounceMs);
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    setOpen(true);
    runSearch(value);

    // Typing again invalidates the previous selection
    if (selected) {
      setSelected(null);
      onClear?.();
    }
  };

  const handleSelect = (medicine) => {
    if (isHidden(medicine)) return; // hidden medicines can be edited, never picked
    setSelected(medicine);
    setSearchTerm(medicine.name);
    setResults([]);
    setOpen(false);
    onSelect?.(medicine);
  };

  const openEditor = (medicine) => {
    clearTimeout(blurTimer.current);
    setOpen(false);
    setEditing(medicine);
  };

  const openAdder = () => {
    clearTimeout(blurTimer.current);
    setOpen(false);
    setAdding(searchTerm.trim());
  };

  const handleSaved = (updated) => {
    clearMedicineCache(); // next open re-fetches fresh prices / stock / visibility
    setEditing(null);
    setResults((prev) =>
      prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
    );
    if (selected?.id === updated.id) {
      if (isHidden(updated)) {
        // It was just hidden: drop the selection so it can't be submitted.
        setSelected(null);
        setSearchTerm("");
        onClear?.();
      } else {
        setSelected(updated);
        setSearchTerm(updated.name);
      }
    }
    onMedicineUpdated?.(updated);
  };

  const handleCreated = (created) => {
    clearMedicineCache(); // the new medicine must appear in the list
    setAdding(null);
    handleSelect(created); // pick it straight away so the order can continue
    onMedicineCreated?.(created);
  };

  const longEnough = searchTerm.trim().length >= minChars;
  const hasPrice = (m) => m.unit_price != null && m.unit_price !== "";

  // Keeps focus in the input and stops the click from reaching a result row.
  const addButtonHandlers = {
    onMouseDown: (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAdder();
    },
  };

  const trimmedTerm = searchTerm.trim();
  const addLabel = trimmedTerm ? `+ Add "${trimmedTerm}"` : "+ Add new medicine";
  const addFooterLabel = trimmedTerm
    ? `+ Add "${trimmedTerm}" as new medicine`
    : "+ Add new medicine";

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label} {required && <span className="required">*</span>}
      </label>

      <div style={{ position: "relative" }}>
        <input
          id={id}
          type="text"
          autoComplete="off"
          className={`input ${error ? "has-error" : ""}`}
          placeholder={placeholder}
          value={searchTerm}
          disabled={disabled}
          onChange={handleInputChange}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            if (selected || !longEnough) return;
            setOpen(true);
            // Browse mode: load the full list the first time the box is opened.
            if (results.length === 0) runSearch(searchTerm);
          }}
          // Delay so onMouseDown on a result fires before the list closes
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 200);
          }}
        />

        {open && searching && results.length === 0 && (
          <div className="text-xs text-muted" style={messageStyle}>
            {trimmedTerm ? "Searching..." : "Loading medicines..."}
          </div>
        )}

        {open && !searching && results.length === 0 && longEnough && !selected && (
          <div
            className="text-xs text-muted"
            style={{
              ...messageStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-2)",
            }}
          >
            <span>No medicines found</span>
            {userCanCreate && (
              <button
                type="button"
                style={addBtnStyle}
                title="Add this as a new medicine"
                {...addButtonHandlers}
              >
                {addLabel}
              </button>
            )}
          </div>
        )}

        {open && results.length > 0 && (
          <div
            style={{
              ...panelStyle,
              boxShadow: "var(--shadow-lg)",
              maxHeight: 300,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            <table style={tableStyle}>
              {!renderOption && (
                <thead>
                  <tr>
                    <th style={thStyle}>Medicine</th>
                    {showPrice && (
                      <th style={{ ...thStyle, textAlign: "right" }}>Price</th>
                    )}
                    {userCanEdit && <th style={thStyle} aria-label="Actions" />}
                  </tr>
                </thead>
              )}
              <tbody>
                {results.map((m, i) => {
                  const hidden = isHidden(m);
                  return (
                    <tr
                      key={m.id}
                      style={{
                        cursor: hidden ? "not-allowed" : "pointer",
                        opacity: hidden ? 0.55 : 1,
                        borderBottom:
                          i === results.length - 1
                            ? "none"
                            : "1px solid var(--border-default)",
                        transition:
                          "background var(--duration-fast) var(--ease-standard)",
                      }}
                      onMouseDown={() => handleSelect(m)}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--surface-hover)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      {renderOption ? (
                        // width:100% + maxWidth:0 lets the cell shrink so long
                        // names truncate and the Edit column stays in view.
                        <td style={{ ...tdStyle, width: "100%", maxWidth: 0 }}>
                          {hidden && (
                            <span
                              style={{
                                ...badgeStyle,
                                marginLeft: 0,
                                marginRight: 8,
                              }}
                            >
                              Hidden
                            </span>
                          )}
                          {renderOption(m)}
                        </td>
                      ) : (
                        <>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>
                            {m.name}
                            {hidden && <span style={badgeStyle}>Hidden</span>}
                          </td>
                          {showPrice && (
                            <td
                              className="text-muted"
                              style={{
                                ...tdStyle,
                                textAlign: "right",
                                whiteSpace: "nowrap",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {hasPrice(m) ? `KES ${m.unit_price}` : "—"}
                            </td>
                          )}
                        </>
                      )}
                      {userCanEdit && (
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            width: 1,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <button
                            type="button"
                            style={editBtnStyle}
                            title="Edit medicine"
                            // preventDefault keeps focus in the input; stopPropagation stops row selection
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openEditor(m);
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {userCanCreate && (
              <div style={addFooterStyle}>
                <span className="text-xs text-muted">
                  {results.length} medicine{results.length === 1 ? "" : "s"} · Can't find it?
                </span>
                <button
                  type="button"
                  style={addBtnStyle}
                  title="Add this as a new medicine"
                  {...addButtonHandlers}
                >
                  {addFooterLabel}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="field-error">{error}</div>}

      {editing && (
        <MedicineEditModal
          medicine={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {adding !== null && (
        <MedicineAddModal
          initialName={adding}
          onClose={() => setAdding(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}