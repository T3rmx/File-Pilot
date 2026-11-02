from __future__ import annotations

from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import current_user, get_db, media_user, write_user
from ..models import FileEntry, Transfer, User, utcnow
from ..schemas import Breadcrumb, FileListOut, FileOut, FolderIn, RenameIn
from ..security import (
    DOWNLOAD_HEADERS,
    PREVIEW_CSP,
    sanitize_filename,
    unique_filename,
)
from ..services import (
    breadcrumbs,
    descendants,
    file_out,
    get_setting,
    guess_mime,
    log_audit,
    preview_allowed,
)
from ..storage import delete_key, path_for_key, save_stream, zip_files

router = APIRouter(prefix="/api/files", tags=["files"])
MB = 1024 * 1024


def _owned(db: Session, user: User, file_id: str, *, allow_dir: bool = True) -> FileEntry:
    entry = db.get(FileEntry, file_id)
    if entry is None or entry.deleted_at is not None or entry.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    if not allow_dir and entry.is_dir:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This action needs a file")
    return entry


def _used_bytes(db: Session, user_id: str) -> int:
    value = (
        db.query(func.coalesce(func.sum(FileEntry.size), 0))
        .filter(FileEntry.owner_id == user_id, FileEntry.deleted_at.is_(None))
        .scalar()
    )
    return int(value or 0)


def _parent(db: Session, user: User, parent_id: str | None) -> FileEntry | None:
    if not parent_id:
        return None
    parent = _owned(db, user, parent_id)
    if not parent.is_dir:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Target is not a folder")
    return parent


def _child_names(db: Session, user: User, parent_id: str | None) -> set[str]:
    rows = (
        db.query(FileEntry.name)
        .filter(
            FileEntry.owner_id == user.id,
            FileEntry.parent_id.is_(parent_id),
            FileEntry.deleted_at.is_(None),
        )
        .all()
    )
    return {row[0] for row in rows}


