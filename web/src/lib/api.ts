export interface User {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "user" | string;
  quota_bytes: number | null;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  user: User;
}

export interface FileEntry {
  id: string;
  name: string;
  is_dir: boolean;
  size: number;
  mime: string;
  created_at: string;
  updated_at: string;
  can_preview: boolean;
}

export interface Breadcrumb {
  id: string | null;
  name: string;
}

export interface FileList {
  folder_id: string | null;
  breadcrumbs: Breadcrumb[];
  items: FileEntry[];
  total_size: number;
}

export interface Share {
  id: string;
  kind: "file" | "folder" | "collection" | "upload" | string;
  label: string;
  status: "active" | "expired" | "revoked" | "exhausted" | string;
  created_at: string;
  expires_at: string | null;
  max_downloads: number | null;
  download_count: number;
  downloads_left: number | null;
  max_uploads: number | null;
  upload_count: number;
  uploads_left: number | null;
  password_protected: boolean;
  url: string;
  qr_svg: string;
  item_count: number;
  total_size: number;
}

export interface Stats {
  files: number;
  folders: number;
  storage_used: number;
  quota_bytes: number | null;
  active_shares: number;
  expiring_soon: number;
  total_downloads: number;
  recent: { action: string; target: string; at: string }[];
}

export interface TransferItem {
  id: string;
  direction: "upload" | "download" | string;
  filename: string;
  size: number;
  status: string;
  ip: string;
  created_at: string;
}

export interface ServerSettings {
  site_name: string;
  allow_uploads: boolean;
  max_upload_mb: number;
  lan_discovery: boolean;
  lan_url: string;
  version: string;
}

export interface PublicFile {
  id: string;
  name: string;
  is_dir: boolean;
  size: number;
  mime: string;
  can_preview: boolean;
}

export interface PublicShare {
  token: string;
  label: string;
  owner: string;
  kind: string;
  status: string;
  password_required: boolean;
  unlocked: boolean;
  expires_at: string | null;
  downloads_left: number | null;
  uploads_left: number | null;
  items: PublicFile[];
  total_size: number;
  zip_available: boolean;
}

export interface AuditItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

function safeParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function detailOf(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown; loc?: unknown[] };
      if (first && typeof first.msg === "string") return first.msg;
    }
  }
  return fallback;
}

async function doRefresh(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      accessToken = null;
      return false;
    }
    const data = (await response.json()) as TokenResponse;
    accessToken = data.access_token;
    return true;
  } catch {
    accessToken = null;
    return false;
  }
}

/** Single-flight session refresh; also rotates the read-only media cookie. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let body: BodyInit | undefined;

  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(path, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    credentials: "same-origin",
  });

  if (response.status === 401 && retry && !path.startsWith("/api/auth/")) {
    const ok = await refreshSession();
    if (ok) return request<T>(path, options, false);
    window.dispatchEvent(new Event("fp:unauthorized"));
  }

  const text = await response.text();
  const data = safeParse(text);
  if (!response.ok) {
    throw new ApiError(response.status, detailOf(data, response.statusText || "Request failed"));
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  del: <T = null>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface UploadHandle<T = FileEntry> {
  promise: Promise<T>;
  abort: () => void;
}

export function uploadFile(
  file: File,
  folderId: string | null,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  let current: XMLHttpRequest | null = null;
  let cancelled = false;

  const run = (allowRetry: boolean): Promise<FileEntry> =>
    new Promise<FileEntry>((resolve, reject) => {
      if (cancelled) {
        reject(new ApiError(0, "Upload cancelled"));
        return;
      }
      const xhr = new XMLHttpRequest();
      current = xhr;
      xhr.open("POST", "/api/files/upload");
      xhr.responseType = "text";
      if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total || file.size);
      };
      xhr.onload = () => {
        const data = safeParse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(file.size, file.size);
          resolve(data as FileEntry);
          return;
        }
        if (xhr.status === 401 && allowRetry) {
          void refreshSession().then((ok) => {
            if (ok) run(false).then(resolve, reject);
            else reject(new ApiError(401, "Session expired"));
          });
          return;
        }
        reject(new ApiError(xhr.status, detailOf(data, xhr.statusText || "Upload failed")));
      };
      xhr.onerror = () => reject(new ApiError(0, "Network error while uploading"));
      xhr.onabort = () => reject(new ApiError(0, "Upload cancelled"));

      const form = new FormData();
      form.append("file", file, file.name);
      if (folderId) form.append("folder_id", folderId);
      xhr.send(form);
    });

  return {
    promise: run(true),
    abort: () => {
      cancelled = true;
      current?.abort();
    },
  };
}

export interface PublicUploadResult {
  ok: boolean;
  file_id: string;
  name: string;
  size: number;
}

/** Upload a single file through a public upload link (no account needed). */
export function uploadToShare(
  token: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle<PublicUploadResult> {
  let current: XMLHttpRequest | null = null;
  let cancelled = false;

  const promise = new Promise<PublicUploadResult>((resolve, reject) => {
    if (cancelled) {
      reject(new ApiError(0, "Upload cancelled"));
      return;
    }
    const xhr = new XMLHttpRequest();
    current = xhr;
    xhr.open("POST", `/api/public/${encodeURIComponent(token)}/upload`);
    xhr.responseType = "text";
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total || file.size);
    };
    xhr.onload = () => {
      const data = safeParse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size, file.size);
        resolve(data as PublicUploadResult);
        return;
      }
      if (xhr.status === 401) {
        reject(new ApiError(401, "This link needs a password"));
        return;
      }
      reject(new ApiError(xhr.status, detailOf(data, xhr.statusText || "Upload failed")));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error while uploading"));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled"));

    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });

  return {
    promise,
    abort: () => {
      cancelled = true;
      current?.abort();
    },
  };
}

export async function setupStatus(): Promise<boolean> {
  const data = await request<{ configured: boolean }>("/api/setup/status");
  return Boolean(data?.configured);
}

export async function wsTicket(): Promise<string> {
  const data = await request<{ ticket: string }>("/api/ws/ticket", { method: "POST" });
  return data.ticket;
}
