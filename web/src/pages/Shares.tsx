import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { Share } from "../lib/api";
import { formatBytes, formatDate, timeAgo, truncateMiddle } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { copyText, cx, EmptyState, Modal, Spinner, useUI } from "../lib/ui";
import { FileGlyph } from "../components/FileIcon";
import { Icon } from "../components/Icons";

type Filter = "all" | "active" | "expired" | "revoked" | "exhausted";

const FILTERS: Filter[] = ["all", "active", "expired", "revoked", "exhausted"];

const STATUS_KEY: Record<string, string> = {
  active: "shares.active",
  expired: "shares.expired",
  revoked: "shares.revoked",
  exhausted: "shares.exhausted",
};

export function SharesPage() {
  const { t, lang } = useI18n();
  const { toast } = useUI();
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [qrShare, setQrShare] = useState<Share | null>(null);
  const [revokeShare, setRevokeShare] = useState<Share | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.get<{ items: Share[] }>("/api/shares");
      setShares(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  useEffect(() => {
    const refresh = () => setTick((current) => current + 1);
    window.addEventListener("fp:shares-changed", refresh);
    return () => window.removeEventListener("fp:shares-changed", refresh);
  }, []);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = {
      all: shares.length,
      active: 0,
      expired: 0,
      revoked: 0,
      exhausted: 0,
    };
    for (const share of shares) {
      const status = share.status as Filter;
      if (status in base && status !== "all") base[status] += 1;
    }
    return base;
  }, [shares]);

  const visible = filter === "all" ? shares : shares.filter((share) => share.status === filter);

  const copy = async (share: Share) => {
    const ok = await copyText(share.url);
    toast(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : "error");
  };

  const confirmRevoke = async () => {
    if (!revokeShare) return;
    setRevoking(true);
    try {
      await api.del(`/api/shares/${revokeShare.id}`);
      toast(t("toast.linkRevoked"), "success");
      setRevokeShare(null);
      setTick((current) => current + 1);
      window.dispatchEvent(new CustomEvent("fp:shares-changed"));
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : t("common.unknownError"), "error");
    } finally {
      setRevoking(false);
    }
  };

  const filterLabel = (value: Filter) =>
    value === "all" ? t("common.all") : t(STATUS_KEY[value] ?? value);

  const itemSummary = (share: Share) => {
    if (share.kind === "folder") return t("shares.folder");
    if (share.kind === "collection" || share.item_count > 1) {
      return t("shares.collection", { n: share.item_count });
    }
    return t("shares.single");
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("shares.title")}</h1>
          <p>{t("shares.subtitle")}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setTick((current) => current + 1)}>
            <Icon name="refresh" size={16} />
            <span>{t("common.refresh")}</span>
          </button>
        </div>
      </header>

      <div className="status-tabs" role="tablist" aria-label={t("shares.filter")}>
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={cx("status-tab", filter === value && "is-active")}
            onClick={() => setFilter(value)}
          >
            <span>{filterLabel(value)}</span>
            <span className="status-tab-count">{counts[value]}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTick((current) => current + 1)}>
            {t("common.retry")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="panel file-panel">
          <Spinner label={t("common.loading")} />
        </div>
      ) : visible.length === 0 ? (
        <div className="panel file-panel">
          <EmptyState
            icon={shares.length === 0 ? "link" : "search"}
            title={shares.length === 0 ? t("shares.empty") : t("shares.noMatches")}
            body={shares.length === 0 ? t("shares.emptyHint") : t("shares.noMatchesHint")}
            action={
              shares.length === 0 ? (
                <a className="btn btn-primary" href="/files">
                  <Icon name="folder" size={16} />
                  <span>{t("nav.files")}</span>
                </a>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => setFilter("all")}>
                  {t("common.all")}
                </button>
              )
            }
          />
        </div>
      ) : (
        <>
          <p className="list-meta">
            {t("shares.count", { n: visible.length })} · {filterLabel(filter)}
          </p>
          <div className="share-grid">
            {visible.map((share) => {
              const limited = share.max_downloads !== null;
              const percent = limited
                ? Math.min(100, Math.round((share.download_count / (share.max_downloads || 1)) * 100))
                : 0;
              return (
                <article key={share.id} className={cx("share-card", `status-${share.status}`)}>
                  <div className="share-card-head">
                    <div className="share-identity">
                      <FileGlyph
                        name={share.label || "share"}
                        isDir={share.kind === "folder"}
                        size={20}
                      />
                      <div className="share-title-group">
                        <h2 title={share.label}>{share.label || t("nav.shares")}</h2>
                        <span className="share-sub">{itemSummary(share)}</span>
                      </div>
                    </div>
                    <span className={cx("chip", `chip-${share.status}`)}>
                      {t(STATUS_KEY[share.status] ?? share.status)}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="share-url"
                    onClick={() => void copy(share)}
                    title={share.url}
                  >
                    <Icon name="link" size={14} />
                    <span className="mono">{truncateMiddle(share.url, 48)}</span>
                    <Icon name="copy" size={14} />
                  </button>

                  <dl className="share-stats">
                    <div>
                      <dt>{t("common.size")}</dt>
                      <dd>{formatBytes(share.total_size, lang)}</dd>
                    </div>
                    <div>
                      <dt>{t("dash.downloads")}</dt>
                      <dd>
                        {limited
                          ? t("shares.downloadsCount", {
                              n: share.download_count,
                              max: share.max_downloads ?? 0,
                            })
                          : share.download_count}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("auth.password")}</dt>
                      <dd>
                        {share.password_protected ? (
                          <span className="inline-icon">
                            <Icon name="lock" size={13} />
                            {t("shares.password")}
                          </span>
                        ) : (
                          t("shares.noPassword")
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("common.status")}</dt>
                      <dd title={formatDate(share.created_at, lang)}>
                        {share.expires_at
                          ? t("shares.expires", { when: formatDate(share.expires_at, lang) })
                          : t("common.never")}
                      </dd>
                    </div>
                  </dl>

                  {limited && (
                    <div className="share-limit">
                      <div className={cx("progress-track", percent >= 100 && "is-warn")}>
                        <div className="progress-fill" style={{ inlineSize: `${percent}%` }} />
                      </div>
                      <span>
                        {share.downloads_left === null
                          ? t("common.unlimited")
                          : t("shares.downloadsLeft", { n: share.downloads_left })}
                      </span>
                    </div>
                  )}

                  <footer className="share-card-foot">
                    <span className="share-age">
                      <Icon name="clock" size={13} />
                      {timeAgo(share.created_at, lang)}
                    </span>
                    <div className="share-actions">
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        title={t("shares.qr")}
                        aria-label={t("shares.qr")}
                        onClick={() => setQrShare(share)}
                      >
                        <Icon name="qr" size={16} />
                      </button>
                      <a
                        className="icon-btn icon-btn-sm"
                        href={share.url}
                        target="_blank"
                        rel="noreferrer"
                        title={t("shares.open")}
                        aria-label={t("shares.open")}
                      >
                        <Icon name="external" size={15} />
                      </a>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void copy(share)}
                      >
                        <Icon name="copy" size={15} />
                        <span>{t("shares.copyLink")}</span>
                      </button>
                      {share.status === "active" && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger-text"
                          onClick={() => setRevokeShare(share)}
                        >
                          <Icon name="x" size={15} />
                          <span>{t("shares.revoke")}</span>
                        </button>
                      )}
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        </>
      )}

      <Modal
        open={Boolean(qrShare)}
        onClose={() => setQrShare(null)}
        title={t("shares.qrTitle")}
        subtitle={qrShare?.label}
        size="sm"
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setQrShare(null)}>
            {t("common.close")}
          </button>
        }
      >
        {qrShare && (
          <div className="qr-panel">
            <div className="qr-frame" dangerouslySetInnerHTML={{ __html: qrShare.qr_svg }} />
            <p className="qr-hint">{t("shares.copyQrHint")}</p>
            <button type="button" className="share-url" onClick={() => void copy(qrShare)}>
              <Icon name="link" size={14} />
              <span className="mono">{truncateMiddle(qrShare.url, 40)}</span>
              <Icon name="copy" size={14} />
            </button>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(revokeShare)}
        onClose={() => setRevokeShare(null)}
        title={t("shares.revokeTitle")}
        subtitle={revokeShare?.label}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRevokeShare(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={revoking}
              onClick={() => void confirmRevoke()}
            >
              {revoking ? t("shares.revoking") : t("shares.revoke")}
            </button>
          </>
        }
      >
        <p className="modal-text">{t("shares.revokeBody")}</p>
      </Modal>
    </div>
  );
}
