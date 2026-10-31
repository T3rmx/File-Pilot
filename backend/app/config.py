from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value can be overridden with FILEPILOT_* env vars."""

    model_config = SettingsConfigDict(
        env_prefix="FILEPILOT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = Path("data")
    host: str = "0.0.0.0"
    port: int = 6969
    lan: bool = True
    tls: Literal["auto", "on", "off"] = "auto"

    max_upload_bytes: int = 4 * 1024**3
    import_legacy: bool = True
    access_ttl_minutes: int = 15
    refresh_ttl_days: int = 30
    share_grant_minutes: int = 60

    jwt_issuer: str = "filepilot"

    @property
    def storage_dir(self) -> Path:
        return self.data_dir / "storage"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def certs_dir(self) -> Path:
        return self.data_dir / "certs"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "filepilot.db"

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.storage_dir, self.tmp_dir, self.certs_dir, self.logs_dir):
            path.mkdir(parents=True, exist_ok=True)


def load_or_create_secret(data_dir: Path) -> str:
    """The session/CSRF secret must survive restarts. Env wins, then a 0600 key file."""
    env_secret = os.getenv("FILEPILOT_SECRET")
    if env_secret:
        return env_secret

    data_dir.mkdir(parents=True, exist_ok=True)
    key_file = data_dir / "secret.key"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()

    secret = secrets.token_urlsafe(48)
    key_file.write_text(secret, encoding="utf-8")
    try:
        key_file.chmod(0o600)
    except OSError:
        pass
    return secret
