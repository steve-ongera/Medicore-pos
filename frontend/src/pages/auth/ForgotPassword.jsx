// src/pages/auth/ForgotPassword.jsx
// Password reset with a 6-digit code (OTP) sent to the account's email.
//   1. request  - enter email or username, we email a 6-digit code
//   2. verify   - enter the code (auto-checks when the 6th digit is typed)
//   3. reset    - choose a new password
//   4. done     - back to sign in
import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { forgotPassword, resetPassword, verifyResetCode } from "../../services/api";
import AuthShell, { PasswordField } from "../../components/AuthShell.jsx";

const LEN = 6;
const RESEND_SECONDS = 60;

// Turns the wrapped API error into one readable sentence (no "code: " prefixes).
const friendly = (err) => {
  const e = err?.errors;
  if (e && typeof e === "object") {
    const first = Object.values(e)[0];
    const text = Array.isArray(first) ? first.join(" ") : first;
    if (typeof text === "string" && text) return text;
  }
  return err?.message || "Something went wrong. Please try again.";
};

// Six single-digit boxes. Supports typing, backspace, arrow keys, paste and
// the one-time-code autofill offered by phones.
function OtpInput({ value, onChange, onComplete, disabled, hasError, autoFocus }) {
  const refs = useRef([]);
  const digits = Array.from({ length: LEN }, (_, i) => value[i] || "");
  const focus = (i) => refs.current[i]?.focus();

  const update = (next) => {
    onChange(next);
    if (next.length === LEN) onComplete?.(next);
  };

  const handleChange = (i, e) => {
    const d = e.target.value.replace(/\D/g, "");
    if (!d) return;
    let next;
    if (d.length === 1) next = value.slice(0, i) + d + value.slice(i + 1);
    else next = value.slice(0, i) + d; // several digits at once (autofill)
    next = next.slice(0, LEN);
    update(next);
    focus(Math.min(next.length, LEN - 1));
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const idx = digits[i] ? i : i - 1;
      if (idx < 0) return;
      update(value.slice(0, idx) + value.slice(idx + 1));
      focus(idx);
    } else if (e.key === "ArrowLeft" && i > 0) {
      focus(i - 1);
    } else if (e.key === "ArrowRight" && i < LEN - 1) {
      focus(i + 1);
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
    if (!text) return;
    e.preventDefault();
    update(text);
    focus(Math.min(text.length, LEN - 1));
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8 }} onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className={`input${hasError ? " has-error" : ""}`}
          style={{ width: 46, height: 54, padding: 0, textAlign: "center", fontSize: "1.4rem", fontWeight: 600 }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of ${LEN}`}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => {
            // always land on the first empty box, and select so typing replaces
            if (i > value.length) focus(value.length);
            else e.target.select();
          }}
        />
      ))}
    </div>
  );
}

export default function ForgotPassword() {
  const { user } = useAuth();
  const [step, setStep] = useState("request"); // request | verify | reset | done
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Resend countdown
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (user && step !== "done") return <Navigate to="/dashboard" replace />;

  const sendCode = async (e, isResend = false) => {
    e?.preventDefault();
    if (!identifier.trim()) {
      setError("Enter your email or username.");
      return;
    }
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await forgotPassword(identifier.trim());
      setCode("");
      setCooldown(RESEND_SECONDS);
      setStep("verify");
      if (isResend) setInfo("A new code has been sent.");
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (busy) return;
    if (value.length !== LEN) {
      setError("Enter the 6-digit code.");
      return;
    }
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await verifyResetCode(identifier.trim(), value);
      setStep("reset");
    } catch (err) {
      setError(friendly(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ identifier: identifier.trim(), code, new_password: password });
      setStep("done");
    } catch (err) {
      setError(friendly(err));
      // The code is no longer valid: send them back to enter a fresh one.
      if (err?.errors?.code) {
        setCode("");
        setStep("verify");
      }
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    request: ["Forgot your password?", "Enter your email or username and we will send a 6-digit code to your email."],
    verify: ["Enter the code", "We sent a 6-digit code to the email on your account. It expires in 10 minutes."],
    reset: ["Create a new password", "Choose a strong password you have not used before."],
    done: ["Password updated", "You can now sign in with your new password."],
  };
  const [title, subtitle] = titles[step];
  const mismatch = confirm && confirm !== password;

  const errorBox = error && (
    <div className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-4)" }}>
      <i className="bi bi-exclamation-circle alert-icon" aria-hidden="true" />
      <div className="alert-message">{error}</div>
    </div>
  );

  return (
    <AuthShell
      title={title}
      subtitle={subtitle}
      footer={<><i className="bi bi-arrow-left" aria-hidden="true" /> <Link to="/login">Back to sign in</Link></>}
    >
      {step === "request" && (
        <form onSubmit={sendCode}>
          <div className="field">
            <label className="field-label" htmlFor="fp_identifier">Email / Username</label>
            <div className="input-icon-wrap">
              <i className="bi bi-person icon" aria-hidden="true" />
              <input
                id="fp_identifier"
                type="text"
                className="input"
                placeholder="Email or username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={busy}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
              />
            </div>
          </div>
          {errorBox}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner spinner-inverse" style={{ width: "1rem", height: "1rem" }} aria-hidden="true" />
                Sending code...
              </>
            ) : (
              "Send code"
            )}
          </button>
        </form>
      )}

      {step === "verify" && (
        <div>
          <div style={{ marginBottom: "var(--space-4)" }}>
            <OtpInput
              value={code}
              onChange={(v) => {
                setError("");
                setCode(v);
              }}
              onComplete={verify}
              disabled={busy}
              hasError={!!error}
              autoFocus
            />
          </div>
          {info && (
            <div className="text-xs" style={{ textAlign: "center", color: "var(--success-strong, #047857)", marginBottom: "var(--space-3)" }}>
              {info}
            </div>
          )}
          {errorBox}
          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            disabled={busy || code.length !== LEN}
            onClick={() => verify()}
          >
            {busy ? (
              <>
                <span className="spinner spinner-inverse" style={{ width: "1rem", height: "1rem" }} aria-hidden="true" />
                Verifying...
              </>
            ) : (
              "Verify code"
            )}
          </button>
          <div className="text-xs" style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
            {cooldown > 0 ? (
              <span className="text-muted">Resend code in {cooldown}s</span>
            ) : (
              <>
                Did not get it?{" "}
                <button
                  type="button"
                  className="wis-link-edit"
                  style={{ fontSize: "inherit" }}
                  onClick={(e) => sendCode(e, true)}
                  disabled={busy}
                >
                  Resend code
                </button>
              </>
            )}
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                className="wis-link-edit"
                style={{ fontSize: "inherit" }}
                onClick={() => {
                  setStep("request");
                  setCode("");
                  setError("");
                  setInfo("");
                }}
              >
                Use a different email or username
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "reset" && (
        <form onSubmit={submitReset}>
          <PasswordField
            id="fp_password"
            label="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            disabled={busy}
          />
          <PasswordField
            id="fp_confirm"
            label="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat password"
            autoComplete="new-password"
            disabled={busy}
            hasError={!!mismatch}
          />
          {errorBox}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner spinner-inverse" style={{ width: "1rem", height: "1rem" }} aria-hidden="true" />
                Saving...
              </>
            ) : (
              "Reset password"
            )}
          </button>
        </form>
      )}

      {step === "done" && (
        <div style={{ textAlign: "center" }}>
          <i
            className="bi bi-check-circle-fill"
            style={{ fontSize: "3rem", color: "var(--success-strong, #047857)" }}
            aria-hidden="true"
          />
          <Link to="/login" className="btn btn-primary btn-block btn-lg" style={{ marginTop: "var(--space-5, 1.25rem)" }}>
            Sign in
          </Link>
        </div>
      )}
    </AuthShell>
  );
}