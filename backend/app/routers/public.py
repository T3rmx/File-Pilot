from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_db
from ..models import (
    Share,
    ShareEvent,
    ShareGrant,
    Transfer,
    User,
    remaining,
    share_status,
    utcnow,
)
from ..schemas import PublicFileOut, PublicShareOut, UnlockIn
from ..security import (
    DOWNLOAD_HEADERS,
    PREVIEW_CSP,
    client_ip,
    new_token,
    require_same_origin,
    token_digest,
    verify_password,
)
from ..services import (
    collect_share_entries,
    preview_allowed,
    relative_arcname,
)
from ..storage import path_for_key, zip_files

router = APIRouter(prefix="/api/public", tags=["public"])
GRANT_PREFIX = "fp_s_"
MAX_UNLOCK_ATTEMPTS = 10
UNLOCK_WINDOW = 15 * 60


def _share(db: Session, token: str) -> Share:
    share = db.query(Share).filter(Share.token_hash == token_digest(token)).first()
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link does not exist")
    return share


def _ensure_active(share: Share) -> None:
    state = share_status(share)
    if state == "revoked":
        raise HTTPException(status.HTTP_410_GONE, "This link was revoked")
    if state == "expired":
        raise HTTPException(status.HTTP_410_GONE, "This link has expired")
    if state == "exhausted":
        raise HTTPException(status.HTTP_410_GONE, "This link reached its download limit")


def _grant_valid(db: Session, share: Share, request: Request) -> bool:
    raw = request.cookies.get(f"{GRANT_PREFIX}{share.id}")
    if not raw:
        return False
    grant = (
        db.query(ShareGrant)
        .filter(
            ShareGrant.share_id == share.id,
            ShareGrant.token_hash == token_digest(raw),
            ShareGrant.expires_at > utcnow(),
        )
        .first()
    )
    return grant is not None


def _ensure_access(db: Session, share: Share, request: Request) -> None:
    _ensure_active(share)
    if not collect_share_entries(db, share):
        raise HTTPException(status.HTTP_410_GONE, "The shared content is no longer available")
    if share.password_hash and not _grant_valid(db, share, request):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Password required")


def _public_file(entry) -> PublicFileOut:
    return PublicFileOut(
        id=entry.id,
        name=entry.name,
        is_dir=entry.is_dir,
        size=entry.size,
        mime=entry.mime,
        can_preview=not entry.is_dir and preview_allowed(entry.name, entry.mime),
    )


@router.get("/{token}", response_model=PublicShareOut)
def public_info(token: str, request: Request, db: Session = Depends(get_db)) -> PublicShareOut:
    share = _share(db, token)
    _ensure_active(share)
    unlocked = _grant_valid(db, share, request)
    password_required = bool(share.password_hash) and not unlocked

    owner = db.get(User, share.owner_id)
    entries = collect_share_entries(db, share)
    files = [entry for entry in entries if not entry.is_dir]

    if not password_required and share.max_views is not None:
        result = db.execute(
            update(Share)
            .where(Share.id == share.id, Share.view_count < Share.max_views)
            .values(view_count=Share.view_count + 1)
        )
        if result.rowcount == 0:
            raise HTTPException(status.HTTP_410_GONE, "This link reached its view limit")

    if not password_required:
        db.add(
            ShareEvent(
                share_id=share.id,
                action="view",
                ip=client_ip(request),
                user_agent=request.headers.get("user-agent", "")[:255],
            )
        )

    if share.kind == "folder":
        root = entries[0] if entries else None
        display = [
            _public_file(entry) for entry in entries[1:] if not entry.is_dir
        ]
        label = share.label
        if root is not None:
            label = label or root.name
    else:
        display = [_public_file(entry) for entry in files]
        label = share.label

    return PublicShareOut(
        token=token,
        label=label,
        owner=owner.display_name or owner.username if owner else "FilePilot",
        kind=share.kind,
        status=share_status(share),
        password_required=password_required,
        unlocked=unlocked,
        expires_at=share.expires_at,
        downloads_left=remaining(share),
        items=[] if password_required else display,
        total_size=sum(item.size for item in display),
        zip_available=(not password_required) and share.kind != "file" and len(files) > 0,
    )


