// src/components/ChatDropdown.jsx
// Navbar chat icon: unread badge + dropdown with recent conversations.
// Put it inside <div className="navbar__right"> in your Navbar, next to NotificationBell.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getConversations } from "../services/api";
import { asList, initials, roleLabel, timeAgo } from "../utils/timeAgo";
import { useUnreadCounts } from "../utils/unreadCounts";
import "../styles/messaging.css";

export default function ChatDropdown() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const { messages: unreadCount } = useUnreadCounts(); // shared, polled once for the whole app
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      setConversations(asList(await getConversations()).slice(0, 8));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) loadConversations(); }, [open, loadConversations]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { setOpen(false); }, [pathname]);

  const openConversation = (id) => { setOpen(false); navigate(`/messages/${id}`); };

  return (
    <div ref={rootRef} className="nav-pop">
      <button
        type="button"
        className="navbar__icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Messages, ${unreadCount} unread` : "Messages"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <i className="bi bi-chat-left" style={{ fontSize: 17 }} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="navbar__icon-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="nav-pop__panel" role="region" aria-label="Messages">
          <div className="nav-pop__head">
            <span className="nav-pop__title">Messages</span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => { setOpen(false); navigate("/messages", { state: { newChat: true } }); }}
            >
              <i className="bi bi-plus-lg" aria-hidden="true" /> New chat
            </button>
          </div>

          <div className="nav-pop__body">
            {loading && conversations.length === 0 ? (
              <div className="nav-pop__empty">Loading…</div>
            ) : conversations.length === 0 ? (
              <div className="nav-pop__empty">
                <i className="bi bi-chat-left-dots" aria-hidden="true" />
                No conversations yet
              </div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`nav-pop__item${c.unread_count > 0 ? " is-unread" : ""}`}
                  onClick={() => openConversation(c.id)}
                >
                  <span className={`avatar${c.is_group ? " msgs-avatar--group" : ""}`} aria-hidden="true">
                    {c.is_group ? <i className="bi bi-people-fill" /> : initials(c.title)}
                  </span>
                  <span className="nav-pop__main">
                    <span className="nav-pop__row">
                      <span className="nav-pop__item-title">
                        {c.title}
                        {!c.is_group && c.other_user?.role && (
                          <small className="text-faint font-medium"> ({roleLabel(c.other_user.role)})</small>
                        )}
                      </span>
                      <span className="nav-pop__item-time">
                        {timeAgo(c.last_message?.created_at || c.updated_at)}
                      </span>
                    </span>
                    <span className="nav-pop__row">
                      <span className="nav-pop__item-text">
                        {c.last_message
                          ? `${c.last_message.sender_name ? c.last_message.sender_name + ": " : ""}${c.last_message.body}`
                          : "No messages yet"}
                      </span>
                      {c.unread_count > 0 && (
                        <span className="msgs-unread" aria-label={`${c.unread_count} unread`}>
                          {c.unread_count > 99 ? "99+" : c.unread_count}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="nav-pop__foot">
            <button type="button" className="nav-pop__all" onClick={() => { setOpen(false); navigate("/messages"); }}>
              Open Messages
            </button>
          </div>
        </div>
      )}
    </div>
  );
}