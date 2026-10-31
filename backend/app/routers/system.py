from __future__ import annotations

import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import __version__
from ..config import Settings
from ..deps import admin_user, current_user, get_db
from ..models import AuditLog, FileEntry, Share, Transfer, User, share_status, utcnow
from ..schemas import SettingsIn, SettingsOut, StatsOut
from ..services import get_bool_setting, get_setting, lan_ip_address, log_audit, set_setting

router = APIRouter(prefix="/api", tags=["system"])


def lan_ip() -> str:
    """Best-effort primary LAN address (no packets are sent for a UDP connect)."""
    return lan_ip_address()


@router.get("/health")
def health() -> dict:
    return {"ok": True, "version": __version__}


@router.get("/stats", response_model=StatsOut)
def stats(db: Session = Depends(get_db), user: User = Depends(current_user)) -> StatsOut:
    base = db.query(FileEntry).filter(FileEntry.owner_id == user.id, FileEntry.deleted_at.is_(None))
    files = base.filter(FileEntry.is_dir.is_(False)).count()
    folders = base.filter(FileEntry.is_dir.is_(True)).count()
    used = (
        db.query(func.coalesce(func.sum(FileEntry.size), 0))
        .filter(FileEntry.owner_id == user.id, FileEntry.deleted_at.is_(None))
        .scalar()
        or 0
    )
    shares = db.query(Share).filter(Share.owner_id == user.id).all()
    active = sum(1 for share in shares if share_status(share) == "active")
    soon_cutoff = utcnow() + timedelta(days=1)
    expiring = sum(
        1
        for share in shares
        if share_status(share) == "active"
        and share.expires_at is not None
        and share.expires_at <= soon_cutoff
    )
    downloads = (
        db.query(func.count(Transfer.id))
        .filter(Transfer.user_id == user.id, Transfer.direction == "download")
        .scalar()
        or 0
    )
    recent_rows = (
        db.query(AuditLog)
        .filter((AuditLog.actor_id == user.id) | (AuditLog.actor_id.is_(None)))
        .order_by(AuditLog.created_at.desc())
        .limit(8)
        .all()
    )
    recent = [
        {
            "action": row.action,
            "target": row.target,
            "at": row.created_at.isoformat() + "Z",
        }
        for row in recent_rows
    ]
    return StatsOut(
        files=files,
        folders=folders,
        storage_used=int(used),
        quota_bytes=user.quota_bytes,
        active_shares=active,
        expiring_soon=expiring,
        total_downloads=int(downloads),
        recent=recent,
    )


@router.get("/transfers")
def transfers(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    limit = max(1, min(limit, 200))
    rows = (
        db.query(Transfer)
        .filter((Transfer.user_id == user.id) | (Transfer.share_id.is_not(None)))
        .order_by(Transfer.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "direction": row.direction,
                "filename": row.filename,
                "size": row.size,
                "status": row.status,
                "ip": row.ip,
                "created_at": row.created_at.isoformat() + "Z",
            }
            for row in rows
        ]
    }


@router.get("/audit")
def audit(
    limit: int = 100,
    db: Session = Depends(get_db),
    user: User = Depends(admin_user),
) -> dict:
    limit = max(1, min(limit, 500))
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    return {
        "items": [
            {
                "id": row.id,
                "actor": row.actor_name or "system",
                "action": row.action,
                "target": row.target,
                "ip": row.ip,
                "meta": json.loads(row.meta or "{}"),
                "created_at": row.created_at.isoformat() + "Z",
            }
            for row in rows
        ]
    }


def _settings_out(request: Request, db: Session) -> SettingsOut:
    settings: Settings = request.app.state.settings
    scheme = request.url.scheme
    return SettingsOut(
        site_name=get_setting(db, "site_name", "FilePilot"),
        allow_uploads=get_bool_setting(db, "allow_uploads", True),
        max_upload_mb=int(get_setting(db, "max_upload_mb", str(settings.max_upload_bytes // (1024 * 1024)))),
        lan_discovery=get_bool_setting(db, "lan_discovery", True),
        lan_url=f"{scheme}://{lan_ip()}:{settings.port}",
        version=__version__,
    )


@router.get("/settings", response_model=SettingsOut)
def read_settings(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(admin_user),
) -> SettingsOut:
    return _settings_out(request, db)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(
    payload: SettingsIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(admin_user),
) -> SettingsOut:
    settings: Settings = request.app.state.settings
    if payload.site_name is not None:
        name = payload.site_name.strip()[:80]
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Site name cannot be empty")
        set_setting(db, "site_name", name)
    if payload.allow_uploads is not None:
        set_setting(db, "allow_uploads", "1" if payload.allow_uploads else "0")
    if payload.max_upload_mb is not None:
        capped = min(payload.max_upload_mb, settings.max_upload_bytes // (1024 * 1024))
        set_setting(db, "max_upload_mb", str(capped))
    if payload.lan_discovery is not None:
        set_setting(db, "lan_discovery", "1" if payload.lan_discovery else "0")
    log_audit(db, "settings.updated", actor_id=user.id, actor_name=user.username, request=request)
    return _settings_out(request, db)
