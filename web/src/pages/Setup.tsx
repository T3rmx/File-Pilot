import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useUI } from "../lib/ui";
import { AuthShell } from "../components/AuthShell";
import { Icon } from "../components/Icons";

export function SetupPage() {
  const { t } = useI18n();
  const { configured, setup } = useAuth();
  const { toast } = useUI();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (configured) return <Navigate to="/login" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!/^[A-Za-z0-9._-]{2,64}$/.test(username.trim())) {
      setError(t("auth.usernameRule"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordHint"));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      await setup(username.trim(), password);
      toast(t("toast.welcome"), "success");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={t("auth.setupTitle")}
      subtitle={t("auth.setupSubtitle")}
      footer={
        <span className="auth-note">
          <Icon name="lock" size={14} />
          {t("auth.firstRun")}
        </span>
      }
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label className="field" htmlFor="setup-username">
          <span className="field-label">{t("auth.username")}</span>
          <input
            id="setup-username"
            className="input"
            value={username}
            autoComplete="username"
            autoFocus
            maxLength={64}
            onChange={(event) => setUsername(event.target.value)}
          />
          <span className="field-hint">{t("auth.usernameRule")}</span>
        </label>

        <label className="field" htmlFor="setup-password">
          <span className="field-label">{t("auth.password")}</span>
          <input
            id="setup-password"
            className="input"
            type="password"
            value={password}
            autoComplete="new-password"
            maxLength={256}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="field-hint">{t("auth.passwordHint")}</span>
        </label>

        <label className="field" htmlFor="setup-confirm">
          <span className="field-label">{t("auth.confirmPassword")}</span>
          <input
            id="setup-confirm"
            className="input"
            type="password"
            value={confirm}
            autoComplete="new-password"
            maxLength={256}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t("auth.creating") : t("auth.createAccount")}
        </button>
      </form>
    </AuthShell>
  );
}
