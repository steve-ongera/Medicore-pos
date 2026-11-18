// src/utils/unreadCounts.js
// One shared source for the unread notification count and unread message count.
// The navbar bell, navbar chat icon and sidebar links all read from here, so there is a
// single poll (every 15 s, paused while the tab is hidden) and the numbers always agree.
import { useSyncExternalStore } from "react";
import { getNotificationUnreadCount, getUnreadMessageCount } from "../services/api";
import { onUnreadChanged } from "./unreadEvents";

const POLL_MS = 15000;
const EMPTY = { notifications: 0, messages: 0 };

let state = EMPTY;
const listeners = new Set();
let timer = null;
let offEvent = null;

const emit = (next) => {
  if (next.notifications === state.notifications && next.messages === state.messages) return;
  state = next;
  listeners.forEach((l) => l());
};

export async function refreshUnreadCounts() {
  const [n, m] = await Promise.allSettled([getNotificationUnreadCount(), getUnreadMessageCount()]);
  emit({
    notifications: n.status === "fulfilled" ? n.value?.unread_count || 0 : state.notifications,
    messages: m.status === "fulfilled" ? m.value?.unread_count || 0 : state.messages,
  });
}

// Instant feedback while the server confirms (the next refresh corrects any drift).
export const adjustNotificationCount = (delta) =>
  emit({ ...state, notifications: Math.max(0, state.notifications + delta) });

const onVisible = () => { if (!document.hidden) refreshUnreadCounts(); };

function start() {
  refreshUnreadCounts();
  timer = setInterval(() => { if (!document.hidden) refreshUnreadCounts(); }, POLL_MS);
  document.addEventListener("visibilitychange", onVisible);
  offEvent = onUnreadChanged(refreshUnreadCounts);
}

function stop() {
  clearInterval(timer);
  document.removeEventListener("visibilitychange", onVisible);
  offEvent?.();
  timer = offEvent = null;
  state = EMPTY; // so the next person to log in never sees the previous user's numbers
}

function subscribe(cb) {
  listeners.add(cb);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stop();
  };
}

// const { notifications, messages } = useUnreadCounts();
export const useUnreadCounts = () => useSyncExternalStore(subscribe, () => state, () => EMPTY);