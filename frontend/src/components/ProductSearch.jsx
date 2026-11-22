// src/components/ProductSearch.jsx
//
// Reusable product search box (the file keeps its old name so every import keeps
// working). Works for any kind of shop: wording ("medicine" / "product" / "item"),
// expiry fields and currency come from the shop's settings via useShopProfile().
//
// Uses /medicines/autocomplete/ (searchMedicines) by default. Debounced, ignores
// out-of-order responses, and clears the selection if the user edits the text
// afterwards, so a stale product can't be submitted by mistake.
//
// BROWSE MODE
//   With the built-in search, click the box to see EVERY visible product
//   (scrollable); type to narrow by name, brand/generic name, barcode or SKU.
//   Pages that pass their own `searchFn` keep the old "type at least 2
//   characters" behaviour unless they also pass `minChars`.
//
// BARCODE SCANNERS
//   A scanner types the code and presses Enter. On Enter the box looks for an
//   exact barcode / SKU match (or a single result) and selects it immediately.
//
// Results are shown in a clean two-column table (Item | Price). If
// `renderOption` is passed, each row is a single full-width cell containing
// whatever that function returns (the cell is allowed to shrink so long names
// truncate and the Edit column always stays visible).
//
// STAFF TOOLS (fully opt-out)
//   Owners, pharmacists / store managers (and the old clinical roles) get:
//     * an "Edit" button on every result row. The modal changes the product's
//       details, its visibility and the stock on hand. Save stays disabled
//       until something actually changes.
//     * an "Add new product" option when the product they need isn't found.
//       It creates the product plus a stock batch, then selects it so the sale
//       can continue.
//   Hidden products are removed from normal pickers; editors still see them
//   (greyed out, not selectable) so they can un-hide them.
//   Everyone else sees the component exactly as before.
//
// PRODUCT IMAGES
//   Add / edit pop-ups let staff upload a photo (max 5 MB). Products without one
//   show the default picture from src/assets/no_image_available.png.
//
// EXTRA EXPORTS (for pages that render their own product lists)
//   ImagePicker        photo chooser used by the pop-ups
//   ProductEditModal   the edit pop-up
//   ProductAddModal    the add pop-up
//   useCanEditProduct  true when the current user may edit/add products
//
// Props
//   onSelect(medicine)  called when the user picks a product          (required)
//   onClear()           called when the user edits the text after a selection
//   label               field label                (default: the shop's item word)
//   required            shows the red * on the label     (default false)
//   error               validation message shown under the input
//   placeholder         input placeholder
//   minChars            characters needed before searching. Default 0 (click to
//                       browse everything) with the built-in search; default 2
//                       when a custom searchFn is passed.
//   debounceMs          wait after typing before calling API (default 300)
//   disabled            disable the input
//   showPrice           show the unit price in results       (default true)
//   id                  input id (use a unique one if several on one page)
//   (Built-in search caches the full list for 1 minute and filters it in the
//    browser. Pages that edit products elsewhere should call the exported
//    clearProductCache() afterwards.)
//   searchFn(query)     async fn returning an array of products. Defaults to
//                       /medicines/autocomplete/.
//   renderOption(m)     optional. Returns the content of each result row, e.g.
//                       to show stock levels or brand names.
//   editable            set false on a page to turn the edit feature off  (default true)
//   allowCreate         set false on a page to turn "Add new" off          (default true)
//   canEdit             optional override. By default the component works out
//                       the current user's role itself (one cached /auth/me/ call).
//   onProductUpdated(m) called after a successful edit with the updated product
//   onProductCreated(m) called after a new product is added (it is also
//                        passed to onSelect, so most pages need nothing extra)
//
// To clear the box from the parent (e.g. after saving), change the component's
// `key`:  <ProductSearch key={medKey} ... />  then  setMedKey(k => k + 1).

