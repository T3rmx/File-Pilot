from __future__ import annotations

import io
import json
import mimetypes
from urllib.parse import urlparse

import segno
from fastapi import Request
from sqlalchemy.orm import Session

from .config import Settings
from .models import AuditLog, FileEntry, Setting, Share, ShareFile, utcnow
from .schemas import FileOut, ShareOut
from .security import file_extension, sanitize_filename

PREVIEW_MIME_PREFIXES = ("image/", "video/", "audio/")
PREVIEW_MIME_EXACT = {"application/pdf"}
BLOCKED_PREVIEW_EXT = {".svg", ".svgz", ".html", ".htm", ".xhtml", ".xml", ".js", ".mjs"}


def lan_ip_address() -> str:
    """Best-effort primary LAN address (no packets are sent; UDP connect probe)."""
    import socket

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.2)
        sock.connect(("8.8.8.8", 80))
        address = sock.getsockname()[0]
        sock.close()
        return address
    except OSError:
        return "127.0.0.1"


def _is_loopback(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "localhost" or host == "::1" or host.startswith("127.") or host == "0.0.0.0"



def log_audit(
    db: Session,
    action: str,
    *,
    actor_id: str | None = None,
    actor_name: str = "",
    target: str = "",
    request: Request | None = None,
    meta: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            actor_name=actor_name,
            action=action,
            target=target[:255],
            ip=request.client.host if request and request.client else "",
            meta=json.dumps(meta or {}, ensure_ascii=False),
        )
    )


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    return row.value if row else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def get_bool_setting(db: Session, key: str, default: bool) -> bool:
    raw = get_setting(db, key, "1" if default else "0")
    return raw == "1"


def is_configured(db: Session) -> bool:
    from .models import User

    return db.query(User.id).first() is not None


def preview_allowed(name: str, mime: str) -> bool:
    if file_extension(name) in BLOCKED_PREVIEW_EXT:
        return False
    return mime in PREVIEW_MIME_EXACT or mime.startswith(PREVIEW_MIME_PREFIXES)


def guess_mime(name: str) -> str:
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def file_out(entry: FileEntry) -> FileOut:
    return FileOut(
        id=entry.id,
        name=entry.name,
        is_dir=entry.is_dir,
        size=entry.size,
        mime=entry.mime,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        can_preview=not entry.is_dir and preview_allowed(entry.name, entry.mime),
    )


def breadcrumbs(db: Session, folder: FileEntry | None) -> list[dict]:
    chain: list[dict] = []
    seen: set[str] = set()
    node = folder
    while node is not None and node.id not in seen:
        seen.add(node.id)
        chain.append({"id": node.id, "name": node.name})
        node = db.get(FileEntry, node.parent_id) if node.parent_id else None
    chain.reverse()
    return [{"id": None, "name": "Home"}, *chain]


def descendants(db: Session, root: FileEntry) -> list[FileEntry]:
    """Depth-first list of all live children under a folder."""
    result: list[FileEntry] = []
    stack = [root]
    seen: set[str] = set()
    while stack:
        node = stack.pop()
        if node.id in seen:
            continue
        seen.add(node.id)
        children = (
            db.query(FileEntry)
            .filter(FileEntry.parent_id == node.id, FileEntry.deleted_at.is_(None))
            .all()
        )
        for child in children:
            result.append(child)
            if child.is_dir:
                stack.append(child)
    return result


def collect_share_entries(db: Session, share: Share) -> list[FileEntry]:
    if share.kind == "file":
        entry = db.get(FileEntry, share.target_id) if share.target_id else None
        if entry is None:
            link = db.query(ShareFile).filter(ShareFile.share_id == share.id).first()
            entry = db.get(FileEntry, link.file_id) if link else None
        return [entry] if entry and entry.deleted_at is None else []

    if share.kind == "folder":
        folder = db.get(FileEntry, share.target_id) if share.target_id else None
        if folder is None or folder.deleted_at is not None:
            return []
        return [folder, *descendants(db, folder)]

    links = db.query(ShareFile).filter(ShareFile.share_id == share.id).all()
    entries = [db.get(FileEntry, link.file_id) for link in links]
    return [entry for entry in entries if entry and entry.deleted_at is None]


def qr_svg(url: str) -> str:
    qr = segno.make(url, error="m")
    buffer = io.BytesIO()
    qr.save(buffer, kind="svg", scale=5, border=2, dark="#0b0d0f", light="#ffffff")
    svg = buffer.getvalue().decode("utf-8")
    # Inline SVG must not carry the XML declaration when injected into HTML.
    return svg.split("?>", 1)[-1].lstrip() if svg.startswith("<?xml") else svg


