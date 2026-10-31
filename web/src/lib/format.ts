export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBytes(bytes: number, lang = "en"): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  const digits = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const formatted = new Intl.NumberFormat(lang === "ar" ? "ar" : "en", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
  return `${formatted} ${units[exponent]}`;
}

export function formatDate(value: string | null | undefined, lang = "en"): string {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(value: string | null | undefined, lang = "en"): string {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function timeAgo(value: string | null | undefined, lang = "en"): string {
  const date = parseDate(value);
  if (!date) return "—";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];
  const formatter = new Intl.RelativeTimeFormat(lang === "ar" ? "ar" : "en", { numeric: "auto" });
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return "—";
}

export function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  if (index <= 0) return "";
  return name.slice(index + 1).toUpperCase();
}

export type FileKind =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "sheet"
  | "archive"
  | "code"
  | "text"
  | "other";

const KIND_BY_EXT: Record<string, FileKind> = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", avif: "image",
  bmp: "image", heic: "image", tiff: "image", svg: "image",
  mp4: "video", webm: "video", mkv: "video", mov: "video", avi: "video", m4v: "video",
  mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio", aac: "audio",
  pdf: "pdf",
  doc: "document", docx: "document", odt: "document", rtf: "document", pages: "document",
  xls: "sheet", xlsx: "sheet", ods: "sheet", csv: "sheet", numbers: "sheet",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  bz2: "archive", xz: "archive", iso: "archive",
  js: "code", jsx: "code", ts: "code", tsx: "code", py: "code", rb: "code", go: "code",
  rs: "code", java: "code", c: "code", h: "code", cpp: "code", cs: "code", php: "code",
  sh: "code", json: "code", yaml: "code", yml: "code", toml: "code", html: "code",
  css: "code", scss: "code", sql: "code", xml: "code",
  txt: "text", md: "text", log: "text", ini: "text", conf: "text", env: "text",
};

export function fileKind(name: string, isDir = false): FileKind {
  if (isDir) return "folder";
  return KIND_BY_EXT[fileExtension(name).toLowerCase()] ?? "other";
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "FP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function truncateMiddle(value: string, max = 42): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 3) / 2);
  const tail = Math.max(1, max - 3 - head);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
