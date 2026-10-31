import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { ApiError, uploadFile } from "./api";
import { useI18n } from "./i18n";
import { Icon } from "../components/Icons";
import type { IconName } from "../components/Icons";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const localUploads = new Map<string, number>();

export function markLocalUpload(name: string): void {
  localUploads.set(name, Date.now());
}

export function isLocalUpload(name: string): boolean {
  const at = localUploads.get(name);
  if (!at) return false;
  if (Date.now() - at < 6000) return true;
  localUploads.delete(name);
  return false;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

type ToastKind = "info" | "success" | "error";

interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

type UploadStatus = "queued" | "uploading" | "done" | "error";

interface UploadTask {
  id: string;
  name: string;
  size: number;
  loaded: number;
  status: UploadStatus;
  error?: string;
}

interface UIContextValue {
  toast: (message: string, kind?: ToastKind) => void;
  queueUploads: (files: File[] | FileList, folderId: string | null) => Promise<void>;
  tasks: UploadTask[];
  clearFinished: () => void;
  cancelTask: (id: string) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const aborts = useRef(new Map<string, () => void>());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = uid();
      setToasts((current) => [...current.slice(-3), { id, message, kind }]);
      window.setTimeout(() => dismissToast(id), kind === "error" ? 8000 : 4500);
    },
    [dismissToast],
  );

  const updateTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((current) => current.filter((task) => task.status === "uploading" || task.status === "queued"));
  }, []);

  const cancelTask = useCallback((id: string) => {
    aborts.current.get(id)?.();
    aborts.current.delete(id);
    setTasks((current) => current.filter((task) => task.id !== id));
  }, []);

  const queueUploads = useCallback(
    async (input: File[] | FileList, folderId: string | null) => {
      const files = Array.from(input).filter((file) => file.size > 0);
      if (files.length === 0) return;

      const queued: UploadTask[] = files.map((file) => ({
        id: uid(),
        name: file.name,
        size: file.size,
        loaded: 0,
        status: "queued",
      }));
      setTasks((current) => [...current, ...queued]);

      for (let index = 0; index < files.length; index += 1) {
        const task = queued[index];
        const file = files[index];
        const handle = uploadFile(file, folderId, (loaded, total) => {
          updateTask(task.id, { loaded, size: total || task.size, status: "uploading" });
        });
        aborts.current.set(task.id, handle.abort);
        updateTask(task.id, { status: "uploading" });

        try {
          const saved = await handle.promise;
          markLocalUpload(saved.name);
          updateTask(task.id, { status: "done", loaded: task.size });
          toast(t("toast.uploaded", { name: saved.name }), "success");
          window.dispatchEvent(new CustomEvent("fp:files-changed"));
        } catch (error) {
          const message =
            error instanceof ApiError && error.detail
              ? error.detail
              : error instanceof Error && error.message
                ? error.message
                : t("toast.uploadFailed");
          if (message !== "Upload cancelled") {
            updateTask(task.id, { status: "error", error: message });
            toast(`${task.name}: ${message}`, "error");
          }
        } finally {
          aborts.current.delete(task.id);
        }
      }
    },
    [t, toast, updateTask],
  );

  const value = useMemo<UIContextValue>(
    () => ({ toast, queueUploads, tasks, clearFinished, cancelTask }),
    [toast, queueUploads, tasks, clearFinished, cancelTask],
  );

  return (
    <UIContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((item) => (
          <div key={item.id} className={cx("toast", `toast-${item.kind}`)}>
            <Icon
              name={item.kind === "error" ? "alert" : item.kind === "success" ? "checkCircle" : "info"}
              size={18}
            />
            <span>{item.message}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismissToast(item.id)}
              aria-label={t("common.close")}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      <TransferDock />
    </UIContext.Provider>
  );
}

export function useUI(): UIContextValue {
  const value = useContext(UIContext);
  if (!value) throw new Error("useUI must be used inside UIProvider");
  return value;
}

function TransferDock() {
  const { t } = useI18n();
  const { tasks, clearFinished, cancelTask } = useUI();
  const [minimised, setMinimised] = useState(false);

  if (tasks.length === 0) return null;

  const active = tasks.filter((task) => task.status === "uploading" || task.status === "queued").length;
  const finished = tasks.length - active;

  if (minimised) {
    return (
      <button
        type="button"
        className="dock-pill"
        onClick={() => setMinimised(false)}
        aria-label={t("dock.expand")}
      >
        <Icon name={active > 0 ? "upload" : "checkCircle"} size={16} />
        <span>{active > 0 ? t("dock.uploading") : t("dock.uploadedCount", { n: finished })}</span>
        {active > 0 && <span className="spinner spinner-sm" />}
      </button>
    );
  }

  return (
    <section className="dock" aria-label={t("dock.title")}>
      <header className="dock-head">
        <div className="dock-title">
          {active > 0 ? <span className="spinner spinner-sm" /> : <Icon name="checkCircle" size={16} />}
          <strong>{t("dock.title")}</strong>
          <span className="dock-count">{active > 0 ? active : tasks.length}</span>
        </div>
        <div className="dock-actions">
          {finished > 0 && (
            <button type="button" className="icon-btn icon-btn-sm" title={t("dock.clear")} onClick={clearFinished}>
              <Icon name="trash" size={15} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title={t("dock.minimize")}
            onClick={() => setMinimised(true)}
          >
            <Icon name="minus" size={15} />
          </button>
        </div>
      </header>
      <ul className="dock-list">
        {tasks.map((task) => {
          const percent = task.size > 0 ? Math.min(100, Math.round((task.loaded / task.size) * 100)) : 0;
          return (
            <li key={task.id} className={cx("dock-item", `is-${task.status}`)}>
              <div className="dock-file">
                <Icon
                  name={task.status === "error" ? "alert" : task.status === "done" ? "checkCircle" : "file"}
                  size={16}
                />
                <span className="dock-name" title={task.name}>
                  {task.name}
                </span>
                <span className="dock-state">
                  {task.status === "done"
                    ? t("dock.done")
                    : task.status === "error"
                      ? t("dock.failed")
                      : `${percent}%`}
                </span>
                {(task.status === "uploading" || task.status === "queued") && (
                  <button
                    type="button"
                    className="dock-cancel"
                    onClick={() => cancelTask(task.id)}
                    aria-label={t("dock.cancel")}
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
              <div className="progress-track">
                <div
                  className={cx("progress-fill", task.status === "error" && "is-error")}
                  style={{ inlineSize: `${task.status === "done" ? 100 : percent}%` }}
                />
              </div>
              {task.error && <p className="dock-error">{task.error}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "danger";
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <div
        className={cx("modal", `modal-${size}`)}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="loading-block" role="status">
      <span className="spinner" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cx("toggle-row", disabled && "is-disabled")}>
      <span className="toggle-copy">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="toggle-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx("segment", value === option.value && "is-active")}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size={15} />}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="stat-card is-skeleton" aria-hidden="true">
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-value" />
    </div>
  );
}
