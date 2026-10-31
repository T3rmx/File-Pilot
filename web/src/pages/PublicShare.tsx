import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError, api } from "../lib/api";
import type { PublicShare } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { cx, EmptyState, Spinner } from "../lib/ui";
import { FileGlyph } from "../components/FileIcon";
import { Icon, Logo } from "../components/Icons";
import { PreviewDialog } from "../components/PreviewDialog";
import type { PreviewTarget } from "../components/PreviewDialog";

type ErrorKind = "notFound" | "expired" | "revoked" | "exhausted" | "unavailable";

const ERROR_COPY: Record<ErrorKind, { title: string; body: string; icon: "alert" | "clock" | "shield" }> = {
  notFound: { title: "public.notFound", body: "public.notFoundHint", icon: "alert" },
  expired: { title: "public.expired", body: "public.expiredHint", icon: "clock" },
  revoked: { title: "public.revoked", body: "public.revokedHint", icon: "shield" },
  exhausted: { title: "public.exhausted", body: "public.exhaustedHint", icon: "alert" },
  unavailable: { title: "public.unavailable", body: "public.unavailableHint", icon: "alert" },
};

function errorKindOf(error: ApiError): ErrorKind {
  if (error.status === 404) return "notFound";
  const detail = error.detail.toLowerCase();
  if (detail.includes("revoked")) return "revoked";
  if (detail.includes("expired")) return "expired";
  if (detail.includes("limit")) return "exhausted";
  return "unavailable";
}

