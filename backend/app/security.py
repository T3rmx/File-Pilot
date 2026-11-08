from __future__ import annotations

import os
import re
import secrets
import time
import unicodedata
from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections import defaultdict, deque
from hashlib import sha256
from pathlib import Path
from threading import Lock

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, Request, status

_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16)
_DUMMY_HASH = _hasher.hash("filepilot-dummy-password")

_WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
_BIDI_CONTROLS = re.compile(r"[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


# --------------------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time-ish verification that never leaks whether the account exists."""
    if not stored:
        if password:
            try:
                _hasher.verify(_DUMMY_HASH, password)
            except Exception:
                pass
        return False
    try:
        return _hasher.verify(stored, password)
    except (VerifyMismatchError, InvalidHashError, ValueError, KeyError):
        return False


def password_needs_rehash(stored: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored)
    except Exception:
        return False


# --------------------------------------------------------------------------- tokens


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_digest(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def _aead(secret: str) -> AESGCM:
    return AESGCM(sha256(secret.encode("utf-8")).digest())


def encrypt_text(secret: str, plaintext: str) -> str:
    """Share tokens are stored encrypted so links stay manageable after creation."""
    nonce = os.urandom(12)
    sealed = _aead(secret).encrypt(nonce, plaintext.encode("utf-8"), b"filepilot-share")
    return urlsafe_b64encode(nonce + sealed).decode("ascii")


def decrypt_text(secret: str, blob: str) -> str:
    raw = urlsafe_b64decode(blob.encode("ascii"))
    return _aead(secret).decrypt(raw[:12], raw[12:], b"filepilot-share").decode("utf-8")


def constant_time_equals(left: str, right: str) -> bool:
    return secrets.compare_digest(left, right)


# --------------------------------------------------------------------------- file names


def sanitize_filename(name: str, fallback: str = "file") -> str:
    """Make a user-supplied name safe on Linux, macOS and Windows."""
    name = unicodedata.normalize("NFC", name or "")
    name = name.replace("\\", "/").split("/")[-1]
    name = _BIDI_CONTROLS.sub("", name)
    name = _CONTROL.sub("", name)
    name = name.strip().strip(".")
    if not name or name in {".", ".."}:
        return fallback

    stem, dot, suffix = name.rpartition(".")
    if not dot:
        stem, suffix = name, ""
    if stem.lower() in _WINDOWS_RESERVED:
        stem = f"_{stem}"
    if suffix.lower() in _WINDOWS_RESERVED:
        suffix = f"_{suffix}"

    suffix = suffix[:20]
    stem = stem[: 180 - len(suffix)]
    result = f"{stem}.{suffix}" if suffix else stem
    result = result.rstrip(". ")
    return result or fallback


def unique_filename(existing: set[str], name: str) -> str:
    if name not in existing:
        return name
    stem, dot, suffix = name.rpartition(".")
    if not dot:
        stem, suffix = name, ""
    for counter in range(2, 10_000):
        candidate = f"{stem} ({counter}).{suffix}" if suffix else f"{stem} ({counter})"
        if candidate not in existing:
            return candidate
    return f"{stem}-{secrets.token_hex(4)}.{suffix}" if suffix else f"{stem}-{secrets.token_hex(4)}"


# --------------------------------------------------------------------------- paths


class UnsafePathError(ValueError):
    pass


def resolve_inside(root: Path, *parts: str, must_exist: bool = True) -> Path:
    """Canonical containment check.

    Resolves `..`, symlinks and Unicode tricks, then requires the final path to be
    root itself or a descendant. A prefix check alone would allow `/srv/shared-evil`.
    """
    root = root.resolve(strict=True)
    raw = root.joinpath(*parts)
    try:
        candidate = raw.resolve(strict=must_exist)
    except (OSError, RuntimeError) as exc:
        raise UnsafePathError(f"cannot resolve path: {exc}") from exc

    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise UnsafePathError("path escapes the storage root") from exc
    return candidate


def assert_inside(root: Path, candidate: Path) -> Path:
    root = root.resolve(strict=True)
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise UnsafePathError("path escapes the storage root") from exc
    return resolved


# --------------------------------------------------------------------------- rate limits


class RateLimiter:
    """Small in-process sliding window. Good enough for a single-process LAN server.

    Documented limitation: limits reset on restart and are per worker.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = int(bucket[0] + window_seconds - now) + 1
                return False, max(retry_after, 1)
            bucket.append(now)
            return True, 0

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def require_same_origin(request: Request) -> None:
    """Cheap CSRF defense for the few cookie-authenticated POSTs (refresh, logout)."""
    origin = request.headers.get("origin")
    if not origin:
        return
    host = request.headers.get("host", "")
    if origin.rstrip("/").split("://")[-1] != host:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cross-origin request rejected")


# --------------------------------------------------------------------------- headers


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "media-src 'self' blob:; "
    "font-src 'self' data:; "
    "connect-src 'self' ws: wss:; "
    "frame-ancestors 'none'; "
    "base-uri 'none'; "
    "form-action 'self'"
)

PREVIEW_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; sandbox"

ACCESS_COOKIE = "fp_access"
REFRESH_COOKIE = "fp_refresh"

DOWNLOAD_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
    # A file download is a one-shot transfer. Some mobile browsers and download
    # managers keep showing a finished download as incomplete (stuck at ~99%)
    # until the server closes the HTTP connection. Do not leave the socket in
    # keep-alive after the body: close it as soon as the last byte is sent.
    "Connection": "close",
}


def file_extension(name: str) -> str:
    return os.path.splitext(name)[1].lower()
