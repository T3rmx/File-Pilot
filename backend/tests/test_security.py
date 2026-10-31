from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.security import UnsafePathError, resolve_inside, sanitize_filename
from tests.conftest import upload


def test_prefix_sibling_is_not_inside_root(tmp_path):
    root = tmp_path / "shared"
    sibling = tmp_path / "shared-evil"
    root.mkdir()
    sibling.mkdir()
    (sibling / "secret.txt").write_text("nope")

    with pytest.raises(UnsafePathError):
        resolve_inside(root, "..", "shared-evil", "secret.txt")


def test_dotdot_escape_is_rejected(tmp_path):
    root = tmp_path / "shared"
    root.mkdir()
    with pytest.raises(UnsafePathError):
        resolve_inside(root, "../etc/passwd")


def test_symlink_inside_root_allowed(tmp_path):
    root = tmp_path / "shared"
    root.mkdir()
    target = root / "real.txt"
    target.write_text("ok")
    (root / "link.txt").symlink_to(target)

    assert resolve_inside(root, "link.txt").read_text() == "ok"


def test_symlink_escape_is_rejected(tmp_path):
    root = tmp_path / "shared"
    root.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("secret")
    (root / "escape.txt").symlink_to(outside)

    with pytest.raises(UnsafePathError):
        resolve_inside(root, "escape.txt")


def test_symlink_directory_escape_is_rejected(tmp_path):
    root = tmp_path / "shared"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret")
    (root / "dir").symlink_to(outside, target_is_directory=True)

    with pytest.raises(UnsafePathError):
        resolve_inside(root, "dir", "secret.txt")


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("../../etc/passwd", "passwd"),
        ("..\\..\\windows\\system32\\cmd.exe", "cmd.exe"),
        ("CON", "_CON"),
        ("nul.txt", "_nul.txt"),
        ("  spaced  .txt ", "spaced  .txt"),
        ("bad\x00name.txt", "badname.txt"),
        ("evil\u202egnp.exe", "evilgnp.exe"),
        ("", "file"),
        ("...", "file"),
    ],
)
def test_filename_sanitizer(raw, expected):
    assert sanitize_filename(raw) == expected


def test_empty_file_rejected(client, headers):
    response = upload(client, headers, "empty.txt", b"")
    assert response.status_code == 400


def test_upload_size_cap_is_enforced(client, headers):
    big = b"x" * (5 * 1024 * 1024 + 10)
    response = upload(client, headers, "big.bin", big)
    assert response.status_code == 413


def test_download_headers_force_attachment(client, headers):
    created = upload(client, headers, "note.txt", b"hello").json()
    response = client.get(f"/api/files/{created['id']}/download", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in response.headers["content-security-policy"]


def test_html_is_never_previewed_inline(client, headers):
    created = upload(client, headers, "xss.html", b"<script>alert(1)</script>").json()
    assert created["can_preview"] is False
    response = client.get(f"/api/files/{created['id']}/preview", headers=headers)
    assert response.status_code == 415


def test_svg_is_never_previewed_inline(client, headers):
    created = upload(client, headers, "image.svg", b"<svg onload='alert(1)'/>").json()
    assert created["can_preview"] is False


def test_image_preview_is_inline(client, headers):
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489")
    created = upload(client, headers, "pixel.png", png).json()
    response = client.get(f"/api/files/{created['id']}/preview", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith("inline")


def test_security_headers_present(client):
    response = client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "default-src 'self'" in response.headers["content-security-policy"]


def test_storage_key_traversal_is_rejected(app, settings):
    from app.storage import path_for_key

    for bad in ("../secret", "/etc/passwd", "a/../../b"):
        with pytest.raises(HTTPException):
            path_for_key(settings, bad)


def test_delete_removes_blob(client, headers, settings):
    created = upload(client, headers, "remove.txt", b"bye").json()
    response = client.delete(f"/api/files/{created['id']}", headers=headers)
    assert response.status_code == 204
    assert not any(settings.storage_dir.rglob("*")) or all(
        path.is_dir() for path in settings.storage_dir.rglob("*")
    )


def test_zip_slip_arcnames_are_sanitized(client, headers, tmp_path):
    import zipfile

    upload(client, headers, "../../evil.txt", b"payload")
    folder = client.post(
        "/api/files/folder", headers=headers, json={"name": "docs"}
    ).json()
    upload(client, headers, "inside.txt", b"payload", folder_id=folder["id"])

    response = client.get(f"/api/files/{folder['id']}/zip", headers=headers)
    assert response.status_code == 200
    archive = zipfile.ZipFile(__import__("io").BytesIO(response.content))
    assert archive.namelist() == ["inside.txt"]
