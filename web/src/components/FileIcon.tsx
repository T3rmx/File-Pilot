import { cx } from "../lib/ui";
import { fileKind } from "../lib/format";
import type { FileKind } from "../lib/format";
import { Icon } from "./Icons";
import type { IconName } from "./Icons";

const ICONS: Record<FileKind, IconName> = {
  folder: "folder",
  image: "image",
  video: "video",
  audio: "music",
  pdf: "fileText",
  document: "fileText",
  sheet: "grid",
  archive: "archive",
  code: "code",
  text: "text",
  other: "file",
};

export function FileGlyph({
  name,
  isDir = false,
  size = 18,
}: {
  name: string;
  isDir?: boolean;
  size?: number;
}) {
  const kind = fileKind(name, isDir);
  return (
    <span className={cx("file-glyph", `kind-${kind}`)} aria-hidden="true">
      <Icon name={ICONS[kind]} size={size} />
    </span>
  );
}
