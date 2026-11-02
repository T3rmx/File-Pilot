import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { ApiError, api } from "../lib/api";
import type { AuditItem, ServerSettings } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate, timeAgo } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { Lang } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { copyText, cx, Field, Modal, Segmented, Spinner, Toggle, useUI } from "../lib/ui";
import { Icon } from "../components/Icons";
import { UsersPanel } from "../components/UsersPanel";
import { useNavigate } from "react-router-dom";

type ThemeChoice = "light" | "dark";
type TlsChoice = "on" | "off";

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { user, resetLocal } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useUI();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";

  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(isAdmin);
  const [savingSettings, setSavingSettings] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [allowUploads, setAllowUploads] = useState(true);
  const [maxUpload, setMaxUpload] = useState("4096");
  const [lanDiscovery, setLanDiscovery] = useState(true);
  const [tlsMode, setTlsMode] = useState<TlsChoice>("on");
  const [restartOpen, setRestartOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(isAdmin);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const loadSettings = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingSettings(true);
    try {
      const data = await api.get<ServerSettings>("/api/settings");
      setSettings(data);
      setSiteName(data.site_name);
      setAllowUploads(data.allow_uploads);
      setMaxUpload(String(data.max_upload_mb));
      setLanDiscovery(data.lan_discovery);
      setTlsMode(data.tls_mode);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : t("settings.loadFailed"), "error");
    } finally {
      setLoadingSettings(false);
    }
  }, [isAdmin, t, toast]);

  const loadAudit = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingAudit(true);
    try {
      const data = await api.get<{ items: AuditItem[] }>("/api/audit?limit=100");
      setAudit(data.items);
    } catch {
      /* the audit log is a convenience, never a blocker */
    } finally {
      setLoadingAudit(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadSettings();
    void loadAudit();
  }, [loadSettings, loadAudit]);

  const saveSettings = async () => {
    if (!isAdmin) return;
    const trimmed = siteName.trim();
    if (!trimmed) {
      toast(t("settings.siteName"), "error");
      return;
    }
    const size = Number(maxUpload);
    if (!Number.isFinite(size) || size < 1) {
      toast(t("settings.maxUpload"), "error");
      return;
    }
    const tlsLocked = settings ? settings.tls_source === "cli" || settings.tls_source === "env" : false;
    setSavingSettings(true);
    try {
      const data = await api.patch<ServerSettings>("/api/settings", {
        site_name: trimmed,
        allow_uploads: allowUploads,
        max_upload_mb: Math.round(size),
        lan_discovery: lanDiscovery,
        ...(tlsLocked ? {} : { tls: tlsMode }),
      });
      setSettings(data);
      setSiteName(data.site_name);
      setMaxUpload(String(data.max_upload_mb));
      setTlsMode(data.tls_mode);
      toast(t("settings.saved"), "success");
      if (data.restart_required) setRestartOpen(true);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : t("common.unknownError"), "error");
    } finally {
      setSavingSettings(false);
    }
  };

  const restartForTls = async () => {
    if (!settings) return;
    const target = settings.tls_mode === "on"
      ? settings.lan_url.replace(/^http:\/\//, "https://")
      : settings.lan_url.replace(/^https:\/\//, "http://");
    setRestarting(true);
    try {
      await api.post("/api/system/restart");
      window.setTimeout(() => {
        window.location.href = target;
      }, 2400);
    } catch (err) {
      setRestarting(false);
      toast(err instanceof ApiError ? err.detail : t("common.unknownError"), "error");
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError("");
    if (newPassword.length < 8) {
      setPasswordError(t("auth.passwordHint"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("auth.passwordMismatch"));
      return;
    }
    setPasswordBusy(true);
    try {
      await api.post("/api/auth/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast(t("auth.passwordChanged"), "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPasswordError(t("auth.badCredentials"));
      } else {
        setPasswordError(err instanceof ApiError ? err.detail : t("common.unknownError"));
      }
    } finally {
      setPasswordBusy(false);
    }
  };

  const copyLan = async () => {
    if (!settings) return;
    const ok = await copyText(settings.lan_url);
    toast(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : "error");
  };

  const resetServer = async () => {
    try {
      await api.post("/api/system/reset");
      toast(t("settings.resetDone"), "success");
      resetLocal();
      navigate("/setup");
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : t("common.unknownError"), "error");
    }
  };

  const actionLabel = (action: string) => {
    const key = `event.${action}`;
    const translated = t(key);
    return translated === key ? action.replace(/[._]/g, " ") : translated;
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.subtitle")}</p>
        </div>
      </header>

      <div className="settings-cols">
        <section className="panel">
          <header className="panel-head">
            <h2>{t("settings.appearance")}</h2>
            <Icon name="sun" size={17} />
          </header>
          <div className="panel-body form-stack">
            <Field label={t("settings.theme")} hint={t("settings.themeHint")}>
              <Segmented<ThemeChoice>
                value={theme}
                onChange={(next) => setTheme(next)}
                options={[
                  { value: "light", label: t("settings.light"), icon: "sun" },
                  { value: "dark", label: t("settings.dark"), icon: "moon" },
                ]}
              />
            </Field>
            <Field label={t("settings.language")} hint={t("settings.languageHint")}>
              <Segmented<Lang>
                value={lang}
                onChange={(next) => setLang(next)}
                options={[
                  { value: "en", label: "English", icon: "globe" },
                  { value: "ar", label: "العربية", icon: "globe" },
                ]}
              />
            </Field>
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>{t("settings.account")}</h2>
            <Icon name="user" size={17} />
          </header>
          <div className="panel-body form-stack">
            <div className="account-row">
              <span className="avatar">{user?.display_name?.slice(0, 2).toUpperCase() || "FP"}</span>
              <div>
                <strong>{user?.display_name || user?.username}</strong>
                <span className="account-meta">
                  {user?.username} · {t(`users.role.${user?.role ?? "user"}`)}
                </span>
              </div>
            </div>
            <p className="panel-note">
              <Icon name="shield" size={15} />
              <span>{t("settings.aboutBody")}</span>
            </p>
          </div>
        </section>
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>{t("settings.general")}</h2>
          <Icon name="server" size={17} />
        </header>
        <div className="panel-body">
          {!isAdmin ? (
            <p className="panel-note">
              <Icon name="lock" size={15} />
              <span>{t("settings.adminOnly")}</span>
            </p>
          ) : loadingSettings || !settings ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <div className="form-stack">
              <div className="form-grid">
                <Field label={t("settings.siteName")} hint={t("settings.siteNameHint")} htmlFor="site-name">
                  <input
                    id="site-name"
                    className="input"
                    value={siteName}
                    maxLength={80}
                    onChange={(event) => setSiteName(event.target.value)}
                  />
                </Field>
                <Field label={t("settings.maxUpload")} hint={t("settings.maxUploadHint")} htmlFor="max-upload">
                  <input
                    id="max-upload"
                    className="input"
                    type="number"
                    min={1}
                    max={65536}
                    value={maxUpload}
                    onChange={(event) => setMaxUpload(event.target.value)}
                  />
                </Field>
              </div>

              <Toggle
                checked={allowUploads}
                onChange={setAllowUploads}
                label={t("settings.allowUploads")}
                hint={t("settings.allowUploadsHint")}
              />
              <Toggle
                checked={lanDiscovery}
                onChange={setLanDiscovery}
                label={t("settings.lanDiscovery")}
                hint={t("settings.lanDiscoveryHint")}
              />

              {settings.tls_active === "off" && (
                <div className="alert alert-warn" role="status">
                  <Icon name="alert" size={18} />
                  <span>{t("settings.httpWarning")}</span>
                </div>
              )}

              <div className="field">
                <span className="field-label">{t("settings.transport")}</span>
                {settings.tls_source === "cli" || settings.tls_source === "env" ? (
                  <code className="lan-url">
                    {settings.tls_mode === "on" ? t("auth.https") : t("auth.http")} ·{" "}
                    {t("settings.tlsLocked")}
                  </code>
                ) : (
                  <Segmented<TlsChoice>
                    value={tlsMode}
                    onChange={setTlsMode}
                    options={[
                      { value: "on", label: t("auth.https"), icon: "lock" },
                      { value: "off", label: t("auth.http"), icon: "info" },
                    ]}
                  />
                )}
                <span className="field-hint">
                  {tlsMode === "on" ? t("auth.httpsHint") : t("auth.httpHint")}
                </span>
                {settings.restart_required && (
                  <span className="field-hint field-warn">{t("settings.restartPending")}</span>
                )}
              </div>

              <div className="lan-row">
                <div className="lan-copy">
                  <span className="field-label">{t("settings.lanAddress")}</span>
                  <code className="lan-url">{settings.lan_url}</code>
                  <span className="field-hint">{t("settings.lanUrlHint")}</span>
                </div>
                <div className="lan-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyLan()}>
                    <Icon name="copy" size={15} />
                    <span>{t("common.copy")}</span>
                  </button>
                  {settings.tls_active === "on" && (
                    <>
                      <a className="btn btn-ghost btn-sm" href="/trust" target="_blank" rel="noreferrer">
                        <Icon name="shield" size={15} />
                        <span>{t("settings.trustCert")}</span>
                      </a>
                      <a className="btn btn-ghost btn-sm" href="/ca.crt" download="filepilot-ca.crt">
                        <Icon name="download" size={15} />
                        <span>{t("common.download")}</span>
                      </a>
                    </>
                  )}
                </div>
              </div>
              {settings.tls_active === "on" && (
                <p className="field-hint">{t("settings.trustHint")}</p>
              )}

              <div className="settings-foot">
                <span className="version-tag">
                  {t("settings.version")} {settings.version}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={savingSettings}
                  onClick={() => setResetOpen(true)}
                >
                  <Icon name="alert" size={15} />
                  <span>{t("settings.resetServer")}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={savingSettings}
                  onClick={() => void saveSettings()}
                >
                  {savingSettings ? t("common.loading") : t("common.save")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t("settings.resetTitle")}
        subtitle={t("settings.resetSubtitle")}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setResetOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void resetServer()}>
              {t("settings.resetConfirm")}
            </button>
          </>
        }
      >
        <p className="modal-text">{t("settings.resetBody")}</p>
      </Modal>

      <Modal
        open={restartOpen}
        onClose={() => {
          if (!restarting) setRestartOpen(false);
        }}
        title={t("settings.restartTitle")}
        subtitle={t("settings.restartSubtitle")}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={restarting}
              onClick={() => setRestartOpen(false)}
            >
              {t("settings.restartLater")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={restarting}
              onClick={() => void restartForTls()}
            >
              {restarting ? t("auth.restarting") : t("auth.restartNow")}
            </button>
          </>
        }
      >
        <p className="modal-text">
          {t("settings.restartBody", {
            mode: settings?.tls_mode === "on" ? t("auth.https") : t("auth.http"),
          })}
        </p>
      </Modal>

      {isAdmin && <UsersPanel />}

      <section className="panel">
        <header className="panel-head">
          <h2>{t("settings.passwordTitle")}</h2>
          <Icon name="key" size={17} />
        </header>
        <div className="panel-body">
          <form className="form-stack" onSubmit={(event) => void changePassword(event)}>
            <p className="panel-note">
              <Icon name="lock" size={15} />
              <span>{t("settings.passwordNote")}</span>
            </p>
            <div className="form-grid form-grid-3">
              <Field label={t("auth.currentPassword")} htmlFor="current-password">
                <input
                  id="current-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  maxLength={256}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
              <Field label={t("auth.newPassword")} htmlFor="new-password">
                <input
                  id="new-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  maxLength={256}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>
              <Field label={t("auth.confirmPassword")} htmlFor="confirm-password">
                <input
                  id="confirm-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  maxLength={256}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </Field>
            </div>
            {passwordError && (
              <p className="form-error" role="alert">
                <Icon name="alert" size={15} />
                <span>{passwordError}</span>
              </p>
            )}
            <div className="settings-foot">
              <span className="field-hint">{t("auth.passwordHint")}</span>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
              >
                {passwordBusy ? t("common.loading") : t("auth.changePassword")}
              </button>
            </div>
          </form>
        </div>
      </section>

      {isAdmin && (
        <section className="panel">
          <header className="panel-head">
            <h2>{t("settings.audit")}</h2>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              title={t("common.refresh")}
              aria-label={t("common.refresh")}
              onClick={() => void loadAudit()}
            >
              <Icon name="refresh" size={15} />
            </button>
          </header>
          <div className="panel-body">
            {loadingAudit ? (
              <Spinner label={t("common.loading")} />
            ) : audit.length === 0 ? (
              <p className="panel-note">
                <Icon name="clock" size={15} />
                <span>{t("settings.auditEmpty")}</span>
              </p>
            ) : (
              <ul className="audit-list">
                {audit.map((item) => (
                  <li key={item.id} className={cx("audit-row", item.action.includes("failed") && "is-danger")}>
                    <span className="event-icon">
                      <Icon
                        name={
                          item.action.includes("failed")
                            ? "alert"
                            : item.action.startsWith("share")
                              ? "link"
                              : item.action.startsWith("file") || item.action.startsWith("folder")
                                ? "file"
                                : "shield"
                        }
                        size={15}
                      />
                    </span>
                    <div className="audit-copy">
                      <span className="event-title">{actionLabel(item.action)}</span>
                      <span className="event-target">
                        {item.actor}
                        {item.target ? ` · ${item.target}` : ""}
                        {item.ip ? ` · ${item.ip}` : ""}
                      </span>
                    </div>
                    <time className="event-time" title={formatDate(item.created_at, lang)}>
                      {timeAgo(item.created_at, lang)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <p className="settings-about">
        <Icon name="shield" size={14} />
        <span>{t("settings.aboutBody")}</span>
        <span className="version-tag">
          {t("settings.version")} {settings?.version ?? "1.0.0"}
        </span>
      </p>
    </div>
  );
}
