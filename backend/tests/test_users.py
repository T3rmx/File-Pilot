from __future__ import annotations

from app.models import FileEntry, User
from tests.conftest import PASSWORD, upload


def create_user(
    client,
    headers,
    username: str,
    *,
    role: str = "user",
    password: str = PASSWORD,
    quota_bytes: int | None = None,
):
    response = client.post(
        "/api/users",
        headers=headers,
        json={
            "username": username,
            "password": password,
            "role": role,
            "quota_bytes": quota_bytes,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def login_as(client, username: str, password: str = PASSWORD) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_admin_sees_the_initial_account(client, headers):
    listing = client.get("/api/users", headers=headers)
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert [item["username"] for item in items] == ["riyadh"]
    assert items[0]["role"] == "admin"
    assert items[0]["disabled"] is False


def test_create_update_and_delete_a_user(client, headers):
    created = create_user(
        client,
        headers,
        "Sara",
        role="viewer",
        quota_bytes=512 * 1024 * 1024,
    )
    assert created["username"] == "sara"
    assert created["role"] == "viewer"
    assert created["quota_bytes"] == 512 * 1024 * 1024

    updated = client.patch(
        f"/api/users/{created['id']}",
        headers=headers,
        json={"role": "user", "display_name": "Sara A", "quota_bytes": None},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["role"] == "user"
    assert updated.json()["display_name"] == "Sara A"
    assert updated.json()["quota_bytes"] is None

    assert client.delete(f"/api/users/{created['id']}", headers=headers).status_code == 204
    remaining = [item["username"] for item in client.get("/api/users", headers=headers).json()["items"]]
    assert remaining == ["riyadh"]


def test_duplicate_username_is_rejected(client, headers):
    create_user(client, headers, "sara")
    response = client.post(
        "/api/users",
        headers=headers,
        json={"username": "SARA", "password": PASSWORD, "role": "user"},
    )
    assert response.status_code == 409


def test_non_admin_cannot_manage_users(client, headers):
    create_user(client, headers, "sara")
    me = login_as(client, "sara")
    assert client.get("/api/users", headers=me).status_code == 403
    assert (
        client.post(
            "/api/users",
            headers=me,
            json={"username": "other", "password": PASSWORD, "role": "user"},
        ).status_code
        == 403
    )
    assert client.get("/api/settings", headers=me).status_code == 403
    assert client.patch("/api/settings", headers=me, json={"site_name": "x"}).status_code == 403


def test_member_can_write_but_not_administer(client, headers):
    create_user(client, headers, "sara", role="user")
    me = login_as(client, "sara")

    folder = client.post("/api/files/folder", headers=me, json={"name": "Inbox"})
    assert folder.status_code == 201
    assert upload(client, me, "note.txt", b"hello").status_code == 201
    share = client.post(
        "/api/shares",
        headers=me,
        json={"folder_id": folder.json()["id"], "label": "for a friend"},
    )
    assert share.status_code == 201
    assert client.get("/api/users", headers=me).status_code == 403


def test_viewer_is_read_only(client, headers):
    create_user(client, headers, "looker", role="viewer")
    viewer = login_as(client, "looker")

    assert client.get("/api/files", headers=viewer).status_code == 200
    assert client.get("/api/stats", headers=viewer).status_code == 200
    assert client.post("/api/files/folder", headers=viewer, json={"name": "Nope"}).status_code == 403
    assert upload(client, viewer, "blocked.txt", b"nope").status_code == 403
    assert client.post("/api/shares", headers=viewer, json={"label": "nope"}).status_code == 403
    assert client.post("/api/shares/upload", headers=viewer, json={"label": "nope"}).status_code == 403


def test_disabling_a_user_revokes_sessions_and_blocks_login(client, headers):
    created = create_user(client, headers, "sara")
    me = login_as(client, "sara")
    assert client.get("/api/auth/me", headers=me).status_code == 200

    response = client.patch(
        f"/api/users/{created['id']}", headers=headers, json={"disabled": True}
    )
    assert response.status_code == 200
    assert response.json()["disabled"] is True

    assert client.get("/api/auth/me", headers=me).status_code == 401
    blocked = client.post(
        "/api/auth/login", json={"username": "sara", "password": PASSWORD}
    )
    assert blocked.status_code == 401

    client.patch(f"/api/users/{created['id']}", headers=headers, json={"disabled": False})
    assert client.get("/api/auth/me", headers=login_as(client, "sara")).status_code == 200


def test_password_reset_revokes_old_sessions(client, headers):
    created = create_user(client, headers, "sara")
    me = login_as(client, "sara")

    response = client.patch(
        f"/api/users/{created['id']}",
        headers=headers,
        json={"password": "brand new passphrase"},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/me", headers=me).status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"username": "sara", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert login_as(client, "sara", "brand new passphrase")


def test_admin_cannot_break_their_own_account(client, headers, admin):
    user_id = admin["user"]["id"]
    assert (
        client.patch(f"/api/users/{user_id}", headers=headers, json={"role": "user"}).status_code
        == 400
    )
    assert (
        client.patch(f"/api/users/{user_id}", headers=headers, json={"disabled": True}).status_code
        == 400
    )
    assert client.delete(f"/api/users/{user_id}", headers=headers).status_code == 400


def test_delete_user_removes_files_and_shares(client, headers, settings):
    created = create_user(client, headers, "sara")
    me = login_as(client, "sara")
    uploaded = upload(client, me, "private.txt", b"private bytes").json()
    share = client.post(
        "/api/shares",
        headers=me,
        json={"file_ids": [uploaded["id"]], "label": "secret link"},
    )
    assert share.status_code == 201
    stored = [path for path in settings.storage_dir.rglob("*") if path.is_file()]
    assert stored

    assert client.delete(f"/api/users/{created['id']}", headers=headers).status_code == 204

    assert not [path for path in settings.storage_dir.rglob("*") if path.is_file()]
    assert client.get(f"/api/files/{uploaded['id']}", headers=headers).status_code == 404
    assert client.get("/api/shares", headers=headers).json()["items"] == []


def test_new_account_has_no_files_and_defaults_to_member(client, headers, db):
    created = create_user(client, headers, "sara")
    stored = db.get(User, created["id"])
    assert stored is not None and stored.role == "user"
    assert db.query(FileEntry).filter(FileEntry.owner_id == stored.id).count() == 0
