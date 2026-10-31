from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from ..deps import current_user, get_db
from ..models import AuthAttempt, AuthSession, User, utcnow
from ..schemas import LoginIn, PasswordChangeIn, SetupIn, TokenOut, UserOut
from ..security import (
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    client_ip,
    hash_password,
    new_token,
    require_same_origin,
    token_digest,
    verify_password,
)
from ..services import import_legacy_files, is_configured, log_audit, set_setting

router = APIRouter(prefix="/api/auth", tags=["auth"])
setup_router = APIRouter(prefix="/api/setup", tags=["setup"])

MAX_FAILURES = 8
WINDOW_SECONDS = 15 * 60


def _cookie_secure(request: Request) -> bool:
    return request.url.scheme == "https"


def _set_auth_cookies(
    response: Response, access: str, refresh: str, request: Request, settings
) -> None:
    secure = _cookie_secure(request)
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=settings.refresh_ttl_days * 24 * 3600,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/api/auth",
    )
    # Read-only media (thumbnails, downloads) cannot send an Authorization header.
    response.set_cookie(
        ACCESS_COOKIE,
        access,
        max_age=settings.access_ttl_minutes * 60,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
    response.delete_cookie(ACCESS_COOKIE, path="/api")


def _issue_tokens(db: Session, user: User, request: Request) -> tuple[AuthSession, str, str]:
    settings = request.app.state.settings
    access = new_token()
    refresh = new_token()
    now = utcnow()
    session = AuthSession(
        user_id=user.id,
        access_hash=token_digest(access),
        access_expires_at=now + timedelta(minutes=settings.access_ttl_minutes),
        refresh_hash=token_digest(refresh),
        refresh_expires_at=now + timedelta(days=settings.refresh_ttl_days),
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:255],
    )
    db.add(session)
    db.flush()
    return session, access, refresh


def _token_response(session: AuthSession, access: str, user: User, settings) -> TokenOut:
    return TokenOut(
        access_token=access,
        expires_in=settings.access_ttl_minutes * 60,
        user=UserOut.model_validate(user),
    )


@setup_router.get("/status")
def setup_status(db: Session = Depends(get_db)) -> dict:
    return {"configured": is_configured(db)}


@setup_router.post("/", response_model=TokenOut)
def setup(
    payload: SetupIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenOut:
    require_same_origin(request)
    if is_configured(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "FilePilot is already configured")

    limiter = request.app.state.limiter
    allowed, retry = limiter.check(f"setup:{client_ip(request)}", 5, WINDOW_SECONDS)
    if not allowed:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts", {"Retry-After": str(retry)})

    username = payload.username.strip().lower()
    if username in {"", "root"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose another username")

    user = User(
        username=username,
        display_name=payload.username.strip(),
        password_hash=hash_password(payload.password),
        role="admin",
    )
    db.add(user)
    db.flush()
    if request.app.state.settings.import_legacy:
        try:
            import_legacy_files(request.app.state.settings, db, user)
        except Exception:  # a broken legacy folder must never block first-run setup
            pass
    set_setting(db, "site_name", "FilePilot")
    set_setting(db, "allow_uploads", "1")
    set_setting(db, "max_upload_mb", str(request.app.state.settings.max_upload_bytes // (1024 * 1024)))
    set_setting(db, "lan_discovery", "1")
    log_audit(db, "setup.completed", actor_id=user.id, actor_name=user.username, request=request)

    session, access, refresh = _issue_tokens(db, user, request)
    _set_auth_cookies(response, access, refresh, request, request.app.state.settings)
    return _token_response(session, access, user, request.app.state.settings)


@router.post("/login", response_model=TokenOut)
def login(
    payload: LoginIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenOut:
    require_same_origin(request)
    ip = client_ip(request)
    username = payload.username.strip().lower()
    limiter = request.app.state.limiter

    allowed, retry = limiter.check(f"login:{ip}:{username}", MAX_FAILURES, WINDOW_SECONDS)
    if not allowed:
        db.add(AuthAttempt(username=username, ip=ip, success=False, reason="rate_limited"))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many attempts. Try again in {retry} seconds.",
            {"Retry-After": str(retry)},
        )

    user = db.query(User).filter(User.username == username).first()
    valid = verify_password(payload.password, user.password_hash if user else None)
    if not valid or user is None or user.disabled:
        db.add(AuthAttempt(username=username, ip=ip, success=False, reason="bad_credentials"))
        log_audit(db, "auth.login_failed", target=username, request=request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")

    limiter.reset(f"login:{ip}:{username}")
    db.add(AuthAttempt(username=username, ip=ip, success=True, reason="ok"))
    session, access, refresh = _issue_tokens(db, user, request)
    _set_auth_cookies(response, access, refresh, request, request.app.state.settings)
    log_audit(db, "auth.login", actor_id=user.id, actor_name=user.username, request=request)
    return _token_response(session, access, user, request.app.state.settings)


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    require_same_origin(request)
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")

    session = (
        db.query(AuthSession)
        .filter(AuthSession.refresh_hash == token_digest(raw), AuthSession.revoked.is_(False))
        .first()
    )
    now = utcnow()
    if session is None or session.refresh_expires_at <= now:
        _clear_auth_cookies(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")

    user = db.get(User, session.user_id)
    if user is None or user.disabled:
        _clear_auth_cookies(response)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    settings = request.app.state.settings
    access = new_token()
    new_refresh = new_token()
    session.access_hash = token_digest(access)
    session.access_expires_at = now + timedelta(minutes=settings.access_ttl_minutes)
    session.refresh_hash = token_digest(new_refresh)
    session.refresh_expires_at = now + timedelta(days=settings.refresh_ttl_days)
    session.last_seen = now
    _set_auth_cookies(response, access, new_refresh, request, settings)
    return _token_response(session, access, user, settings)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    require_same_origin(request)
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        session = db.query(AuthSession).filter(AuthSession.refresh_hash == token_digest(raw)).first()
        if session:
            session.revoked = True
    _clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/password")
def change_password(
    payload: PasswordChangeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Current password is incorrect")

    user.password_hash = hash_password(payload.new_password)
    current = getattr(request.state, "session", None)
    query = db.query(AuthSession).filter(AuthSession.user_id == user.id)
    if current is not None:
        query = query.filter(AuthSession.id != current.id)
    for other in query.all():
        other.revoked = True
    log_audit(db, "auth.password_changed", actor_id=user.id, actor_name=user.username, request=request)
    return {"ok": True}
