from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..deps import current_user, get_db
from ..models import FileEntry, Share, ShareFile, User, expiry_from_now, share_status
from ..schemas import ShareIn, ShareListOut, ShareOut
from ..security import decrypt_text, encrypt_text, hash_password, new_token, token_digest
from ..services import collect_share_entries, log_audit, share_out

router = APIRouter(prefix="/api/shares", tags=["shares"])


def _resolve_entries(db: Session, user: User, payload: ShareIn) -> tuple[str, list[FileEntry], FileEntry | None]:
    if bool(payload.folder_id) == bool(payload.file_ids):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Choose either a folder or one or more files",
        )

    if payload.folder_id:
        folder = db.get(FileEntry, payload.folder_id)
        if folder is None or folder.deleted_at is not None or folder.owner_id != user.id or not folder.is_dir:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
        return "folder", [], folder

    entries: list[FileEntry] = []
    for file_id in dict.fromkeys(payload.file_ids):
        entry = db.get(FileEntry, file_id)
        if entry is None or entry.deleted_at is not None or entry.owner_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
        entries.append(entry)

    kind = "file" if len(entries) == 1 else "collection"
    return kind, entries, None


@router.post("", response_model=ShareOut, status_code=status.HTTP_201_CREATED)
def create_share(
    payload: ShareIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ShareOut:
    kind, entries, folder = _resolve_entries(db, user, payload)
    token = new_token(32)

    if kind == "file":
        label = payload.label.strip() or entries[0].name
    elif kind == "folder":
        label = payload.label.strip() or folder.name
    else:
        label = payload.label.strip() or f"{len(entries)} files"

    share = Share(
        owner_id=user.id,
        token_hash=token_digest(token),
        token_enc=encrypt_text(request.app.state.secret, token),
        kind=kind,
        target_id=folder.id if folder else (entries[0].id if kind == "file" else None),
        label=label[:160],
        password_hash=hash_password(payload.password) if payload.password else None,
        expires_at=expiry_from_now(payload.expires_in_minutes),
        max_downloads=payload.max_downloads,
        auto_delete=payload.auto_delete,
    )
    db.add(share)
    db.flush()

    if kind in {"file", "collection"}:
        for entry in entries:
            db.add(ShareFile(share_id=share.id, file_id=entry.id))

    log_audit(
        db,
        "share.created",
        actor_id=user.id,
        actor_name=user.username,
        target=label,
        request=request,
        meta={
            "kind": kind,
            "expires_at": share.expires_at.isoformat() if share.expires_at else None,
            "password": bool(share.password_hash),
            "max_downloads": share.max_downloads,
        },
    )
    return share_out(share, token, request, db)


@router.get("", response_model=ShareListOut)
def list_shares(
    request: Request,
    state: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ShareListOut:
    shares = (
        db.query(Share)
        .filter(Share.owner_id == user.id)
        .order_by(Share.created_at.desc())
        .limit(500)
        .all()
    )
    items: list[ShareOut] = []
    for share in shares:
        current = share_status(share)
        if state and state != current:
            continue
        try:
            token = decrypt_text(request.app.state.secret, share.token_enc)
        except Exception:
            token = ""
        items.append(share_out(share, token, request, db))
    return ShareListOut(items=items)


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_share(
    share_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> None:
    share = db.get(Share, share_id)
    if share is None or share.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share not found")
    if share.revoked_at is None:
        from ..models import utcnow

        share.revoked_at = utcnow()
        log_audit(
            db,
            "share.revoked",
            actor_id=user.id,
            actor_name=user.username,
            target=share.label,
            request=request,
        )


@router.get("/{share_id}/items")
def share_items(
    share_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    share = db.get(Share, share_id)
    if share is None or share.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share not found")
    entries = collect_share_entries(db, share)
    return {
        "items": [
            {"id": entry.id, "name": entry.name, "size": entry.size, "is_dir": entry.is_dir}
            for entry in entries
        ]
    }
