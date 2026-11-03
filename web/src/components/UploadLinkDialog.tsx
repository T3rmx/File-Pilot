import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { Share } from "../lib/api";
import { formatDate } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { copyText, Field, Modal, useUI } from "../lib/ui";
import { Icon } from "./Icons";

const EXPIRY_OPTIONS = ["0", "60", "1440", "10080", "43200"] as const;

export function UploadLinkDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (share: Share) => void;
}) {
  const { t, lang } = useI18n();
  const { toast } = useUI();
  const [label, setLabel] = useState("");
  const [tokenMode, setTokenMode] = useState<"auto" | "custom">("auto");
  const [customToken, setCustomToken] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [expiry, setExpiry] = useState<string>("0");
  const [maxUploads, setMaxUploads] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Share | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setTokenMode("auto");
    setCustomToken("");
    setPassword("");
    setShowPassword(false);
    setExpiry("0");
    setMaxUploads("");
    setBusy(false);
    setError("");
    setResult(null);
    setQrOpen(false);
  }, [open]);

  const customTokenValid = /^[A-Za-z0-9_-]{8,64}$/.test(customToken.trim());
  const tokenValid = tokenMode === "auto" || customTokenValid;

  const create = async () => {
    if (!tokenValid) {
      setError(t("shares.tokenInvalid"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const share = await api.post<Share>("/api/shares/upload", {
        label: label.trim(),
        custom_token: tokenMode === "custom" ? customToken.trim() : null,
        password: password ? password : null,
        expires_in_minutes: expiry === "0" ? null : Number(expiry),
        max_uploads: maxUploads ? Number(maxUploads) : null,
      });
      setResult(share);
      onCreated?.(share);
      window.dispatchEvent(new CustomEvent("fp:shares-changed"));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    const ok = await copyText(result.url);
    toast(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : "error");
  };

  const expiryLabel = (value: string) => {
    switch (value) {
      case "60":
        return t("shares.expiry1h");
      case "1440":
        return t("shares.expiry24h");
      case "10080":
        return t("shares.expiry7d");
      case "43200":
        return t("shares.expiry30d");
      default:
        return t("shares.expiryNever");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={result ? t("upload.ready") : t("upload.dialogTitle")}
      subtitle={result ? t("upload.readyHint") : t("upload.dialogSubtitle")}
      footer={
        result ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("common.done")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !tokenValid}
              onClick={() => void create()}
            >
              {busy ? t("shares.creating") : t("upload.create")}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="share-result">
          <div className="share-link-row">
            <input
              className="input mono"
              value={result.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="icon-btn"
              title={t("shares.qr")}
              aria-label={t("shares.qr")}
              onClick={() => setQrOpen(true)}
            >
              <Icon name="qr" size={16} />
            </button>
            <button type="button" className="btn btn-primary btn-icon-text" onClick={() => void copy()}>
              <Icon name="copy" size={16} />
              <span>{t("shares.copyLink")}</span>
            </button>
          </div>

          <ul className="share-meta">
            <li>
              <Icon name="inbox" size={16} />
              <span>
                {result.uploads_left === null
                  ? t("upload.unlimited")
                  : t("upload.uploadsLeft", { n: result.uploads_left })}
              </span>
            </li>
            <li>
              <Icon name="lock" size={16} />
              <span>{result.password_protected ? t("shares.password") : t("shares.noPassword")}</span>
            </li>
            <li>
              <Icon name="clock" size={16} />
              <span>
                {result.expires_at
                  ? t("shares.expires", { when: formatDate(result.expires_at, lang) })
                  : t("common.never")}
              </span>
            </li>
          </ul>

          <a className="share-open-link" href={result.url} target="_blank" rel="noreferrer">
            <Icon name="external" size={15} />
            <span>{result.url}</span>
          </a>
        </div>
      ) : (
        <div className="form-stack">
          <Field label={t("upload.label")} hint={t("common.optional")} htmlFor="upload-label">
            <input
              id="upload-label"
              className="input"
              value={label}
              maxLength={160}
              placeholder={t("upload.labelPlaceholder")}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>

          <div className="field">
            <span className="field-label">{t("shares.tokenMode")}</span>
            <div className="segmented" role="group" aria-label={t("shares.tokenMode")}>
              <button
                type="button"
                className={`segment ${tokenMode === "auto" ? "is-active" : ""}`}
                onClick={() => setTokenMode("auto")}
              >
                {t("shares.tokenAuto")}
              </button>
              <button
                type="button"
                className={`segment ${tokenMode === "custom" ? "is-active" : ""}`}
                onClick={() => setTokenMode("custom")}
              >
                {t("shares.tokenCustom")}
              </button>
            </div>
            {tokenMode === "custom" && (
              <>
                <input
                  className="input mono"
                  value={customToken}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t("shares.tokenCustom")}
                  placeholder={t("shares.tokenPlaceholder")}
                  onChange={(event) => setCustomToken(event.target.value)}
                />
                <span className="field-hint">
                  {customToken && !customTokenValid ? t("shares.tokenInvalid") : t("shares.tokenHint")}
                </span>
              </>
            )}
          </div>

          <Field label={t("shares.passwordOptional")} htmlFor="upload-password">
            <span className="input-wrap">
              <input
                id="upload-password"
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                maxLength={256}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="input-trailing"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={t("common.preview")}
              >
                <Icon name="eye" size={16} />
              </button>
            </span>
          </Field>

          <div className="form-grid">
            <Field label={t("shares.expiry")} htmlFor="upload-expiry">
              <select
                id="upload-expiry"
                className="input"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {expiryLabel(option)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("upload.maxUploads")} htmlFor="upload-max">
              <input
                id="upload-max"
                className="input"
                type="number"
                min={1}
                max={100000}
                value={maxUploads}
                placeholder={t("upload.maxUploadsPlaceholder")}
                onChange={(event) => setMaxUploads(event.target.value)}
              />
            </Field>
          </div>

          <p className="form-hint">
            <Icon name="inbox" size={15} />
            <span>{t("upload.panelHint")}</span>
          </p>

          {error && (
            <p className="form-error">
              <Icon name="alert" size={15} />
              <span>{error}</span>
            </p>
          )}
        </div>
      )}

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={t("shares.qrTitle")}
        subtitle={result?.label}
        size="sm"
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setQrOpen(false)}>
            {t("common.close")}
          </button>
        }
      >
        {result ? (
          <div className="qr-panel">
            <div className="qr-frame" dangerouslySetInnerHTML={{ __html: result.qr_svg }} />
            <p className="qr-hint">{t("shares.copyQrHint")}</p>
          </div>
        ) : null}
      </Modal>
    </Modal>
  );
}
