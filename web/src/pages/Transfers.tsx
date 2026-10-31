import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { TransferItem } from "../lib/api";
import { formatBytes, formatDate, timeAgo } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { cx, EmptyState, Spinner } from "../lib/ui";
import { FileGlyph } from "../components/FileIcon";
import { Icon } from "../components/Icons";

type Filter = "all" | "upload" | "download";

export function TransfersPage() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<TransferItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.get<{ items: TransferItem[] }>("/api/transfers?limit=200");
      setItems(data.items);
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
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((current) => current + 1);
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.direction === filter)),
    [items, filter],
  );

  const uploads = items.filter((item) => item.direction === "upload").length;
  const downloads = items.length - uploads;

  const filters: { value: Filter; label: string; icon: "inbox" | "upload" | "download" }[] = [
    { value: "all", label: t("common.all"), icon: "inbox" },
    { value: "upload", label: t("transfers.upload"), icon: "upload" },
    { value: "download", label: t("transfers.download"), icon: "download" },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("transfers.title")}</h1>
          <p>{t("transfers.subtitle")}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setTick((current) => current + 1)}>
            <Icon name="refresh" size={16} />
            <span>{t("common.refresh")}</span>
          </button>
        </div>
      </header>

      <div className="status-tabs" role="tablist" aria-label={t("transfers.direction")}>
        {filters.map((option) => {
          const count = option.value === "all" ? items.length : option.value === "upload" ? uploads : downloads;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              className={cx("status-tab", filter === option.value && "is-active")}
              onClick={() => setFilter(option.value)}
            >
              <Icon name={option.icon} size={15} />
              <span>{option.label}</span>
              <span className="status-tab-count">{count}</span>
            </button>
          );
        })}
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
            icon={items.length === 0 ? "transfer" : "search"}
            title={items.length === 0 ? t("transfers.empty") : t("transfers.emptyFilter")}
            body={items.length === 0 ? t("transfers.emptyHint") : t("transfers.emptyFilterHint")}
            action={
              items.length === 0 ? (
                <a className="btn btn-primary" href="/files">
                  <Icon name="upload" size={16} />
                  <span>{t("dash.uploadFiles")}</span>
                </a>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setFilter("all")}
                >
                  {t("common.all")}
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="panel transfer-panel">
          <div className="transfer-row transfer-head" aria-hidden="true">
            <span className="transfer-file-cell">{t("transfers.filename")}</span>
            <span className="transfer-size-cell">{t("common.size")}</span>
            <span className="transfer-source-cell">{t("transfers.source")}</span>
            <span className="transfer-status-cell">{t("common.status")}</span>
            <span className="transfer-time-cell">{t("transfers.when")}</span>
          </div>
          {visible.map((item) => (
            <div key={item.id} className="transfer-row">
              <div className="transfer-file-cell">
                <span className={cx("event-icon", item.direction === "upload" ? "tone-teal" : "tone-indigo")}>
                  <Icon name={item.direction === "upload" ? "upload" : "download"} size={15} />
                </span>
                <FileGlyph name={item.filename} size={16} />
                <span className="transfer-name" title={item.filename}>
                  {item.filename}
                </span>
              </div>
              <span className="transfer-size-cell tabular">{formatBytes(item.size, lang)}</span>
              <span className="transfer-source-cell mono">{item.ip || "—"}</span>
              <span className="transfer-status-cell">
                <span className={cx("chip", item.status === "completed" ? "chip-active" : "chip-muted")}>
                  {item.status === "completed" ? t("transfers.completed") : item.status}
                </span>
              </span>
              <span className="transfer-time-cell" title={formatDate(item.created_at, lang)}>
                {timeAgo(item.created_at, lang)}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length > 0 && (
        <p className="list-meta">{t("transfers.count", { n: visible.length })}</p>
      )}
    </div>
  );
}