@router.post("/{token}/unlock")
def unlock(
    token: str,
    payload: UnlockIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    require_same_origin(request)
    share = _share(db, token)
    _ensure_active(share)
    if not share.password_hash:
        return {"ok": True}

    ip = client_ip(request)
    limiter = request.app.state.limiter
    allowed, retry = limiter.check(f"unlock:{ip}:{share.id}", MAX_UNLOCK_ATTEMPTS, UNLOCK_WINDOW)
    if not allowed:
        db.add(ShareEvent(share_id=share.id, action="unlock_rate_limited", ip=ip))
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts", {"Retry-After": str(retry)})

    if not verify_password(payload.password, share.password_hash):
        db.add(ShareEvent(share_id=share.id, action="unlock_failed", ip=ip))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect password")

    grant_token = new_token(32)
    minutes = request.app.state.settings.share_grant_minutes
    db.add(
        ShareGrant(
            share_id=share.id,
            token_hash=token_digest(grant_token),
            ip=ip,
            expires_at=utcnow() + timedelta(minutes=minutes),
        )
    )
    response.set_cookie(
        f"{GRANT_PREFIX}{share.id}",
        grant_token,
        max_age=minutes * 60,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/api/public",
    )
    db.add(ShareEvent(share_id=share.id, action="unlock", ip=ip))
    return {"ok": True}


def _share_entries_by_id(db: Session, share: Share) -> dict[str, object]:
    return {entry.id: entry for entry in collect_share_entries(db, share) if not entry.is_dir}


def _consume_download(db: Session, share: Share) -> None:
    if share.max_downloads is None:
        return
    result = db.execute(
        update(Share)
        .where(
            Share.id == share.id,
            Share.download_count < Share.max_downloads,
            Share.revoked_at.is_(None),
        )
        .values(download_count=Share.download_count + 1)
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_410_GONE, "This link reached its download limit")


@router.get("/{token}/files/{file_id}/download")
def public_download(
    token: str,
    file_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> FileResponse:
    share = _share(db, token)
    _ensure_access(db, share, request)
    entry = _share_entries_by_id(db, share).get(file_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not in this share")

    _consume_download(db, share)
    settings: Settings = request.app.state.settings
    path = path_for_key(settings, entry.storage_key or "")
    if not path.is_file():
        raise HTTPException(status.HTTP_410_GONE, "The stored file is missing")

    db.add(
        Transfer(
            share_id=share.id,
            direction="download",
            filename=entry.name,
            size=entry.size,
            status="completed",
            ip=client_ip(request),
            finished_at=utcnow(),
        )
    )
    db.add(ShareEvent(share_id=share.id, action="download", ip=client_ip(request)))
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=entry.name,
        content_disposition_type="attachment",
        headers=dict(DOWNLOAD_HEADERS),
    )


@router.get("/{token}/files/{file_id}/preview")
def public_preview(
    token: str,
    file_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> FileResponse:
    share = _share(db, token)
    _ensure_access(db, share, request)
    entry = _share_entries_by_id(db, share).get(file_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not in this share")
    if not preview_allowed(entry.name, entry.mime):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Preview not available")

    settings: Settings = request.app.state.settings
    path = path_for_key(settings, entry.storage_key or "")
    if not path.is_file():
        raise HTTPException(status.HTTP_410_GONE, "The stored file is missing")
    return FileResponse(
        path,
        media_type=entry.mime,
        filename=entry.name,
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": PREVIEW_CSP},
    )


@router.get("/{token}/zip")
def public_zip(
    token: str,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> FileResponse:
    share = _share(db, token)
    _ensure_access(db, share, request)
    if share.kind == "file":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This share is a single file")

    _consume_download(db, share)
    settings: Settings = request.app.state.settings
    entries = collect_share_entries(db, share)
    root = entries[0] if share.kind == "folder" and entries else None
    pairs: list[tuple[str, Path]] = []
    total = 0
    for entry in entries:
        if entry.is_dir:
            continue
        path = path_for_key(settings, entry.storage_key or "")
        if not path.is_file():
            continue
        arcname = relative_arcname(db, entry, root.id) if root else entry.name
        pairs.append((arcname, path))
        total += entry.size

    if not pairs:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing to download")
    archive = zip_files(settings, pairs)
    background.add_task(lambda: archive.unlink(missing_ok=True))
    db.add(
        Transfer(
            share_id=share.id,
            direction="download",
            filename=f"{share.label or 'share'}.zip",
            size=total,
            status="completed",
            ip=client_ip(request),
            finished_at=utcnow(),
        )
    )
    db.add(ShareEvent(share_id=share.id, action="download_zip", ip=client_ip(request)))
    return FileResponse(
        archive,
        media_type="application/zip",
        filename=f"{share.label or 'share'}.zip",
        content_disposition_type="attachment",
        headers=dict(DOWNLOAD_HEADERS),
    )