import { useState, useEffect, useRef, useMemo } from "react";
import {
  searchMedicines,
  updateMedicine,
  getMe,
  quickAddMedicine,
  getMedicineBranchStock,
  setMedicineStock,
} from "../services/api";
import { useShopProfile } from "../utils/shopProfile";
import Modal from "./Modal";
// Default picture for products that have no image (src/assets/no_image_available.png)
import noImage from "../assets/no_image_available.png";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Photo chooser used by the add / edit pop-ups (also exported for other pages).
//   current  existing image URL (edit only)     file     newly chosen File
//   removed  true when the existing image is being removed
export function ImagePicker({ current, file, removed = false, onPick, onClear }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const hasImage = !!(preview || (!removed && current));
  const src = preview || (!removed && current) || noImage;
  return (
    <div className="field">
      <label className="field-label">Product image</label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img
          src={src}
          alt=""
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = noImage;
          }}
          style={{
            width: 72,
            height: 72,
            objectFit: "cover",
            borderRadius: 8,
            border: "1px solid var(--border-default)",
            background: "#fff",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="btn btn-outline btn-sm" style={{ cursor: "pointer", margin: 0 }}>
            {hasImage ? "Change image" : "Upload image"}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
                e.target.value = "";
              }}
            />
          </label>
          {hasImage && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onClear}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Roles that may edit/add a product (must match MEDICINE_EDIT_ROLES on the backend).
const EDIT_ROLES = ["DOCTOR", "NURSE", "PHARMACIST", "SUPER_ADMIN", "GROUP_ADMIN"];

// One shared /auth/me/ lookup for every ProductSearch on the page.
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

