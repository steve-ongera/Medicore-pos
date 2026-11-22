// src/utils/shopProfile.js
//
// One place that answers "what kind of shop is this?" for the whole frontend.
// It reads GET /settings/shop/ once (cached for 5 minutes, and remembered in
// localStorage so labels do not flash on the next page load) and turns it into
// a profile with ready-made wording:
//
//   const profile = useShopProfile();
//   "product"            -> "medicine" | "product" | "item"
//   "Products"           -> "Medicines" | "Products" | "Items"
//   profile.tracksExpiry    -> show / hide expiry dates and expiry alerts
//   profile.currency        -> "KES"
//   profile.settings        -> the raw shop settings (name, address, phone, kra_pin...)
//
// Until the settings arrive the profile behaves like a pharmacy, so existing
// pharmacies see exactly what they saw before.
//
// After saving the Settings page, call `refreshShopProfile()` so labels update
// everywhere at once. Non-React code (e.g. receipt PDFs) can use
// `await loadShopProfile()`.

import { useEffect, useMemo, useState } from "react";
import { getShopSettings } from "../services/api";

const STORAGE_KEY = "shop_profile";
const TTL = 5 * 60 * 1000; // 5 minutes

// Wording and icons per business type (values match api.models.BusinessType).
export const BUSINESS_TYPES = {
  PHARMACY: {
    label: "Pharmacy", item: "medicine", defaultUnit: "tablet", unitHint: "tablet, syrup...",
    genericLabel: "Generic name", icon: "bi-capsule",
  },
  SUPERMARKET: {
    label: "Supermarket", item: "product", defaultUnit: "piece", unitHint: "piece, pack, kg...",
    genericLabel: "Brand / description", icon: "bi-basket",
  },
  MINIMART: {
    label: "Mini-mart / Grocery", item: "product", defaultUnit: "piece", unitHint: "piece, pack, kg...",
    genericLabel: "Brand / description", icon: "bi-basket",
  },
  RETAIL: {
    label: "Retail shop", item: "product", defaultUnit: "piece", unitHint: "piece, pack, box...",
    genericLabel: "Brand / description", icon: "bi-bag",
  },
  HARDWARE: {
    label: "Hardware", item: "product", defaultUnit: "piece", unitHint: "piece, bag, metre...",
    genericLabel: "Brand / description", icon: "bi-tools",
  },
  ELECTRONICS: {
    label: "Electronics", item: "product", defaultUnit: "piece", unitHint: "piece, set, pack...",
    genericLabel: "Brand / model", icon: "bi-cpu",
  },
  BOUTIQUE: {
    label: "Boutique", item: "item", defaultUnit: "piece", unitHint: "piece, pair, set...",
    genericLabel: "Brand / description", icon: "bi-handbag",
  },
  OTHER: {
    label: "Shop", item: "product", defaultUnit: "piece", unitHint: "piece, pack, box...",
    genericLabel: "Brand / description", icon: "bi-box-seam",
  },
};

export const businessTypeInfo = (type) => BUSINESS_TYPES[type] || BUSINESS_TYPES.OTHER;

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Turns raw shop settings (or null) into the profile the pages use.
export const buildProfile = (settings) => {
  const type = settings?.business_type || "PHARMACY";
  const info = businessTypeInfo(type);
  return {
    loaded: Boolean(settings),
    settings: settings || {},
    businessType: type,
    businessLabel: info.label,
    isPharmacy: type === "PHARMACY",
    tracksExpiry: settings ? settings.tracks_expiry !== false : true,
    currency: settings?.currency || "KES",
    shopName: settings?.name || "My Shop",
    item: info.item,
    items: `${info.item}s`,
    Item: cap(info.item),
    Items: `${cap(info.item)}s`,
    defaultUnit: info.defaultUnit,
    unitHint: info.unitHint,
    genericLabel: info.genericLabel,
    icon: info.icon,
  };
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
let cache = null; // { key, at, promise }
const subscribers = new Set();
const tokenKey = () => localStorage.getItem("access_token") || "";

const readStored = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
};

export const loadShopSettings = (force = false) => {
  const key = tokenKey();
  if (!key) return Promise.resolve(null);
  // A different login (different token) never reuses another user's cache.
  if (!force && cache && cache.key === key && Date.now() - cache.at < TTL) return cache.promise;

  const promise = getShopSettings()
    .then((s) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch {
        /* storage full / blocked: ignore */
      }
      return s;
    })
    .catch(() => {
      if (cache && cache.promise === promise) cache = null; // never cache a failure
      return null;
    });
  cache = { key, at: Date.now(), promise };
  return promise;
};

// For non-React code such as receipt PDFs.
export const loadShopProfile = async (force = false) => buildProfile(await loadShopSettings(force));

// Call after the Settings page saves, so every open page picks up the change.
export const refreshShopProfile = async () => {
  const s = await loadShopSettings(true);
  subscribers.forEach((fn) => fn(s));
  return buildProfile(s);
};

// Call on logout if you want to forget the previous shop immediately.
export const clearShopProfile = () => {
  cache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useShopProfile() {
  const [settings, setSettings] = useState(readStored);

  useEffect(() => {
    let alive = true;
    loadShopSettings().then((s) => alive && s && setSettings(s));
    const onChange = (s) => alive && s && setSettings(s);
    subscribers.add(onChange);
    return () => {
      alive = false;
      subscribers.delete(onChange);
    };
  }, []);

  return useMemo(() => buildProfile(settings), [settings]);
}