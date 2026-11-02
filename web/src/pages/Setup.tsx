import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { ApiError, api } from "../lib/api";
import type { SetupResponse } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Segmented, useUI } from "../lib/ui";
import { AuthShell } from "../components/AuthShell";
import { Icon } from "../components/Icons";

type Phase = "form" | "submitting" | "restart";

export function SetupPage() {
  const { t } = useI18n();
  const { configured, setup } = useAuth();
  const { toast } = useUI();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [tls, setTls] = useState<"on" | "off">("on");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const [restartInfo, setRestartInfo] = useState<SetupResponse | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");

  if (configured && phase === "form") return <Navigate to="/login" replace />;

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
    setPhase("submitting");
    try {
      const data = await setup(username.trim(), password, tls);
      if (data.restart_required) {
        setRestartInfo(data);
        setPhase("restart");
      } else {
        toast(t("toast.welcome"), "success");
        navigate("/", { replace: true });
      }
    } catch (err) {
      setPhase("form");
      setError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    }
  };

  const restartNow = async () => {
    setRestartError("");
    setRestarting(true);
    try {
      await api.post("/api/system/restart");
      window.setTimeout(() => {
        if (restartInfo) window.location.href = restartInfo.url;
      }, 2200);
    } catch (err) {
      setRestarting(false);
      setRestartError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    }
  };

  if (phase === "restart" && restartInfo) {
    const secure = restartInfo.tls === "on";
    return (
      <AuthShell
        title={t("auth.restartTitle")}
        subtitle={t("auth.restartBody")}
        footer={
          <span className="auth-note">
            <Icon name={secure ? "lock" : "info"} size={14} />
            {secure ? t("auth.httpsHint") : t("auth.httpHint")}
          </span>
        }
      >
        <div className="form-stack">
          <div className="transport-preview">
            <span className="event-icon">
              <Icon name={secure ? "lock" : "info"} size={18} />
            </span>
            <div>
              <strong>{secure ? t("auth.https") : t("auth.http")}</strong>
              <code className="mono">{restartInfo.url}</code>
            </div>
          </div>

          {restartError && (
            <p className="form-error" role="alert">
              <Icon name="alert" size={15} />
              <span>{restartError}</span>
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={restarting}
            onClick={() => void restartNow()}
          >
            {restarting ? t("auth.restarting") : t("auth.restartNow")}
          </button>

          <a className="btn btn-ghost btn-block" href={restartInfo.url}>
            <Icon name="external" size={15} />
            <span>{t("auth.openNewAddress")}</span>
          </a>
        </div>
      </AuthShell>
    );
  }

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

        <div className="field">
          <span className="field-label">{t("auth.transport")}</span>
          <Segmented<"on" | "off">
            value={tls}
            onChange={setTls}
            options={[
              { value: "on", label: t("auth.https"), icon: "lock" },
              { value: "off", label: t("auth.http"), icon: "info" },
            ]}
          />
          <span className="field-hint">
            {tls === "on" ? t("auth.httpsHint") : t("auth.httpHint")}
          </span>
        </div>

        {error && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={phase === "submitting"}>
          {phase === "submitting" ? t("auth.creating") : t("auth.createAccount")}
        </button>
      </form>
    </AuthShell>
  );
}
