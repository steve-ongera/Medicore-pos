// src/hooks/useFullscreen.js
import { useCallback, useEffect, useState } from "react";

const KEY = "pos_wants_fullscreen";
const current = () =>
  typeof document === "undefined" ? null : document.fullscreenElement || document.webkitFullscreenElement || null;

const readWants = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};
const writeWants = (v) => {
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* ignore */ }
};

export default function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => !!current());
  // Remembered across refreshes: browsers drop fullscreen on reload and only
  // allow re-entering it after a click, so the navbar shows a "resume" banner.
  const [wantsFullscreen, setWantsFullscreen] = useState(readWants);

  useEffect(() => {
    const onChange = () => {
      const on = !!current();
      setIsFullscreen(on);
      setWantsFullscreen(on);
      writeWants(on);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const enter = useCallback(async () => {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch { /* user denied or unsupported */ }
  }, []);

  const exit = useCallback(async () => {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => (current() ? exit() : enter()), [enter, exit]);

  return { isFullscreen, wantsFullscreen, enter, exit, toggle };
}