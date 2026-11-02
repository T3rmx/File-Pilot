import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, api } from "../lib/api";
import type { Stats } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatBytes, timeAgo } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { copyText, cx, useUI } from "../lib/ui";
import { Icon } from "../components/Icons";
import type { IconName } from "../components/Icons";
import { StatSkeleton } from "../lib/ui";

const EVENT_ICONS: Record<string, IconName> = {
  "setup.completed": "sparkles",
  "auth.login": "logout",
  "auth.login_failed": "alert",
  "auth.password_changed": "key",
  "file.uploaded": "upload",
  "file.renamed": "edit",
  "file.deleted": "trash",
  "folder.created": "folder",
  "share.created": "link",
  "share.revoked": "shield",
  "settings.updated": "settings",
};

export function DashboardPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { toast } = useUI();
  const canWrite = user?.role !== "viewer";
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.get<Stats>("/api/stats");
      setStats(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("fp:files-changed", refresh);
    window.addEventListener("fp:shares-changed", refresh);
    return () => {
      window.removeEventListener("fp:files-changed", refresh);
      window.removeEventListener("fp:shares-changed", refresh);
    };
  }, [load]);

  const copyAddress = async () => {
    const ok = await copyText(window.location.origin);
    toast(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : "error");
  };

  const quota = stats?.quota_bytes ?? null;
  const used = stats?.storage_used ?? 0;
  const percent = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const eventLabel = (action: string) => {
    const key = `event.${action}`;
    const translated = t(key);
    return translated === key ? action.replace(/[._]/g, " ") : translated;
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("dash.welcome", { name: user?.display_name || user?.username || "" })}</h1>
          <p>{t("dash.subtitle")}</p>
        </div>
        <div className="page-actions">
          <a className="btn btn-ghost" href="/trust" target="_blank" rel="noreferrer">
            <Icon name="shield" size={16} />
            <span>{t("dash.trust")}</span>
          </a>
          <Link className="btn btn-primary" to="/files">
            <Icon name={canWrite ? "upload" : "folder"} size={16} />
            <span>{canWrite ? t("dash.uploadFiles") : t("dash.browseFiles")}</span>
          </Link>
        </div>
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            {t("common.retry")}
          </button>
        </div>
      )}

      <section className="stat-grid" aria-label={t("dash.title")}>
        {loading || !stats ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-icon tone-teal">
                  <Icon name="folder" size={19} />
                </span>
                <span className="stat-label">{t("dash.files")}</span>
              </div>
              <strong className="stat-value">{new Intl.NumberFormat(lang === "ar" ? "ar" : "en").format(stats.files)}</strong>
              <span className="stat-foot">
                {new Intl.NumberFormat(lang === "ar" ? "ar" : "en").format(stats.folders)} {t("dash.folders")}
              </span>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-icon tone-indigo">
                  <Icon name="database" size={19} />
                </span>
                <span className="stat-label">{t("dash.storage")}</span>
              </div>
              <strong className="stat-value">{formatBytes(stats.storage_used, lang)}</strong>
              {quota ? (
                <>
                  <div className={cx("progress-track stat-meter", percent > 90 && "is-warn")}>
                    <div className="progress-fill" style={{ inlineSize: `${percent}%` }} />
                  </div>
                  <span className="stat-foot">
                    {t("dash.storageMeter", {
                      used: formatBytes(stats.storage_used, lang),
                      total: formatBytes(quota, lang),
                    })}
                  </span>
                </>
              ) : (
                <span className="stat-foot">{t("dash.noQuota")}</span>
              )}
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-icon tone-violet">
                  <Icon name="link" size={19} />
                </span>
                <span className="stat-label">{t("dash.activeShares")}</span>
              </div>
              <strong className="stat-value">{stats.active_shares}</strong>
              <span className="stat-foot">
                {stats.expiring_soon > 0 ? (
                  <span className="stat-warn">{t("dash.expiringSoon", { n: stats.expiring_soon })}</span>
                ) : (
                  t("shares.active")
                )}
              </span>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-icon tone-amber">
                  <Icon name="download" size={19} />
                </span>
                <span className="stat-label">{t("dash.downloads")}</span>
              </div>
              <strong className="stat-value">
                {new Intl.NumberFormat(lang === "ar" ? "ar" : "en").format(stats.total_downloads)}
              </strong>
              <span className="stat-foot">{t("dash.downloadsHint")}</span>
            </article>
          </>
        )}
      </section>

      <div className="dash-grid">
        <section className="panel">
          <header className="panel-head">
            <h2>{t("dash.recent")}</h2>
            <Icon name="clock" size={17} />
          </header>
          {loading ? (
            <div className="skeleton-list">
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
            </div>
          ) : !stats || stats.recent.length === 0 ? (
            <div className="panel-empty">
              <span className="empty-icon">
                <Icon name="sparkles" size={24} />
              </span>
              <p>{t("dash.noActivity")}</p>
            </div>
          ) : (
            <ul className="event-list">
              {stats.recent.slice(0, 7).map((event, index) => (
                <li key={`${event.action}-${event.at}-${index}`} className="event-row">
                  <span className={cx("event-icon", event.action.includes("failed") && "is-danger")}>
                    <Icon name={EVENT_ICONS[event.action] ?? "clock"} size={16} />
                  </span>
                  <div className="event-copy">
                    <span className="event-title">{eventLabel(event.action)}</span>
                    {event.target && <span className="event-target">{event.target}</span>}
                  </div>
                  <time className="event-time">{timeAgo(event.at, lang)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="dash-side">
          <section className="panel">
            <header className="panel-head">
              <h2>{t("dash.quickActions")}</h2>
            </header>
            <div className="quick-list">
              <Link className="quick-item" to="/files">
                <span className="stat-icon tone-teal">
                  <Icon name={canWrite ? "upload" : "folder"} size={18} />
                </span>
                <span className="quick-copy">
                  <strong>{canWrite ? t("dash.uploadFiles") : t("dash.browseFiles")}</strong>
                  <span>{canWrite ? t("dash.uploadHint") : t("dash.browseHint")}</span>
                </span>
                <Icon name="chevronRight" size={16} />
              </Link>
              <Link className="quick-item" to="/shares">
                <span className="stat-icon tone-violet">
                  <Icon name="link" size={18} />
                </span>
                <span className="quick-copy">
                  <strong>{t("dash.manageShares")}</strong>
                  <span>{t("dash.manageSharesHint")}</span>
                </span>
                <Icon name="chevronRight" size={16} />
              </Link>
              <Link className="quick-item" to="/transfers">
                <span className="stat-icon tone-amber">
                  <Icon name="transfer" size={18} />
                </span>
                <span className="quick-copy">
                  <strong>{t("dash.viewTransfers")}</strong>
                  <span>{t("dash.viewTransfersHint")}</span>
                </span>
                <Icon name="chevronRight" size={16} />
              </Link>
            </div>
          </section>

          <section className="panel server-panel">
            <header className="panel-head">
              <h2>{t("dash.server")}</h2>
              <span className="chip chip-ok">
                <span className="status-dot" />
                6969
              </span>
            </header>
            <p className="server-address" title={window.location.origin}>
              {window.location.origin}
            </p>
            <div className="server-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyAddress()}>
                <Icon name="copy" size={15} />
                <span>{t("dash.copyAddress")}</span>
              </button>
              <a className="btn btn-ghost btn-sm" href="/ca.crt" download="filepilot-ca.crt">
                <Icon name="download" size={15} />
                <span>{t("settings.trustCert")}</span>
              </a>
            </div>
            <p className="server-note">
              <Icon name="lock" size={14} />
              <span>{t("settings.aboutBody")}</span>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
