from __future__ import annotations

from app.models import User
from app.security import hash_password
from tests.conftest import upload


def test_folder_and_file_listing(client, headers):
    folder = client.post("/api/files/folder", headers=headers, json={"name": "Photos"}).json()
    assert folder["name"] == "Photos"
    upload(client, headers, "a.txt", b"aaa", folder_id=folder["id"])

    listing = client.get(f"/api/files?folder_id={folder['id']}", headers=headers).json()
    assert [item["name"] for item in listing["items"]] == ["a.txt"]
    assert listing["breadcrumbs"][-1]["name"] == "Photos"
    assert listing["items"][0]["size"] == 3


def test_duplicate_names_get_suffix(client, headers):
    first = upload(client, headers, "same.txt", b"one").json()
    second = upload(client, headers, "same.txt", b"two").json()
    assert first["name"] == "same.txt"
    assert second["name"] == "same (2).txt"


def test_rename(client, headers):
    created = upload(client, headers, "old.txt", b"x").json()
    response = client.patch(
        f"/api/files/{created['id']}", headers=headers, json={"name": "new.md"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "new.md"
    assert response.json()["mime"] == "text/markdown"


def test_delete_folder_removes_children(client, headers):
    folder = client.post("/api/files/folder", headers=headers, json={"name": "tmp"}).json()
    upload(client, headers, "inner.txt", b"x", folder_id=folder["id"])
    assert client.delete(f"/api/files/{folder['id']}", headers=headers).status_code == 204
    listing = client.get("/api/files", headers=headers).json()
    assert listing["items"] == []


def test_search(client, headers):
    upload(client, headers, "budget-2026.xlsx", b"x")
    upload(client, headers, "notes.txt", b"y")
    results = client.get("/api/files?search=budget", headers=headers).json()
    assert [item["name"] for item in results["items"]] == ["budget-2026.xlsx"]


def test_quota_is_enforced(client, headers, db):
    user = db.query(User).first()
    user.quota_bytes = 5
    db.commit()

    response = upload(client, headers, "big.txt", b"0123456789")
    assert response.status_code == 507


def test_uploads_can_be_disabled(client, headers, db):
    from app.services import set_setting

    set_setting(db, "allow_uploads", "0")
    db.commit()
    response = upload(client, headers, "nope.txt", b"x")
    assert response.status_code == 403


def test_other_users_files_are_invisible(client, headers, db):
    created = upload(client, headers, "private.txt", b"secret").json()

    second = User(
        username="intruder",
        password_hash=hash_password("intruder pass"),
        role="user",
    )
    db.add(second)
    db.commit()

    login = client.post(
        "/api/auth/login", json={"username": "intruder", "password": "intruder pass"}
    ).json()
    other_headers = {"Authorization": f"Bearer {login['access_token']}"}

    assert client.get(f"/api/files/{created['id']}/download", headers=other_headers).status_code == 404
    assert client.patch(
        f"/api/files/{created['id']}", headers=other_headers, json={"name": "hacked"}
    ).status_code == 404
    assert client.get("/api/files", headers=other_headers).json()["items"] == []


def test_folder_zip(client, headers):
    folder = client.post("/api/files/folder", headers=headers, json={"name": "pack"}).json()
    upload(client, headers, "one.txt", b"1", folder_id=folder["id"])
    upload(client, headers, "two.txt", b"22", folder_id=folder["id"])

    response = client.get(f"/api/files/{folder['id']}/zip", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"


def test_stats(client, headers):
    upload(client, headers, "stat.txt", b"12345")
    data = client.get("/api/stats", headers=headers).json()
    assert data["files"] == 1
    assert data["storage_used"] == 5
    assert data["active_shares"] == 0


def test_non_admin_cannot_read_settings(client, db, headers):
    user = User(username="bob", password_hash=hash_password("bob password"), role="user")
    db.add(user)
    db.commit()
    login = client.post("/api/auth/login", json={"username": "bob", "password": "bob password"}).json()
    response = client.get(
        "/api/settings", headers={"Authorization": f"Bearer {login['access_token']}"}
    )
    assert response.status_code == 403
