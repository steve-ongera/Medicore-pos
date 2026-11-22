// src/pages/auth/Register.jsx
// Sign-up form. The username is auto-suggested from the first + last name
// (Instagram style): it fills itself in while the person types their name, shows
// other free suggestions as tappable chips, and live-checks anything they type
// themselves. Once they edit the username by hand it stops being overwritten;
// clearing the field hands control back to the auto-suggestion.
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { checkUsername, suggestUsernames } from "../../services/api";
import AuthShell, { PasswordField } from "../../components/AuthShell.jsx";

const EMPTY = {
  shop_name: "",
  phone: "",
  first_name: "",
  last_name: "",
  email: "",
  username: "",
  password: "",
  confirm: "",
};

// Same rule as the server: 3-30 chars, a-z 0-9 . _  (no leading/trailing/double dots)
const USERNAME_RE = /^[a-z0-9._]{3,30}$/;
const usernameFormatError = (u) => {
  if (!USERNAME_RE.test(u) || u.startsWith(".") || u.endsWith(".") || u.includes("..")) {
    return "Use 3-30 letters, numbers, dots or underscores.";
  }
  return "";
};

const OK = "var(--success-strong, #047857)";
const BAD = "var(--danger-strong, #b91c1c)";

export default function Register() {
  const { register: registerAccount, user } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Username helper state
  const [touched, setTouched] = useState(false); // true once the person typed their own username
  const [status, setStatus] = useState("idle"); // idle | checking | available | taken | invalid
  const [statusMsg, setStatusMsg] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const suggestionsRef = useRef([]); // usernames already known to be free
  const reqId = useRef(0); // ignores out-of-order responses

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // 1) Auto-suggest from the name while the username has not been touched.
  useEffect(() => {
    if (touched) return undefined;
    const fn = form.first_name.trim();
    const ln = form.last_name.trim();
    const id = ++reqId.current;

    if (!fn && !ln) {
      suggestionsRef.current = [];
      setSuggestions([]);
      setStatus("idle");
      setStatusMsg("");
      setForm((f) => (f.username ? { ...f, username: "" } : f));
      return undefined;
    }

    setStatus("checking");
    const t = setTimeout(async () => {
      try {
        const { suggestions: list = [] } = await suggestUsernames({ first_name: fn, last_name: ln });
        if (id !== reqId.current) return;
        suggestionsRef.current = list;
        setSuggestions(list);
        setForm((f) => ({ ...f, username: list[0] || "" }));
        setStatus(list[0] ? "available" : "idle");
        setStatusMsg("");
      } catch {
        if (id === reqId.current) setStatus("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form.first_name, form.last_name, touched]);

  // 2) Live-check a username the person typed themselves.
  useEffect(() => {
    if (!touched) return undefined;
    const u = form.username;
    if (!u) return undefined;
    const id = ++reqId.current;

    if (suggestionsRef.current.includes(u)) {
      setStatus("available");
      setStatusMsg("");
      return undefined;
    }
    const formatError = usernameFormatError(u);
    if (formatError) {
      setStatus("invalid");
      setStatusMsg(formatError);
      return undefined;
    }

    setStatus("checking");
    setStatusMsg("");
    const t = setTimeout(async () => {
      try {
        const res = await checkUsername(u);
        if (id !== reqId.current) return;
        if (res.available) {
          setStatus("available");
          setStatusMsg("");
          return;
        }
        setStatus(res.valid === false ? "invalid" : "taken");
        setStatusMsg(res.detail || "This username is taken.");
        // Offer free alternatives based on what they typed.
        if (res.valid !== false) {
          const { suggestions: list = [] } = await suggestUsernames({
            first_name: form.first_name.trim(),
            last_name: form.last_name.trim(),
            seed: u,
          });
          if (id !== reqId.current) return;
          suggestionsRef.current = list;
          setSuggestions(list);
        }
      } catch {
        if (id === reqId.current) setStatus("idle");
      }
    }, 450);
    return () => clearTimeout(t);
    // first/last name are read for the suggestion seed only; they must not retrigger the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.username, touched]);

  if (user) return <Navigate to="/dashboard" replace />;

  const onUsernameChange = (e) => {
    const v = e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 30);
    setForm((f) => ({ ...f, username: v }));
    setTouched(v !== ""); // emptying the box resumes auto-suggestion
  };

  const pickSuggestion = (u) => {
    setTouched(true);
    setForm((f) => ({ ...f, username: u }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!form.username) {
      setError("Choose a username.");
      return;
    }
    if (status === "checking") {
      setError("Hold on, we are still checking that username.");
      return;
    }
    if (status === "taken" || status === "invalid") {
      setError(statusMsg || "Choose a different username.");
      return;
    }

    setBusy(true);
    try {
      const { confirm, ...rest } = form;
      await registerAccount({
        ...rest,
        email: rest.email.trim().toLowerCase(),
        username: rest.username.trim().toLowerCase(),
      });
      nav("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const mismatch = form.confirm && form.confirm !== form.password;
  const otherSuggestions = suggestions.filter((s) => s !== form.username).slice(0, 4);

  return (
    <AuthShell
      wide
      title="Create your shop account"
      subtitle="Set up Cloud 360 POS for your shop in a minute."
      footer={<>Already have an account? <Link to="/login">Sign in</Link></>}
    >
      <form onSubmit={submit}>
        <div className="auth-grid">
          <div className="field">
            <label className="field-label" htmlFor="shop_name">Shop name</label>
            <div className="input-icon-wrap">
              <i className="bi bi-shop icon" aria-hidden="true" />
              <input id="shop_name" className="input" placeholder="e.g. Afya Pharmacy" value={form.shop_name}
                onChange={set("shop_name")} disabled={busy} autoFocus required />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="phone">Phone</label>
            <div className="input-icon-wrap">
              <i className="bi bi-telephone icon" aria-hidden="true" />
              <input id="phone" type="tel" className="input" placeholder="07XX XXX XXX" value={form.phone}
                onChange={set("phone")} disabled={busy} autoComplete="tel" />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="first_name">First name</label>
            <input id="first_name" className="input" placeholder="First name" value={form.first_name}
              onChange={set("first_name")} disabled={busy} autoComplete="given-name" required />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="last_name">Last name</label>
            <input id="last_name" className="input" placeholder="Last name" value={form.last_name}
              onChange={set("last_name")} disabled={busy} autoComplete="family-name" required />
          </div>

          <div className="field is-full">
            <label className="field-label" htmlFor="email">Email (you will sign in with this)</label>
            <div className="input-icon-wrap">
              <i className="bi bi-envelope icon" aria-hidden="true" />
              <input id="email" type="email" className="input" placeholder="you@example.com" value={form.email}
                onChange={set("email")} disabled={busy} autoComplete="email" autoCapitalize="none" required />
            </div>
          </div>

          <div className="field is-full">
            <label className="field-label" htmlFor="username">Username</label>
            <div className="input-icon-wrap">
              <i className="bi bi-at icon" aria-hidden="true" />
              <input
                id="username"
                className={`input${status === "taken" || status === "invalid" ? " has-error" : ""}`}
                placeholder="Suggested from your name"
                value={form.username}
                onChange={onUsernameChange}
                disabled={busy}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={{ paddingRight: "2.5rem" }}
                aria-describedby="username-help"
                required
              />
              <span
                style={{
                  position: "absolute",
                  right: "0.85rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "inline-flex",
                  pointerEvents: "none",
                }}
                aria-hidden="true"
              >
                {status === "checking" && (
                  <span className="spinner" style={{ width: "1rem", height: "1rem" }} />
                )}
                {status === "available" && <i className="bi bi-check-circle-fill" style={{ color: OK }} />}
                {(status === "taken" || status === "invalid") && (
                  <i className="bi bi-x-circle-fill" style={{ color: BAD }} />
                )}
              </span>
            </div>

            <div id="username-help" className="text-xs" style={{ marginTop: 4, minHeight: "1.1em" }}>
              {status === "available" && form.username && (
                <span style={{ color: OK }}>@{form.username} is available</span>
              )}
              {(status === "taken" || status === "invalid") && (
                <span style={{ color: BAD }}>{statusMsg}</span>
              )}
              {(status === "idle" || status === "checking") && (
                <span className="text-muted">
                  {touched ? "Letters, numbers, dots and underscores." : "Suggested from your name. You can change it."}
                </span>
              )}
            </div>

            {otherSuggestions.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {otherSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => pickSuggestion(s)}
                    disabled={busy}
                  >
                    @{s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <PasswordField id="password" value={form.password} onChange={set("password")}
            placeholder="At least 8 characters" autoComplete="new-password" disabled={busy} />
          <PasswordField id="confirm" label="Confirm password" value={form.confirm} onChange={set("confirm")}
            placeholder="Repeat password" autoComplete="new-password" disabled={busy} hasError={!!mismatch} />

          {error && (
            <div className="alert alert-danger is-full" role="alert" style={{ marginBottom: "var(--space-4)" }}>
              <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
              <div className="alert-message">{error}</div>
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block btn-lg is-full" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner spinner-inverse" style={{ width: "1rem", height: "1rem" }} aria-hidden="true" />
                Creating account...
              </>
            ) : (
              "Create account"
            )}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}