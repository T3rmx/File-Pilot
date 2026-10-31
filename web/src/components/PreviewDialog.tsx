import { useI18n } from "../lib/i18n";
import { Modal } from "../lib/ui";
import { Icon } from "./Icons";

export interface PreviewTarget {
  name: string;
  mime: string;
  src: string | null;
  downloadHref: string;
}

export function PreviewDialog({
  target,
  onClose,
}: {
  target: PreviewTarget | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mime = target?.mime ?? "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const src = target?.src ?? null;

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      size="lg"
      title={target?.name ?? t("common.preview")}
      footer={
        <a className="btn btn-primary" href={target?.downloadHref ?? "#"} download={target?.name}>
          <Icon name="download" size={16} />
          <span>{t("common.download")}</span>
        </a>
      }
    >
      {!target ? null : isImage && src ? (
        <div className="preview-stage">
          <img className="preview-image" src={src} alt={target.name} />
        </div>
      ) : isVideo && src ? (
        <div className="preview-stage">
          <video className="preview-video" src={src} controls autoPlay playsInline />
        </div>
      ) : isAudio && src ? (
        <div className="preview-stage preview-audio">
          <Icon name="music" size={44} />
          <audio src={src} controls autoPlay />
        </div>
      ) : (
        <div className="preview-fallback">
          <span className="empty-icon">
            <Icon name="eye" size={26} />
          </span>
          <p>{t("files.noPreview")}</p>
          <a className="btn btn-ghost" href={src ?? target.downloadHref} target="_blank" rel="noreferrer">
            <Icon name="external" size={15} />
            <span>{t("files.openTab")}</span>
          </a>
        </div>
      )}
    </Modal>
  );
}
