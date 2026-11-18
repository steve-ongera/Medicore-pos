// src/utils/unreadEvents.js
// Tiny event bus so the navbar badges update the moment a page marks something as read,
// instead of waiting for the next 15 second poll.
const EVENT = "medicore:unread-changed";

export const notifyUnreadChanged = () => window.dispatchEvent(new Event(EVENT));

// Returns an unsubscribe function, so it can be used directly as a useEffect cleanup.
export const onUnreadChanged = (cb) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};