import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError, api } from "../lib/api";
import type { FileEntry, FileList } from "../lib/api";
import { fileExtension, formatBytes, formatDay } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { cx, EmptyState, Field, Modal, Segmented, useUI } from "../lib/ui";
import { FileGlyph } from "../components/FileIcon";
import { Icon } from "../components/Icons";
import { PreviewDialog } from "../components/PreviewDialog";
import type { PreviewTarget } from "../components/PreviewDialog";
import { ShareDialog } from "../components/ShareDialog";
import type { ShareTarget } from "../components/ShareDialog";

type ViewMode = "list" | "grid";

function initialView(): ViewMode {
  try {
    const stored = localStorage.getItem("fp_view");
    if (stored === "grid" || stored === "list") return stored;
  } catch {
    /* ignore */
  }
  return "list";
}

export function FilesPage() {
  const { t, lang } = useI18n();
  const { queueUploads, toast } = useUI();
  const [params, setParams] = useSearchParams();
  const folderId = params.get("folder");
  const query = params.get("q") ?? "";

  const [data, setData] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [searchInput, setSearchInput] = useState(query);
  const [view, setView] = useState<ViewMode>(initialView);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<FileEntry[]>([]);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams();
        if (folderId) qs.set("folder_id", folderId);
        if (query) qs.set("search", query);
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        const result = await api.get<FileList>(`/api/files${suffix}`);
        if (cancelled) return;
        setData(result);
        setSelected(new Set());
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.detail : t("common.unknownError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [folderId, query, reloadTick, t]);

  useEffect(() => {
    const refresh = () => setReloadTick((tick) => tick + 1);
    window.addEventListener("fp:files-changed", refresh);
    return () => window.removeEventListener("fp:files-changed", refresh);
  }, []);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) void queueUploads(files, folderId);
    };
    const onEnd = () => {
      depth = 0;
      setDragging(false);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onEnd);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onEnd);
    };
  }, [folderId, queueUploads]);

  const report = useCallback(
    (err: unknown) => {
      toast(err instanceof ApiError ? err.detail : t("common.unknownError"), "error");
    },
    [t, toast],
  );

  const openFolder = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("folder", id);
    else next.delete("folder");
    next.delete("q");
    setParams(next);
  };

  const applySearch = (value: string) => {
    const next = new URLSearchParams(params);
    const trimmed = value.trim();
    if (trimmed) {
      next.set("q", trimmed);
      next.delete("folder");
    } else {
      next.delete("q");
    }
    setParams(next);
  };

  const clearSearch = () => {
    setSearchInput("");
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next);
  };

  const changeView = (mode: ViewMode) => {
    setView(mode);
    try {
      localStorage.setItem("fp_view", mode);
    } catch {
      /* ignore */
    }
  };

  const selectAll = () => {
    if (!data) return;
    if (selected.size === data.items.length) setSelected(new Set());
    else setSelected(new Set(data.items.map((item) => item.id)));
  };

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) void queueUploads(files, folderId);
    event.target.value = "";
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.post("/api/files/folder", { name, parent_id: folderId });
      toast(t("toast.folderCreated"), "success");
      setFolderModal(false);
      setFolderName("");
      setReloadTick((tick) => tick + 1);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy(true);
    try {
      await api.patch(`/api/files/${renameTarget.id}`, { name: renameValue.trim() });
      toast(t("toast.renamed"), "success");
      setRenameTarget(null);
      setReloadTick((tick) => tick + 1);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteTargets.length === 0) return;
    setBusy(true);
    try {
      for (const entry of deleteTargets) {
        await api.del(`/api/files/${entry.id}`);
      }
      toast(t("toast.deleted"), "success");
      setDeleteTargets([]);
      setReloadTick((tick) => tick + 1);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const openShare = (entry: FileEntry) => {
    setShareTarget(
      entry.is_dir
        ? { name: entry.name, folderId: entry.id }
        : { name: entry.name, fileIds: [entry.id] },
    );
    setShareOpen(true);
  };

  const selectedEntries = data?.items.filter((item) => selected.has(item.id)) ?? [];
  const selectedFiles = selectedEntries.filter((item) => !item.is_dir);

  const shareSelected = () => {
    if (selectedEntries.length === 1) {
      openShare(selectedEntries[0]);
      return;
    }
    if (selectedFiles.length === 0) return;
    setShareTarget({
      name: t("shares.collection", { n: selectedFiles.length }),
      fileIds: selectedFiles.map((item) => item.id),
    });
    setShareOpen(true);
  };

  const previewEntry = (entry: FileEntry) => {
    setPreview({
      name: entry.name,
      mime: entry.mime,
      src: entry.can_preview ? `/api/files/${entry.id}/preview` : null,
      downloadHref: `/api/files/${entry.id}/download`,
    });
  };

  const items = data?.items ?? [];
  const isEmpty = !loading && items.length === 0;
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("files.title")}</h1>
          <p>{t("files.subtitle")}</p>
        </div>
        <div className="page-actions">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={onPickFiles}
            aria-hidden="true"
            tabIndex={-1}
          />
          <button type="button" className="btn btn-ghost" onClick={() => setFolderModal(true)}>
            <Icon name="plus" size={16} />
            <span>{t("files.newFolder")}</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={16} />
            <span>{t("files.upload")}</span>
          </button>
        </div>
      </header>

      <div className="files-toolbar">
        <div className="crumb-row">
          {query ? (
            <span className="crumb-current">{t("files.searchResults", { q: query })}</span>
          ) : (
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <button type="button" className="crumb" onClick={() => openFolder(null)}>
                <Icon name="home" size={15} />
                <span>{t("files.root")}</span>
              </button>
              {(data?.breadcrumbs ?? [])
                .filter((crumb) => crumb.id !== null)
                .map((crumb, index, list) => (
                  <span key={crumb.id ?? `crumb-${index}`} className="crumb-wrap">
                    <Icon name="chevronRight" size={14} className="crumb-sep" />
                    {index === list.length - 1 ? (
                      <span className="crumb-current">{crumb.name}</span>
                    ) : (
                      <button type="button" className="crumb" onClick={() => openFolder(crumb.id)}>
                        {crumb.name}
                      </button>
                    )}
                  </span>
                ))}
            </nav>
          )}
          {query && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearSearch}>
              <Icon name="x" size={14} />
              <span>{t("files.clearSearch")}</span>
            </button>
          )}
        </div>

        <div className="toolbar-right">
          <form
            className="search-box"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              applySearch(searchInput);
            }}
          >
            <Icon name="search" size={16} />
            <input
              value={searchInput}
              placeholder={t("files.searchPlaceholder")}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label={t("common.search")}
            />
            {searchInput && (
              <button
                type="button"
                className="search-clear"
                onClick={() => {
                  setSearchInput("");
                  if (query) clearSearch();
                }}
                aria-label={t("common.close")}
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </form>
          <Segmented<ViewMode>
            value={view}
            onChange={changeView}
            label={t("files.title")}
            options={[
              { value: "list", label: t("files.list"), icon: "list" },
              { value: "grid", label: t("files.grid"), icon: "grid" },
            ]}
          />
        </div>
      </div>

      {selectedEntries.length > 0 && (
        <div className="selection-bar">
          <span className="selection-count">
            {selectedEntries.length} {t("common.selected")}
          </span>
          <div className="selection-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={shareSelected}
              disabled={selectedFiles.length === 0 && selectedEntries.length !== 1}
            >
              <Icon name="link" size={15} />
              <span>{t("files.shareSelected")}</span>
            </button>
            {selectedEntries.length === 1 && !selectedEntries[0].is_dir && (
              <a
                className="btn btn-ghost btn-sm"
                href={`/api/files/${selectedEntries[0].id}/download`}
              >
                <Icon name="download" size={15} />
                <span>{t("common.download")}</span>
              </a>
            )}
            {selectedEntries.length === 1 && selectedEntries[0].is_dir && (
              <a className="btn btn-ghost btn-sm" href={`/api/files/${selectedEntries[0].id}/zip`}>
                <Icon name="archive" size={15} />
                <span>{t("files.downloadZip")}</span>
              </a>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-danger-text"
              onClick={() => setDeleteTargets(selectedEntries)}
            >
              <Icon name="trash" size={15} />
              <span>{t("common.delete")}</span>
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={() => setSelected(new Set())}
              aria-label={t("files.clearSelection")}
              title={t("files.clearSelection")}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReloadTick((tick) => tick + 1)}>
            {t("common.retry")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="panel file-panel is-loading">
          <div className="skeleton-list">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
          </div>
        </div>
      ) : isEmpty ? (
        <div className="panel file-panel">
          <EmptyState
            icon={query ? "search" : "folder"}
            title={query ? t("files.emptySearch") : t("files.empty")}
            body={query ? t("files.emptySearchHint") : t("files.emptyHint")}
            action={
              query ? (
                <button type="button" className="btn btn-ghost" onClick={clearSearch}>
                  <Icon name="x" size={15} />
                  <span>{t("files.clearSearch")}</span>
                </button>
              ) : (
                <div className="empty-actions">
                  <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>
                    <Icon name="upload" size={16} />
                    <span>{t("files.upload")}</span>
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setFolderModal(true)}>
                    <Icon name="plus" size={16} />
                    <span>{t("files.newFolder")}</span>
                  </button>
                </div>
              )
            }
          />
        </div>
      ) : view === "grid" ? (
        <div className="file-grid">
          {items.map((entry) => (
            <article key={entry.id} className={cx("file-tile", selected.has(entry.id) && "is-selected")}>
              <div className="tile-top">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.id)}
                    onChange={() => toggleSelect(entry.id)}
                    aria-label={entry.name}
                  />
                  <span className="check-box" />
                </label>
                <FileGlyph name={entry.name} isDir={entry.is_dir} size={22} />
              </div>
              <button
                type="button"
                className="tile-name"
                onClick={() => (entry.is_dir ? openFolder(entry.id) : previewEntry(entry))}
                title={entry.name}
              >
                {entry.name}
              </button>
              <span className="tile-meta">
                {entry.is_dir ? t("common.folder") : formatBytes(entry.size, lang)} ·{" "}
                {formatDay(entry.updated_at, lang)}
              </span>
              <div className="tile-actions">
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => openShare(entry)}
                  title={t("files.share")}
                  aria-label={t("files.share")}
                >
                  <Icon name="link" size={15} />
                </button>
                {entry.is_dir ? (
                  <a
                    className="icon-btn icon-btn-sm"
                    href={`/api/files/${entry.id}/zip`}
                    title={t("files.downloadZip")}
                    aria-label={t("files.downloadZip")}
                  >
                    <Icon name="archive" size={15} />
                  </a>
                ) : (
                  <a
                    className="icon-btn icon-btn-sm"
                    href={`/api/files/${entry.id}/download`}
                    title={t("common.download")}
                    aria-label={t("common.download")}
                  >
                    <Icon name="download" size={15} />
                  </a>
                )}
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => {
                    setRenameTarget(entry);
                    setRenameValue(entry.name);
                  }}
                  title={t("common.rename")}
                  aria-label={t("common.rename")}
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => setDeleteTargets([entry])}
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel file-panel">
          <div className="file-row file-head" aria-hidden="true">
            <span className="file-check">
              <label className="check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={selectAll}
                  aria-label={t("files.selectAll")}
                />
                <span className="check-box" />
              </label>
            </span>
            <span className="file-name-cell">{t("common.name")}</span>
            <span className="file-size-cell">{t("common.size")}</span>
            <span className="file-type-cell">{t("common.type")}</span>
            <span className="file-date-cell">{t("common.modified")}</span>
            <span className="file-actions-cell">{t("common.actions")}</span>
          </div>

          {items.map((entry) => (
            <div key={entry.id} className={cx("file-row", selected.has(entry.id) && "is-selected")}>
              <span className="file-check">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.id)}
                    onChange={() => toggleSelect(entry.id)}
                    aria-label={entry.name}
                  />
                  <span className="check-box" />
                </label>
              </span>
              <button
                type="button"
                className="file-name-cell file-name-btn"
                onClick={() => (entry.is_dir ? openFolder(entry.id) : previewEntry(entry))}
              >
                <FileGlyph name={entry.name} isDir={entry.is_dir} />
                <span className="file-name-text" title={entry.name}>
                  {entry.name}
                </span>
              </button>
              <span className="file-size-cell tabular">
                {entry.is_dir ? "—" : formatBytes(entry.size, lang)}
              </span>
              <span className="file-type-cell">
                {entry.is_dir ? t("common.folder") : fileExtension(entry.name) || "—"}
              </span>
              <span className="file-date-cell">{formatDay(entry.updated_at, lang)}</span>
              <span className="file-actions-cell">
                {!entry.is_dir && entry.can_preview && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    onClick={() => previewEntry(entry)}
                    title={t("files.preview")}
                    aria-label={t("files.preview")}
                  >
                    <Icon name="eye" size={15} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => openShare(entry)}
                  title={t("files.share")}
                  aria-label={t("files.share")}
                >
                  <Icon name="link" size={15} />
                </button>
                {entry.is_dir ? (
                  <a
                    className="icon-btn icon-btn-sm"
                    href={`/api/files/${entry.id}/zip`}
                    title={t("files.downloadZip")}
                    aria-label={t("files.downloadZip")}
                  >
                    <Icon name="download" size={15} />
                  </a>
                ) : (
                  <a
                    className="icon-btn icon-btn-sm"
                    href={`/api/files/${entry.id}/download`}
                    title={t("common.download")}
                    aria-label={t("common.download")}
                  >
                    <Icon name="download" size={15} />
                  </a>
                )}
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => {
                    setRenameTarget(entry);
                    setRenameValue(entry.name);
                  }}
                  title={t("common.rename")}
                  aria-label={t("common.rename")}
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm icon-btn-danger"
                  onClick={() => setDeleteTargets([entry])}
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                >
                  <Icon name="trash" size={15} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length > 0 && (
        <p className="list-foot">
          <Icon name="upload" size={14} />
          <span>{t("files.uploadingNote")}</span>
        </p>
      )}

      {dragging && (
        <div className="drop-overlay" role="presentation">
          <div className="drop-card">
            <span className="drop-icon">
              <Icon name="upload" size={34} />
            </span>
            <h2>{t("files.dropHere")}</h2>
            <p>{t("files.dropHint")}</p>
          </div>
        </div>
      )}

      <Modal
        open={folderModal}
        onClose={() => setFolderModal(false)}
        title={t("files.newFolder")}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setFolderModal(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !folderName.trim()}
              onClick={() => void createFolder()}
            >
              {t("common.create")}
            </button>
          </>
        }
      >
        <Field label={t("files.folderName")} htmlFor="folder-name">
          <input
            id="folder-name"
            className="input"
            value={folderName}
            autoFocus
            maxLength={255}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createFolder();
            }}
          />
        </Field>
      </Modal>

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title={t("files.renameTitle")}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRenameTarget(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !renameValue.trim()}
              onClick={() => void submitRename()}
            >
              {t("common.save")}
            </button>
          </>
        }
      >
        <Field label={t("files.nameLabel")} htmlFor="rename-name">
          <input
            id="rename-name"
            className="input"
            value={renameValue}
            autoFocus
            maxLength={255}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitRename();
            }}
          />
        </Field>
      </Modal>

      <Modal
        open={deleteTargets.length > 0}
        onClose={() => setDeleteTargets([])}
        title={
          deleteTargets.length === 1
            ? t("files.deleteTitle", { name: deleteTargets[0]?.name ?? "" })
            : `${t("common.delete")} ${deleteTargets.length} ${t("common.items")}`
        }
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteTargets([])}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirmDelete()}>
              {t("common.delete")}
            </button>
          </>
        }
      >
        <p className="modal-text">
          {deleteTargets.length === 1 && deleteTargets[0]?.is_dir
            ? t("files.deleteFolder")
            : t("files.deleteFile")}
        </p>
      </Modal>

      <ShareDialog open={shareOpen} target={shareTarget} onClose={() => setShareOpen(false)} />
      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