// For pages that render their own product lists and need the same edit rights.
export function useCanEditProduct() {
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
// Product list cache (shared by every ProductSearch on the page).
// The full list is fetched ONCE, then typing filters it in the browser, so
// there is no server round trip per keystroke. Cached per "include hidden"
// mode, expires after CACHE_TTL, and is cleared after any edit / add.
// ---------------------------------------------------------------------------
const CACHE_TTL = 60 * 1000; // 1 minute
const SEARCH_LIMIT = 50; // max rows shown while typing
const medCache = {}; // key -> { at, list, promise }

export const clearProductCache = () => {
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

const matchesQuery = (m, q) =>
  m.name?.toLowerCase().includes(q) ||
  m.generic_name?.toLowerCase().includes(q) ||
  m.barcode?.toLowerCase().includes(q) ||
  m.sku?.toLowerCase().includes(q);

const defaultSearchFn = async (query, includeHidden) => {
  const list = await loadFullList(includeHidden);
  const q = (query || "").trim().toLowerCase();
  if (!q) return list; // browse mode: everything
  return list.filter((m) => matchesQuery(m, q)).slice(0, SEARCH_LIMIT);
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
  barcode: m.barcode ?? "",
  sku: m.sku ?? "",
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
  ["name", "generic_name", "category", "unit", "barcode", "sku"].forEach((k) => {
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
const emptyAddForm = (name = "", unit = "tablet") => ({
  name,
  generic_name: "",
  category: "",
  unit,
  barcode: "",
  sku: "",
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
export function ProductEditModal({ medicine, onClose, onSaved }) {
  const profile = useShopProfile();
  const cur = profile.currency;
  const [form, setForm] = useState(() => toForm(medicine));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Product image: a newly chosen file, or "remove the current one".
  const [imageFile, setImageFile] = useState(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const imageDirty = !!imageFile || imageRemoved;

  // Stock on hand (loaded when the modal opens).
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

  const dirty = patchDirty || stockDirty || imageDirty;
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
      if (patchDirty || imageDirty) {
        const body = { ...patch };
        if (imageFile) body.image = imageFile;
        else if (imageRemoved) body.image = null;
        const updated = await updateMedicine(medicine.id, body);
        result = { ...result, ...updated };
      }
      if (stockDirty) {
        const r = await setMedicineStock(medicine.id, {
          quantity: Number(stock),
          reason: "Edited from product search",
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
      title={`Edit product`}
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

        <ImagePicker
          current={medicine.image}
          file={imageFile}
          removed={imageRemoved}
          onPick={(f) => {
            if (f.size > MAX_IMAGE_BYTES) {
              setSaveError("Image must be 5 MB or smaller.");
              return;
            }
            setSaveError("");
            setImageFile(f);
            setImageRemoved(false);
          }}
          onClear={() => {
            setImageFile(null);
            setImageRemoved(true);
          }}
        />

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">{profile.genericLabel}</label>
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
            <label className="field-label">Barcode</label>
            <input
              className="input"
              value={form.barcode}
              onChange={set("barcode")}
              placeholder="Scan or type"
            />
          </div>
          <div className="field">
            <label className="field-label">SKU / code</label>
            <input className="input" value={form.sku} onChange={set("sku")} />
          </div>
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">Unit</label>
            <input
              className="input"
              value={form.unit}
              onChange={set("unit")}
              placeholder={profile.unitHint}
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
              Unit price ({cur}) <span className="required">*</span>
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
          {profile.isPharmacy && (
            <div className="field">
              <label className="field-label">Insurance price ({cur})</label>
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
          )}
        </div>

        <div className="field">
          <label className="field-label">Stock available</label>
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
              ? "Couldn't load the stock for this item, so it can't be edited right now."
              : "Changing this adjusts your stock. The change is logged so managers can see it."}
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
            <strong>Visible in product search</strong>
            <span className="text-xs text-muted" style={{ display: "block" }}>
              Turn off to hide this product from pickers so it can't be selected
              or sold.
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
// Add modal: creates the product AND its first stock batch.
// ---------------------------------------------------------------------------
export function ProductAddModal({ initialName, onClose, onCreated }) {
  const profile = useShopProfile();
  const cur = profile.currency;
  // Computed once, so the form is not reset if the shop profile arrives while typing.
  const [initial] = useState(() => emptyAddForm(initialName, profile.defaultUnit));
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [tried, setTried] = useState(false);
  const [imageFile, setImageFile] = useState(null);

  const errors = validateAdd(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || !!imageFile;

  const set = (key) => (e) => {
    setSaveError("");
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm(`Discard this new product?`)) return;
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
        unit: form.unit.trim() || profile.defaultUnit,
        barcode: form.barcode.trim(),
        sku: form.sku.trim(),
        unit_price: form.unit_price,
        quantity: Number(form.quantity),
      };
      if (profile.isPharmacy) {
        payload.insurance_price = form.insurance_price === "" ? null : form.insurance_price;
      }
      if (form.reorder_level !== "") payload.reorder_level = Number(form.reorder_level);
      if (imageFile) payload.image = imageFile;
      if (profile.tracksExpiry && form.expiry_date) payload.expiry_date = form.expiry_date;
      const created = await quickAddMedicine(payload);
      onCreated(created);
    } catch (err) {
      setSaveError(errorText(err, `Could not add the product.`));
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
      title={`Add new product`}
      size="sm"
      footer={footer}
    >
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <div className="text-xs text-muted">
          This adds the product and a stock batch right away, so you can
          sell it now. You can verify the details later.
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

        <ImagePicker
          file={imageFile}
          onPick={(f) => {
            if (f.size > MAX_IMAGE_BYTES) {
              setSaveError("Image must be 5 MB or smaller.");
              return;
            }
            setSaveError("");
            setImageFile(f);
          }}
          onClear={() => setImageFile(null)}
        />

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">{profile.genericLabel}</label>
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
            <label className="field-label">Barcode</label>
            <input
              className="input"
              value={form.barcode}
              onChange={set("barcode")}
              placeholder="Scan or type"
            />
          </div>
          <div className="field">
            <label className="field-label">SKU / code</label>
            <input className="input" value={form.sku} onChange={set("sku")} />
          </div>
        </div>

        <div style={gridStyle}>
          <div className="field">
            <label className="field-label">Unit</label>
            <input
              className="input"
              value={form.unit}
              onChange={set("unit")}
              placeholder={profile.unitHint}
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
              Unit price ({cur}) <span className="required">*</span>
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
          {profile.isPharmacy && (
            <div className="field">
              <label className="field-label">Insurance price ({cur})</label>
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
          )}
        </div>

        <div style={gridStyle}>
          {profile.tracksExpiry && (
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
          )}
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
        {profile.tracksExpiry && (
          <div className="text-xs text-muted" style={{ marginTop: "calc(var(--space-2) * -1)" }}>
            Not sure of the expiry? Leave it blank and update it later.
          </div>
        )}

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
export default function ProductSearch({
  onSelect,
  onClear,
  label,
  required = false,
  error = "",
  placeholder,
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
  onProductUpdated,
  onProductCreated,
}) {
  const profile = useShopProfile();
  const cur = profile.currency;
  const labelText = label ?? "Product";
  const placeholderText =
    placeholder ?? `Click to browse, scan a barcode or type to search product...`;

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
        console.error("Product search failed:", err);
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
    if (isHidden(medicine)) return; // hidden products can be edited, never picked
    // Drop any search that is still waiting so it can't reopen the list.
    clearTimeout(timer.current);
    requestId.current += 1;
    setSearching(false);
    setSelected(medicine);
    setSearchTerm(medicine.name);
    setResults([]);
    setOpen(false);
    onSelect?.(medicine);
  };

  // Barcode scanners type the code and press Enter: pick an exact barcode / SKU
  // match (or a single result) straight away, without waiting for the debounce.
  const handleKeyDown = async (e) => {
    if (e.key !== "Enter") return;
    const q = searchTerm.trim().toLowerCase();
    if (!q || selected) return;
    e.preventDefault();
    try {
      const list = await searchRef.current(searchTerm.trim());
      const visible = (Array.isArray(list) ? list : []).filter((m) => !isHidden(m));
      const exact = visible.find(
        (m) => m.barcode?.toLowerCase() === q || m.sku?.toLowerCase() === q
      );
      const pick = exact || (visible.length === 1 ? visible[0] : null);
      if (pick) handleSelect(pick);
    } catch (err) {
      console.error("Product search failed:", err);
    }
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
    clearProductCache(); // next open re-fetches fresh prices / stock / visibility
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
    onProductUpdated?.(updated);
  };

  const handleCreated = (created) => {
    clearProductCache(); // the new product must appear in the list
    setAdding(null);
    handleSelect(created); // pick it straight away so the sale can continue
    onProductCreated?.(created);
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
  const addLabel = trimmedTerm ? `+ Add "${trimmedTerm}"` : `+ Add new product`;
  const addFooterLabel = trimmedTerm
    ? `+ Add "${trimmedTerm}" as new product`
    : `+ Add new product`;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {labelText} {required && <span className="required">*</span>}
      </label>

      <div style={{ position: "relative" }}>
        <input
          id={id}
          type="text"
          autoComplete="off"
          className={`input ${error ? "has-error" : ""}`}
          placeholder={placeholderText}
          value={searchTerm}
          disabled={disabled}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
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
            {trimmedTerm ? "Searching..." : `Loading products...`}
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
            <span>No products found</span>
            {userCanCreate && (
              <button
                type="button"
                style={addBtnStyle}
                title={`Add this as a new product`}
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
                    <th style={thStyle}>Product</th>
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
                            <img
                              src={m.image || noImage}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = noImage;
                              }}
                              style={{
                                width: 28,
                                height: 28,
                                objectFit: "cover",
                                borderRadius: 6,
                                marginRight: 8,
                                verticalAlign: "middle",
                                border: "1px solid var(--border-default)",
                              }}
                            />
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
                              {hasPrice(m) ? `${cur} ${m.unit_price}` : "—"}
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
                            title={`Edit product`}
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
                  {results.length} {results.length === 1 ? "product" : "products"} · Can't find it?
                </span>
                <button
                  type="button"
                  style={addBtnStyle}
                  title={`Add this as a new product`}
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
        <ProductEditModal
          medicine={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {adding !== null && (
        <ProductAddModal
          initialName={adding}
          onClose={() => setAdding(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}