export function PublicSharePage() {
  const { token = "" } = useParams();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const [data, setData] = useState<PublicShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorKind(null);
    try {
      const result = await api.get<PublicShare>(`/api/public/${encodeURIComponent(token)}`);
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) setErrorKind(errorKindOf(err));
      else setErrorKind("unavailable");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async () => {
    if (!password) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      await api.post(`/api/public/${encodeURIComponent(token)}/unlock`, { password });
      setPassword("");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) setUnlockError(t("public.rateLimited"));
        else if (err.status === 410) setErrorKind(errorKindOf(err));
        else setUnlockError(t("public.wrongPassword"));
      } else {
        setUnlockError(t("common.unknownError"));
      }
    } finally {
      setUnlocking(false);
    }
  };

  const themeToggle = (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={t("settings.theme")}>
      <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
    </button>
  );

  const langToggle = (
    <button
      type="button"
      className="icon-btn lang-btn"
      onClick={() => setLang(lang === "en" ? "ar" : "en")}
      aria-label={t("settings.language")}
    >
      <Icon name="globe" size={16} />
      <span>{lang === "en" ? "ع" : "EN"}</span>
    </button>
  );

  return (
    <div className="public-page">
      <header className="public-bar">
        <Link className="public-brand" to="/">
          <Logo size={32} />
          <div>
            <span className="brand-name">FilePilot</span>
            <span className="brand-tagline">{t("public.secure")}</span>
          </div>
        </Link>
        <div className="public-tools">
          {themeToggle}
          {langToggle}
        </div>
      </header>

      <main className="public-main">
        {loading ? (
          <div className="public-card public-center">
            <Logo size={44} />
            <Spinner label={t("public.loading")} />
          </div>
        ) : errorKind ? (
          <div className="public-card public-state">
            <span className="empty-icon">
              <Icon name={ERROR_COPY[errorKind].icon} size={28} />
            </span>
            <h1>{t(ERROR_COPY[errorKind].title)}</h1>
            <p>{t(ERROR_COPY[errorKind].body)}</p>
            <Link className="btn btn-ghost" to="/">
              <Icon name="home" size={15} />
              <span>{t("public.backHome")}</span>
            </Link>
          </div>
        ) : data && data.password_required ? (
          <div className="public-card public-lock">
            <span className="lock-badge">
              <Icon name="lock" size={24} />
            </span>
            <h1>{t("public.passwordRequired")}</h1>
            <p>{t("public.passwordPrompt")}</p>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void unlock();
              }}
            >
              <input
                className="input"
                type="password"
                value={password}
                autoFocus
                autoComplete="current-password"
                placeholder={t("public.passwordPlaceholder")}
                aria-label={t("public.password")}
                maxLength={256}
                onChange={(event) => setPassword(event.target.value)}
              />
              {unlockError && (
                <p className="form-error" role="alert">
                  <Icon name="alert" size={15} />
                  <span>{unlockError}</span>
                </p>
              )}
              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={unlocking || !password}
              >
                {unlocking ? t("public.unlocking") : t("public.unlock")}
              </button>
            </form>
            <p className="public-owner">{t("public.sharedBy", { name: data.owner })}</p>
          </div>
        ) : data ? (
          <>
            <section className="public-card">
              <div className="public-head">
                <div className="public-title">
                  <FileGlyph
                    name={data.label || "share"}
                    isDir={data.kind === "folder"}
                    size={24}
                  />
                  <div>
                    <h1>{data.label || t("nav.shares")}</h1>
                    <p>{t("public.sharedBy", { name: data.owner })}</p>
                  </div>
                </div>
                <span className={cx("chip", `chip-${data.status}`)}>{t("shares.active")}</span>
              </div>

              <div className="public-meta">
                <span>
                  <Icon name="file" size={14} />
                  {t("public.filesCount", { n: data.items.length })}
                </span>
                <span>
                  <Icon name="database" size={14} />
                  {formatBytes(data.total_size, lang)}
                </span>
                {data.expires_at && (
                  <span>
                    <Icon name="clock" size={14} />
                    {t("public.expires", { when: formatDate(data.expires_at, lang) })}
                  </span>
                )}
                {data.downloads_left !== null && (
                  <span>
                    <Icon name="download" size={14} />
                    {t("public.downloadsLeft", { n: data.downloads_left })}
                  </span>
                )}
              </div>

              {data.items.length === 0 ? (
                <EmptyState icon="file" title={t("public.noFiles")} />
              ) : (
                <ul className="public-files">
                  {data.items.map((file) => (
                    <li key={file.id}>
                      <FileGlyph name={file.name} size={20} />
                      <div className="public-file-copy">
                        <span className="public-file-name" title={file.name}>
                          {file.name}
                        </span>
                        <span className="public-file-meta">{formatBytes(file.size, lang)}</span>
                      </div>
                      <div className="public-file-actions">
                        {file.can_preview && (
                          <button
                            type="button"
                            className="icon-btn icon-btn-sm"
                            title={t("common.preview")}
                            aria-label={t("common.preview")}
                            onClick={() =>
                              setPreview({
                                name: file.name,
                                mime: file.mime,
                                src: `/api/public/${encodeURIComponent(token)}/files/${file.id}/preview`,
                                downloadHref: `/api/public/${encodeURIComponent(token)}/files/${file.id}/download`,
                              })
                            }
                          >
                            <Icon name="eye" size={16} />
                          </button>
                        )}
                        <a
                          className="btn btn-ghost btn-sm"
                          href={`/api/public/${encodeURIComponent(token)}/files/${file.id}/download`}
                          download={file.name}
                        >
                          <Icon name="download" size={15} />
                          <span>{t("public.download")}</span>
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {data.zip_available && (
                <a
                  className="public-zip"
                  href={`/api/public/${encodeURIComponent(token)}/zip`}
                  download={`${data.label || "filepilot"}.zip`}
                >
                  <span className="stat-icon tone-teal">
                    <Icon name="archive" size={20} />
                  </span>
                  <span className="public-zip-copy">
                    <strong>{t("public.downloadAll")}</strong>
                    <span>{t("public.zipHint")}</span>
                  </span>
                  <Icon name="download" size={18} />
                </a>
              )}
            </section>

            <footer className="public-foot">
              <span>
                <Icon name="shield" size={14} />
                {t("public.secure")}
              </span>
              <a href="/trust" target="_blank" rel="noreferrer">
                {t("settings.trustCert")}
              </a>
              <span className="auth-foot-sep">·</span>
              <Link to="/">{t("public.backHome")}</Link>
            </footer>
          </>
        ) : null}
      </main>

      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
