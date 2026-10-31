import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useUI } from "../lib/ui";
import { AuthShell } from "../components/AuthShell";
import { Icon } from "../components/Icons";

export function LoginPage() {
  const { t } = useI18n();
  const { configured, status, user, login } = useAuth();
  const { toast } = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (status === "ready" && !configured) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to="/" replace />;

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username.trim(), password);
      toast(t("toast.welcome"), "success");
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError(t("auth.badCredentials"));
        else if (err.status === 429) setError(t("auth.rateLimited"));
        else setError(err.detail);
      } else {
        setError(t("common.unknownError"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={t("auth.welcomeBack")}
      subtitle={t("auth.loginSubtitle")}
      footer={
        <span className="auth-note">
          <Icon name="wifi" size={14} />
          {t("auth.lanHint")}
        </span>
      }
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label className="field" htmlFor="login-username">
          <span className="field-label">{t("auth.username")}</span>
          <input
            id="login-username"
            className="input"
            value={username}
            autoComplete="username"
            autoFocus
            maxLength={64}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="field" htmlFor="login-password">
          <span className="field-label">{t("auth.password")}</span>
          <input
            id="login-password"
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            maxLength={256}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !username || !password}>
          {busy ? t("auth.signingIn") : t("auth.signIn")}
        </button>
      </form>
    </AuthShell>
  );
}
