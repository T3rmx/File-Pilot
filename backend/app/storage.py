from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from collections.abc import Iterable
from hashlib import sha256
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from .config import Settings
from .security import sanitize_filename, unique_filename

CHUNK = 1024 * 1024


class QuotaExceeded(HTTPException):
    def __init__(self, message: str = "Not enough storage space") -> None:
        super().__init__(status.HTTP_507_INSUFFICIENT_STORAGE, message)


def new_storage_key() -> str:
    import uuid

    raw = uuid.uuid4().hex
    return f"{raw[:2]}/{raw[2:4]}/{raw}"


def path_for_key(settings: Settings, storage_key: str) -> Path:
    """Storage keys are generated, but containment is still enforced defensively."""
    if not storage_key or ".." in storage_key or storage_key.startswith("/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid storage key")
    root = settings.storage_dir.resolve(strict=True)
    target = (root / storage_key).resolve(strict=False)
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid storage key") from exc
    return target


def save_stream(settings: Settings, upload: UploadFile, max_bytes: int) -> tuple[str, int, str]:
    """Stream to a temp file, hash while writing, then atomically move into storage."""
    settings.ensure_dirs()
    key = new_storage_key()
    final_path = path_for_key(settings, key)
    final_path.parent.mkdir(parents=True, exist_ok=True)

    digest = sha256()
    size = 0
    fd, tmp_name = tempfile.mkstemp(dir=settings.tmp_dir, prefix="upload-")
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = upload.file.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"File exceeds the {max_bytes // (1024 * 1024)} MB limit",
                    )
                digest.update(chunk)
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        if size == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty files are not allowed")
        os.replace(tmp_path, final_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    return key, size, digest.hexdigest()


def import_file(settings: Settings, source: Path) -> tuple[str, int, str]:
    """Copy a file that already exists on this machine into managed storage."""
    key = new_storage_key()
    dest = path_for_key(settings, key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    digest = sha256()
    size = 0
    with source.open("rb") as src, dest.open("wb") as out:
        while chunk := src.read(CHUNK):
            size += len(chunk)
            digest.update(chunk)
            out.write(chunk)
    return key, size, digest.hexdigest()


def delete_key(settings: Settings, storage_key: str | None) -> None:
    if not storage_key:
        return
    try:
        path_for_key(settings, storage_key).unlink(missing_ok=True)
    except HTTPException:
        return


def zip_files(settings: Settings, entries: Iterable[tuple[str, Path]]) -> Path:
    """Create a ZIP in a private temp file. Never /tmp/<predictable>.zip."""
    settings.ensure_dirs()
    fd, name = tempfile.mkstemp(dir=settings.tmp_dir, prefix="share-", suffix=".zip")
    os.close(fd)
    dest = Path(name)
    used: set[str] = set()
    try:
        with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for arcname, source in entries:
                if not source.is_file():
                    continue
                safe = unique_filename(used, sanitize_filename(arcname, "file"))
                used.add(safe)
                archive.write(source, arcname=safe)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    return dest


def free_bytes(path: Path) -> int:
    usage = shutil.disk_usage(path)
    return usage.free
