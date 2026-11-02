from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import admin_user, get_db
from ..models import (
    AuthSession,
    FileEntry,
    Share,
    ShareEvent,
    ShareFile,
    ShareGrant,
    Transfer,
    User,
)
from ..schemas import UserAdminOut, UserCreateIn, UserListOut, UserUpdateIn
from ..security import hash_password
from ..services import log_audit
from ..storage import delete_key

router = APIRouter(prefix="/api/users", tags=["users"])


def _active_admins(db: Session, exclude_id: str | None = None) -> int:
    query = db.query(func.count(User.id)).filter(User.role == "admin", User.disabled.is_(False))
    if exclude_id:
        query = query.filter(User.id != exclude_id)
    return int(query.scalar() or 0)


def _usage(db: Session) -> dict[str, tuple[int, int]]:
    rows = (
        db.query(
            FileEntry.owner_id,
            func.coalesce(func.sum(case((FileEntry.is_dir.is_(False), 1), else_=0)), 0),
            func.coalesce(func.sum(case((FileEntry.is_dir.is_(False), FileEntry.size), else_=0)), 0),
        )
        .filter(FileEntry.deleted_at.is_(None))
        .group_by(FileEntry.owner_id)
        .all()
    )
    return {owner_id: (int(count), int(size)) for owner_id, count, size in rows}


def _serialize(user: User, usage: dict[str, tuple[int, int]]) -> UserAdminOut:
    file_count, storage_used = usage.get(user.id, (0, 0))
    return UserAdminOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        quota_bytes=user.quota_bytes,
        disabled=user.disabled,
        created_at=user.created_at,
        file_count=file_count,
        storage_used=storage_used,
    )


def _target(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


def _revoke_sessions(db: Session, user_id: str) -> None:
    db.query(AuthSession).filter(AuthSession.user_id == user_id).update(
        {AuthSession.revoked: True}, synchronize_session=False
    )


def _clean_name(value: str, fallback: str) -> str:
    return value.strip()[:120] or fallback


@router.get("", response_model=UserListOut)
def list_users(db: Session = Depends(get_db), _: User = Depends(admin_user)) -> UserListOut:
    users = db.query(User).order_by(User.created_at.asc()).all()
    usage = _usage(db)
    return UserListOut(items=[_serialize(user, usage) for user in users])


@router.post("", response_model=UserAdminOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(admin_user),
) -> UserAdminOut:
    username = payload.username.strip().lower()
    if username in {"", "root"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose another username")
    if db.query(User.id).filter(User.username == username).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is already taken")

    user = User(
        username=username,
        display_name=_clean_name(payload.display_name, payload.username.strip()),
        password_hash=hash_password(payload.password),
        role=payload.role,
        quota_bytes=payload.quota_bytes,
    )
    db.add(user)
    db.flush()
    log_audit(
        db,
        "user.created",
        actor_id=actor.id,
        actor_name=actor.username,
        target=user.username,
        request=request,
        meta={"role": user.role, "quota_bytes": user.quota_bytes},
    )
    return _serialize(user, {})


@router.patch("/{user_id}", response_model=UserAdminOut)
def update_user(
    user_id: str,
    payload: UserUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(admin_user),
) -> UserAdminOut:
    target = _target(db, user_id)
    fields = payload.model_dump(exclude_unset=True)
    is_self = target.id == actor.id

    role = fields.get("role")
    disabled = fields.get("disabled")

    if is_self and role is not None and role != "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot change your own role")
    if is_self and disabled is True:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot disable your own account")

    removing_admin = target.role == "admin" and (
        (role is not None and role != "admin") or disabled is True
    )
    if removing_admin and _active_admins(db, exclude_id=target.id) == 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "At least one active administrator is required",
        )

    if fields.get("password"):
        if is_self:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Use your account settings to change your own password",
            )
        target.password_hash = hash_password(fields["password"])
        _revoke_sessions(db, target.id)

    if "display_name" in fields:
        target.display_name = _clean_name(fields["display_name"] or "", target.username)
    if "quota_bytes" in fields:
        target.quota_bytes = fields["quota_bytes"]
    if role is not None:
        target.role = role
    if disabled is not None:
        target.disabled = disabled
        if disabled:
            _revoke_sessions(db, target.id)

    log_audit(
        db,
        "user.updated",
        actor_id=actor.id,
        actor_name=actor.username,
        target=target.username,
        request=request,
        meta={
            "role": target.role,
            "disabled": target.disabled,
            "quota_bytes": target.quota_bytes,
            "password_reset": bool(fields.get("password")),
        },
    )
    return _serialize(target, _usage(db))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(admin_user),
) -> None:
    target = _target(db, user_id)
    if target.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account")
    if target.role == "admin" and _active_admins(db, exclude_id=target.id) == 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "At least one active administrator is required",
        )

    settings: Settings = request.app.state.settings
    keys = [
        key
        for (key,) in db.query(FileEntry.storage_key)
        .filter(FileEntry.owner_id == target.id, FileEntry.storage_key.is_not(None))
        .all()
        if key
    ]
    for key in keys:
        delete_key(settings, key)

    share_ids = [row[0] for row in db.query(Share.id).filter(Share.owner_id == target.id).all()]
    if share_ids:
        db.query(ShareEvent).filter(ShareEvent.share_id.in_(share_ids)).delete(synchronize_session=False)
        db.query(ShareGrant).filter(ShareGrant.share_id.in_(share_ids)).delete(synchronize_session=False)
        db.query(ShareFile).filter(ShareFile.share_id.in_(share_ids)).delete(synchronize_session=False)
        db.query(Share).filter(Share.id.in_(share_ids)).delete(synchronize_session=False)

    db.query(AuthSession).filter(AuthSession.user_id == target.id).delete(synchronize_session=False)
    db.query(Transfer).filter(Transfer.user_id == target.id).update(
        {Transfer.user_id: None}, synchronize_session=False
    )
    db.query(FileEntry).filter(FileEntry.owner_id == target.id).delete(synchronize_session=False)

    username = target.username
    db.delete(target)
    log_audit(
        db,
        "user.deleted",
        actor_id=actor.id,
        actor_name=actor.username,
        target=username,
        request=request,
        meta={"files": len(keys)},
    )