def public_base(request: Request, settings: Settings | None = None) -> str:
    """Base URL used for share links.

    Share links must be openable from other devices, so when the request came in
    on loopback we rewrite the host to the machine's LAN address instead of
    handing out an address phones cannot reach.
    """
    base = str(request.base_url).rstrip("/")
    if _is_loopback(base):
        resolved = settings or request.app.state.settings
        scheme = "https" if (resolved.tls or "off") != "off" else "http"
        return f"{scheme}://{lan_ip_address()}:{resolved.port}"
    return base


def share_out(share: Share, token: str, request: Request, db: Session) -> ShareOut:
    from .models import remaining, share_status

    entries = collect_share_entries(db, share)
    files = [entry for entry in entries if not entry.is_dir]
    size = sum(entry.size for entry in files)
    url = f"{public_base(request, request.app.state.settings)}/s/{token}"
    return ShareOut(
        id=share.id,
        kind=share.kind,
        label=share.label,
        status=share_status(share),
        created_at=share.created_at,
        expires_at=share.expires_at,
        max_downloads=share.max_downloads,
        download_count=share.download_count,
        downloads_left=remaining(share),
        password_protected=bool(share.password_hash),
        url=url,
        qr_svg=qr_svg(url),
        item_count=len(files),
        total_size=size,
    )


def prune_expired_grants(db: Session) -> None:
    from .models import ShareGrant

    db.query(ShareGrant).filter(ShareGrant.expires_at < utcnow()).delete(synchronize_session=False)


def relative_arcname(db: Session, entry: FileEntry, root_id: str) -> str:
    """Path of an entry relative to a shared folder, for display and ZIP entries."""
    parts = [entry.name]
    parent_id = entry.parent_id
    seen: set[str] = set()
    while parent_id and parent_id != root_id and parent_id not in seen:
        seen.add(parent_id)
        parent = db.get(FileEntry, parent_id)
        if parent is None:
            break
        parts.append(parent.name)
        parent_id = parent.parent_id
    return "/".join(reversed(parts))


def import_legacy_files(settings, db: Session, owner) -> int:
    """One-time import of the old Flask app's shared/ folder."""
    from pathlib import Path

    from .storage import import_file

    repo_root = Path(__file__).resolve().parents[2]
    legacy = repo_root / "shared"
    if not legacy.is_dir():
        return 0
    if db.query(FileEntry.id).filter(FileEntry.owner_id == owner.id).first():
        return 0

    sources = [
        path
        for path in sorted(legacy.rglob("*"))
        if path.is_file() and not path.is_symlink() and not path.name.startswith(".")
    ][:500]
    if not sources:
        return 0

    root = FileEntry(owner_id=owner.id, name="Imported", is_dir=True)
    db.add(root)
    db.flush()

    imported = 0
    total = 0
    for source in sources:
        if total >= 2 * 1024**3:
            break
        try:
            key, size, digest = import_file(settings, source)
        except OSError:
            continue
        db.add(
            FileEntry(
                owner_id=owner.id,
                parent_id=root.id,
                name=sanitize_filename(source.name),
                is_dir=False,
                storage_key=key,
                size=size,
                mime=guess_mime(source.name),
                sha256=digest,
            )
        )
        total += size
        imported += 1
    return imported


def cleanup_once(settings, db: Session) -> None:
    from .models import AuthSession, ShareGrant
    from .storage import delete_key

    now = utcnow()
    expired = db.query(Share).filter(Share.expires_at.is_not(None), Share.expires_at <= now).all()
    for share in expired:
        if share.auto_delete:
            for entry in collect_share_entries(db, share):
                if entry.is_dir:
                    continue
                delete_key(settings, entry.storage_key)
                entry.deleted_at = now
            share.revoked_at = share.revoked_at or now

    db.query(ShareGrant).filter(ShareGrant.expires_at <= now).delete(synchronize_session=False)
    db.query(AuthSession).filter(AuthSession.refresh_expires_at <= now).delete(synchronize_session=False)

    import time

    cutoff = time.time() - 24 * 3600
    for leftover in settings.tmp_dir.glob("*"):
        try:
            if leftover.is_file() and leftover.stat().st_mtime < cutoff:
                leftover.unlink(missing_ok=True)
        except OSError:
            pass