@router.get("", response_model=FileListOut)
def list_files(
    folder_id: str | None = None,
    search: str = "",
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> FileListOut:
    search = search.strip()[:120]
    if search:
        pattern = f"%{search}%"
        rows = (
            db.query(FileEntry)
            .filter(
                FileEntry.owner_id == user.id,
                FileEntry.deleted_at.is_(None),
                or_(FileEntry.name.ilike(pattern), FileEntry.mime.ilike(pattern)),
            )
            .order_by(FileEntry.is_dir.desc(), FileEntry.name)
            .limit(300)
            .all()
        )
        return FileListOut(
            folder_id=None,
            breadcrumbs=[Breadcrumb(id=None, name="Home"), Breadcrumb(id=None, name=f"Search: {search}")],
            items=[file_out(entry) for entry in rows],
            total_size=sum(entry.size for entry in rows),
        )

    folder = _parent(db, user, folder_id)
    rows = (
        db.query(FileEntry)
        .filter(
            FileEntry.owner_id == user.id,
            FileEntry.parent_id.is_(folder.id if folder else None),
            FileEntry.deleted_at.is_(None),
        )
        .order_by(FileEntry.is_dir.desc(), FileEntry.name)
        .all()
    )
    return FileListOut(
        folder_id=folder.id if folder else None,
        breadcrumbs=[Breadcrumb(**item) for item in breadcrumbs(db, folder)],
        items=[file_out(entry) for entry in rows],
        total_size=sum(entry.size for entry in rows),
    )


@router.post("/folder", response_model=FileOut, status_code=status.HTTP_201_CREATED)
def create_folder(
    payload: FolderIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(write_user),
) -> FileOut:
    parent = _parent(db, user, payload.parent_id)
    name = sanitize_filename(payload.name, "New folder")
    name = unique_filename(_child_names(db, user, parent.id if parent else None), name)
    entry = FileEntry(owner_id=user.id, parent_id=parent.id if parent else None, name=name, is_dir=True)
    db.add(entry)
    db.flush()
    log_audit(db, "folder.created", actor_id=user.id, actor_name=user.username, target=name, request=request)
    return file_out(entry)


@router.post("/upload", response_model=FileOut, status_code=status.HTTP_201_CREATED)
async def upload(
    request: Request,
    file: UploadFile = File(...),
    folder_id: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(write_user),
) -> FileOut:
    settings: Settings = request.app.state.settings
    if get_setting(db, "allow_uploads", "1") != "1":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Uploads are disabled by the administrator")

    parent = _parent(db, user, folder_id)
    max_mb = int(get_setting(db, "max_upload_mb", str(settings.max_upload_bytes // MB)))
    max_bytes = min(max_mb * MB, settings.max_upload_bytes)

    name = sanitize_filename(file.filename or "file")
    name = unique_filename(_child_names(db, user, parent.id if parent else None), name)
    mime = guess_mime(name)

    if user.quota_bytes is not None:
        declared = getattr(file, "size", None) or 0
        if _used_bytes(db, user.id) + declared > user.quota_bytes:
            raise HTTPException(status.HTTP_507_INSUFFICIENT_STORAGE, "Storage quota exceeded")

    key, size, digest = save_stream(settings, file, max_bytes)
    await file.close()

    if user.quota_bytes is not None and _used_bytes(db, user.id) + size > user.quota_bytes:
        delete_key(settings, key)
        raise HTTPException(status.HTTP_507_INSUFFICIENT_STORAGE, "Storage quota exceeded")

    entry = FileEntry(
        owner_id=user.id,
        parent_id=parent.id if parent else None,
        name=name,
        is_dir=False,
        storage_key=key,
        size=size,
        mime=mime,
        sha256=digest,
    )
    db.add(entry)
    db.add(
        Transfer(
            user_id=user.id,
            direction="upload",
            filename=name,
            size=size,
            status="completed",
            ip=request.client.host if request.client else "",
            finished_at=utcnow(),
        )
    )
    db.flush()
    log_audit(db, "file.uploaded", actor_id=user.id, actor_name=user.username, target=name, request=request, meta={"size": size})
    await request.app.state.ws.broadcast_user(
        user.id, {"type": "file.uploaded", "name": name, "size": size}
    )
    return file_out(entry)


@router.patch("/{file_id}", response_model=FileOut)
def rename(
    file_id: str,
    payload: RenameIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(write_user),
) -> FileOut:
    entry = _owned(db, user, file_id)
    name = sanitize_filename(payload.name, entry.name)
    name = unique_filename(
        _child_names(db, user, entry.parent_id) - {entry.name}, name
    )
    entry.name = name
    entry.updated_at = utcnow()
    if not entry.is_dir:
        entry.mime = guess_mime(name)
    log_audit(db, "file.renamed", actor_id=user.id, actor_name=user.username, target=name, request=request)
    return file_out(entry)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove(
    file_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(write_user),
) -> None:
    entry = _owned(db, user, file_id)
    settings: Settings = request.app.state.settings
    targets = [entry, *descendants(db, entry)] if entry.is_dir else [entry]
    now = utcnow()
    for target in targets:
        target.deleted_at = now
        delete_key(settings, target.storage_key)
    log_audit(
        db,
        "file.deleted",
        actor_id=user.id,
        actor_name=user.username,
        target=entry.name,
        request=request,
        meta={"items": len(targets)},
    )


def _download_response(entry: FileEntry, settings: Settings, *, inline: bool = False) -> FileResponse:
    path = path_for_key(settings, entry.storage_key or "")
    if not path.is_file():
        raise HTTPException(status.HTTP_410_GONE, "The stored file is missing")
    media_type = entry.mime if inline and preview_allowed(entry.name, entry.mime) else "application/octet-stream"
    headers = {"Content-Security-Policy": PREVIEW_CSP} if inline else dict(DOWNLOAD_HEADERS)
    return FileResponse(
        path,
        media_type=media_type,
        filename=entry.name,
        content_disposition_type="inline" if inline else "attachment",
        headers=headers,
    )


@router.get("/{file_id}/download")
def download(
    file_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(media_user),
) -> FileResponse:
    entry = _owned(db, user, file_id, allow_dir=False)
    db.add(
        Transfer(
            user_id=user.id,
            direction="download",
            filename=entry.name,
            size=entry.size,
            status="completed",
            ip=request.client.host if request.client else "",
            finished_at=utcnow(),
        )
    )
    return _download_response(entry, request.app.state.settings)


@router.get("/{file_id}/preview")
def preview(
    file_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(media_user),
) -> FileResponse:
    entry = _owned(db, user, file_id, allow_dir=False)
    if not preview_allowed(entry.name, entry.mime):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Preview is not available for this file")
    return _download_response(entry, request.app.state.settings, inline=True)


def _arcname(entry: FileEntry, root_id: str, db: Session) -> str:
    parts = [entry.name]
    parent_id = entry.parent_id
    while parent_id and parent_id != root_id:
        parent = db.get(FileEntry, parent_id)
        if parent is None:
            break
        parts.append(parent.name)
        parent_id = parent.parent_id
    return "/".join(reversed(parts))


@router.get("/{file_id}/zip")
def download_zip(
    file_id: str,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(media_user),
) -> FileResponse:
    folder = _owned(db, user, file_id)
    if not folder.is_dir:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ZIP download is only for folders")

    settings: Settings = request.app.state.settings
    entries = descendants(db, folder)
    pairs: list[tuple[str, Path]] = []
    total = 0
    for entry in entries:
        if entry.is_dir:
            continue
        total += entry.size
        if total > settings.max_upload_bytes * 2:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Folder is too large to ZIP")
        path = path_for_key(settings, entry.storage_key or "")
        if path.is_file():
            pairs.append((_arcname(entry, folder.id, db), path))

    if not pairs:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This folder has no files")

    archive = zip_files(settings, pairs)
    background.add_task(lambda: archive.unlink(missing_ok=True))
    db.add(
        Transfer(
            user_id=user.id,
            direction="download",
            filename=f"{folder.name}.zip",
            size=total,
            status="completed",
            ip=request.client.host if request.client else "",
            finished_at=utcnow(),
        )
    )
    return FileResponse(
        archive,
        media_type="application/zip",
        filename=f"{folder.name}.zip",
        content_disposition_type="attachment",
        headers=dict(DOWNLOAD_HEADERS),
    )
