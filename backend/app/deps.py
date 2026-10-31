from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .models import AuthSession, User, utcnow
from .security import ACCESS_COOKIE, token_digest


def get_db(request: Request) -> Iterator[Session]:
    factory = request.app.state.session_factory
    db = factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def _session_from_token(request: Request, db: Session, token: str) -> AuthSession:
    now = utcnow()
    session = db.query(AuthSession).filter(AuthSession.access_hash == token_digest(token)).first()
    if session is None or session.revoked or session.access_expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    if (now - session.last_seen).total_seconds() > 60:
        session.last_seen = now
    return session


def _load_user(request: Request, db: Session, token: str | None) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    session = _session_from_token(request, db, token)
    user = db.get(User, session.user_id)
    if user is None or user.disabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    request.state.user = user
    request.state.session = session
    return user


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Mutations require an explicit Bearer token, which removes the CSRF surface."""
    return _load_user(request, db, _bearer(request))


def media_user(request: Request, db: Session = Depends(get_db)) -> User:
    """GET-only auth that also accepts the access cookie, so <img>/<a> work."""
    token = _bearer(request) or request.cookies.get(ACCESS_COOKIE)
    return _load_user(request, db, token)


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access required")
    return user
