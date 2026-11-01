from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class SetupIn(BaseModel):
    username: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=8, max_length=256)
    storage_note: str = ""


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    quota_bytes: int | None

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    expires_in: int
    user: UserOut


class FileOut(BaseModel):
    id: str
    name: str
    is_dir: bool
    size: int
    mime: str
    created_at: datetime
    updated_at: datetime
    can_preview: bool = False


class Breadcrumb(BaseModel):
    id: str | None
    name: str


class FileListOut(BaseModel):
    folder_id: str | None
    breadcrumbs: list[Breadcrumb]
    items: list[FileOut]
    total_size: int


class RenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: str | None = None


class ShareIn(BaseModel):
    file_ids: list[str] = Field(default_factory=list, max_length=200)
    folder_id: str | None = None
    label: str = Field(default="", max_length=160)
    password: str | None = Field(default=None, max_length=256)
    expires_in_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 365)
    max_downloads: int | None = Field(default=None, ge=1, le=100_000)
    auto_delete: bool = False


class UploadShareIn(BaseModel):
    label: str = Field(default="", max_length=160)
    password: str | None = Field(default=None, max_length=256)
    expires_in_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 365)
    max_uploads: int | None = Field(default=None, ge=1, le=100_000)
    auto_delete: bool = False


class ShareOut(BaseModel):
    id: str
    kind: str
    label: str
    status: str
    created_at: datetime
    expires_at: datetime | None
    max_downloads: int | None
    download_count: int
    downloads_left: int | None
    max_uploads: int | None
    upload_count: int
    uploads_left: int | None
    password_protected: bool
    url: str
    qr_svg: str
    item_count: int
    total_size: int


class ShareListOut(BaseModel):
    items: list[ShareOut]


class SettingsIn(BaseModel):
    site_name: str | None = Field(default=None, max_length=80)
    allow_uploads: bool | None = None
    max_upload_mb: int | None = Field(default=None, ge=1, le=1024 * 64)
    lan_discovery: bool | None = None


class SettingsOut(BaseModel):
    site_name: str
    allow_uploads: bool
    max_upload_mb: int
    lan_discovery: bool
    lan_url: str
    version: str


class StatsOut(BaseModel):
    files: int
    folders: int
    storage_used: int
    quota_bytes: int | None
    active_shares: int
    expiring_soon: int
    total_downloads: int
    recent: list[dict]


class PublicFileOut(BaseModel):
    id: str
    name: str
    is_dir: bool
    size: int
    mime: str
    can_preview: bool


class PublicShareOut(BaseModel):
    token: str
    label: str
    owner: str
    kind: str
    status: str
    password_required: bool
    unlocked: bool
    expires_at: datetime | None
    downloads_left: int | None
    uploads_left: int | None = None
    items: list[PublicFileOut]
    total_size: int
    zip_available: bool


class UnlockIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)
