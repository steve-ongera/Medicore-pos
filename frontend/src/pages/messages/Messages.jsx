// src/pages/messages/Messages.jsx
// Staff chat: conversation list on the left, thread on the right.
// The open chat lives in the URL (/messages/:conversationId) so the navbar dropdown,
// browser back button and page refresh all work.
// Live updates are plain polling: the list every 10 s, the open thread every 4 s.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  getConversations,
  getConversationMessages,
  sendConversationMessage,
  markConversationRead,
  startConversation,
  createGroupConversation,
  getChatUsers,
} from "../../services/api";
import { asList, clockTime, dayLabel, initials, roleLabel, timeAgo } from "../../utils/timeAgo";
import { notifyUnreadChanged } from "../../utils/unreadEvents";
import "../../styles/messaging.css";

const LIST_POLL_MS = 10000;
const THREAD_POLL_MS = 4000;
const MAX_LEN = 4000;

// Merge new messages into the list without duplicates, oldest first.
const mergeMessages = (prev, incoming) => {
  if (!incoming.length) return prev;
  const seen = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  return fresh.length ? [...prev, ...fresh] : prev;
};

export default function Messages() {
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId } = useParams();
  const activeId = conversationId || null;

  const [convs, setConvs] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [msgs, setMsgs] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("");

  const activeRef = useRef(null);
  const msgsRef = useRef([]);
  const scrollRef = useRef(null);
  const stickRef = useRef(true); // true while the reader is at (or near) the bottom
  activeRef.current = activeId;
  msgsRef.current = msgs;

  const active = useMemo(() => convs.find((c) => c.id === activeId) || null, [convs, activeId]);

  // ---- conversations list ------------------------------------------------
  const loadConvs = useCallback(async (silent = false) => {
    try {
      setConvs(asList(await getConversations()));
      if (!silent) setError("");
    } catch (e) {
      if (!silent) setError(e.message || "Could not load conversations.");
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => {
    loadConvs();
    const t = setInterval(() => { if (!document.hidden) loadConvs(true); }, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [loadConvs]);

  // The navbar "New chat" button links here with { state: { newChat: true } }
  useEffect(() => {
    if (location.state?.newChat) {
      setShowNew(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  // ---- read receipts -----------------------------------------------------
  const markRead = useCallback(async (id) => {
    try {
      await markConversationRead(id);
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
      notifyUnreadChanged(); // refresh the navbar badge straight away
    } catch {
      /* non-critical */
    }
  }, []);

  // ---- open conversation: load its messages whenever the URL changes -----
  useEffect(() => {
    stickRef.current = true;
    setError("");
    if (!activeId) {
      setMsgs([]);
      setLoadingMsgs(false);
      return undefined;
    }
    let cancelled = false;
    setMsgs([]);
    setLoadingMsgs(true);
    (async () => {
      try {
        const data = asList(await getConversationMessages(activeId));
        if (cancelled) return;
        setMsgs(data);
        markRead(activeId);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load messages.");
      } finally {
        if (!cancelled) setLoadingMsgs(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeId, markRead]);

  // ---- poll the open thread for new messages ----------------------------
  useEffect(() => {
    if (!activeId) return undefined;
    const t = setInterval(async () => {
      if (document.hidden) return;
      const id = activeRef.current;
      const last = msgsRef.current[msgsRef.current.length - 1];
      try {
        const incoming = asList(
          await getConversationMessages(id, last ? { after: last.created_at } : {})
        );
        if (activeRef.current !== id || !incoming.length) return;
        setMsgs((prev) => mergeMessages(prev, incoming));
        if (incoming.some((m) => !m.is_mine)) markRead(id);
        loadConvs(true);
      } catch {
        /* stay quiet on transient network errors */
      }
    }, THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [activeId, markRead, loadConvs]);

  // ---- scrolling: follow new messages only if the reader is at the bottom ----
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || msgs.length === 0) return;
    const lastIsMine = msgs[msgs.length - 1].is_mine;
    if (stickRef.current || lastIsMine) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // ---- send ---------------------------------------------------------------
  const send = async () => {
    const body = text.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const m = await sendConversationMessage(activeId, body);
      stickRef.current = true;
      setMsgs((prev) => mergeMessages(prev, [m]));
      setText("");
      setError("");
      loadConvs(true);
    } catch (e) {
      setError(e.message || "Message not sent. Try again.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const openConversation = (id) => navigate(`/messages/${id}`);

  const onChatCreated = (conv) => {
    setShowNew(false);
    setConvs((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
    openConversation(conv.id);
  };

  const shownConvs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? convs.filter((c) => (c.title || "").toLowerCase().includes(q)) : convs;
  }, [convs, filter]);

  // ---- thread with day separators ---------------------------------------
  const thread = useMemo(() => {
    const out = [];
    let lastDay = "";
    msgs.forEach((m) => {
      const label = dayLabel(m.created_at);
      if (label !== lastDay) {
        out.push({ type: "day", key: `d-${m.id}`, label });
        lastDay = label;
      }
      out.push({ type: "msg", key: m.id, m });
    });
    return out;
  }, [msgs]);

  const missing = activeId && !loadingConvs && !active; // e.g. a stale link to a chat you're not in

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">Talk to your team about stock, customers and shift changes.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
            <i className="bi bi-plus-lg" aria-hidden="true" /> New chat
          </button>
        </div>
      </div>

      <div className={`card msgs${activeId ? " is-thread-open" : ""}`}>
        {/* ---------- left: conversations ---------- */}
        <aside className="msgs__side" aria-label="Conversations">
          <div className="msgs__search">
            <div className="search-bar">
              <i className="bi bi-search search-bar__icon" aria-hidden="true" />
              <input
                className="search-bar__input"
                type="search"
                placeholder="Search chats"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Search chats"
              />
            </div>
          </div>

          <div className="msgs__list" aria-busy={loadingConvs}>
            {loadingConvs ? (
              [0, 1, 2, 3].map((i) => (
                <div className="skeleton-row" key={i}>
                  <div className="skeleton skeleton-avatar" />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton skeleton-text w-50" />
                    <div className="skeleton skeleton-text w-75" />
                  </div>
                </div>
              ))
            ) : shownConvs.length === 0 ? (
              <p className="msgs__hint">
                {convs.length === 0 ? "No chats yet. Start one with New chat." : "No chats match your search."}
              </p>
            ) : (
              shownConvs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`msgs-conv${c.id === activeId ? " is-active" : ""}${c.unread_count > 0 ? " is-unread" : ""}`}
                  onClick={() => openConversation(c.id)}
                  aria-current={c.id === activeId ? "true" : undefined}
                >
                  <span className={`avatar${c.is_group ? " msgs-avatar--group" : ""}`} aria-hidden="true">
                    {c.is_group ? <i className="bi bi-people-fill" /> : initials(c.title)}
                  </span>
                  <span className="msgs-conv__main">
                    <span className="msgs-conv__row">
                      <span className="msgs-conv__name">{c.title}</span>
                      <span className="msgs-conv__time">{timeAgo(c.last_message?.created_at || c.updated_at)}</span>
                    </span>
                    <span className="msgs-conv__row">
                      <span className="msgs-conv__last">
                        {c.last_message
                          ? `${c.is_group && c.last_message.sender_name ? c.last_message.sender_name + ": " : ""}${c.last_message.body}`
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
        </aside>

        {/* ---------- right: thread ---------- */}
        <section className="msgs__main" aria-label="Conversation">
          {!activeId || missing ? (
            <div className="empty-state msgs__placeholder">
              <div className="empty-state__icon"><i className="bi bi-chat-dots" aria-hidden="true" /></div>
              <div className="empty-state__title">
                {missing ? "This chat isn't available" : "Pick a chat to start talking"}
              </div>
              <p className="empty-state__desc">
                {missing
                  ? "It may have been removed, or you are not a member of it."
                  : "Choose a conversation on the left, or start a new one."}
              </p>
              {missing && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/messages")}>
                  Back to chats
                </button>
              )}
            </div>
          ) : (
            <>
              <header className="msgs__thread-head">
                <button
                  type="button"
                  className="btn-icon-only msgs__back"
                  onClick={() => navigate("/messages")}
                  aria-label="Back to chats"
                >
                  <i className="bi bi-arrow-left" aria-hidden="true" />
                </button>
                <span className={`avatar${active?.is_group ? " msgs-avatar--group" : ""}`} aria-hidden="true">
                  {active?.is_group ? <i className="bi bi-people-fill" /> : initials(active?.title || "")}
                </span>
                <div className="msgs__thread-info">
                  <span className="msgs__thread-name">{active?.title || "Chat"}</span>
                  <span className="msgs__thread-sub">
                    {active?.is_group
                      ? `${active.participants.length} members`
                      : roleLabel(active?.other_user?.role)}
                  </span>
                </div>
              </header>

              <div className="msgs__scroll" ref={scrollRef} onScroll={onScroll} role="log" aria-busy={loadingMsgs}>
                {loadingMsgs ? (
                  <p className="msgs__hint">Loading messages…</p>
                ) : thread.length === 0 ? (
                  <p className="msgs__hint">No messages yet. Say hello.</p>
                ) : (
                  thread.map((row) =>
                    row.type === "day" ? (
                      <div key={row.key} className="msgs__day"><span className="tag">{row.label}</span></div>
                    ) : (
                      <div key={row.key} className={`msgs-row${row.m.is_mine ? " is-mine" : ""}`}>
                        <div className="msgs-bubble">
                          {active?.is_group && !row.m.is_mine && (
                            <span className="msgs-bubble__sender">{row.m.sender_name || "Former staff"}</span>
                          )}
                          <span className="msgs-bubble__text">{row.m.body}</span>
                          <time className="msgs-bubble__time" dateTime={row.m.created_at}>{clockTime(row.m.created_at)}</time>
                        </div>
                      </div>
                    )
                  )
                )}
              </div>

              {error && (
                <div className="alert alert-danger msgs__notice" role="alert">
                  <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
                  <div className="alert-message">{error}</div>
                </div>
              )}

              <div className="msgs__composer">
                <textarea
                  className="textarea msgs__input"
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="Write a message. Enter sends, Shift+Enter adds a line"
                  aria-label="Message"
                />
                <button
                  type="button"
                  className={`btn btn-primary btn-icon${sending ? " is-loading" : ""}`}
                  onClick={send}
                  disabled={sending || !text.trim()}
                  aria-label="Send message"
                >
                  <i className="bi bi-send-fill" aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {showNew && <NewChatDialog onClose={() => setShowNew(false)} onCreated={onChatCreated} />}
    </>
  );
}

/* ==========================================================================
   New chat dialog: pick one person (direct chat) or several (group chat)
   ========================================================================== */
function NewChatDialog({ onClose, onCreated }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState([]); // user ids
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = asList(await getChatUsers({ search }));
        if (!cancelled) { setUsers(data); setError(""); }
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load staff.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const isGroup = picked.length > 1;

  const create = async () => {
    if (!picked.length) return;
    setBusy(true);
    setError("");
    try {
      const conv = isGroup
        ? await createGroupConversation(picked, title.trim() || "Group chat")
        : await startConversation(picked[0]);
      onCreated(conv);
    } catch (e) {
      setError(e.message || "Could not start the chat.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-chat-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="new-chat-title">New chat</h2>
            <p className="modal-desc">Pick one person for a direct chat, or several for a group.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body">
          <div className="search-bar mb-3">
            <i className="bi bi-search search-bar__icon" aria-hidden="true" />
            <input
              className="search-bar__input"
              type="search"
              placeholder="Search staff by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              aria-label="Search staff"
            />
          </div>

          <ul className="msgs-users">
            {loading ? (
              <li className="msgs__hint">Loading staff…</li>
            ) : users.length === 0 ? (
              <li className="msgs__hint">No staff found.</li>
            ) : (
              users.map((u) => (
                <li key={u.id}>
                  <label className="msgs-user">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={picked.includes(u.id)}
                      onChange={() => toggle(u.id)}
                    />
                    <span className="avatar avatar-sm" aria-hidden="true">{initials(u.full_name)}</span>
                    <span className="msgs-user__name">
                      {u.full_name}
                      <small>{roleLabel(u.role)}</small>
                    </span>
                  </label>
                </li>
              ))
            )}
          </ul>

          {isGroup && (
            <div className="field mt-4 mb-0">
              <label className="field-label" htmlFor="group-name">Group name</label>
              <input
                id="group-name"
                className="input"
                type="text"
                maxLength={150}
                placeholder="For example, Evening shift"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div className="alert alert-danger mt-4" role="alert">
              <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
              <div className="alert-message">{error}</div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={`btn btn-primary${busy ? " is-loading" : ""}`}
            onClick={create}
            disabled={busy || picked.length === 0}
          >
            {isGroup ? `Create group (${picked.length})` : "Start chat"}
          </button>
        </div>
      </div>
    </div>
  );
}