from __future__ import annotations

from datetime import timedelta

from app.models import Share, utcnow
from tests.conftest import upload


def make_share(client, headers, **overrides):
    file = upload(client, headers, overrides.pop("name", "shared.txt"), b"shared content").json()
    payload = {"file_ids": [file["id"]], **overrides}
    response = client.post("/api/shares", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return file, response.json()


def test_share_creation_returns_url_and_qr(client, headers):
    _, share = make_share(client, headers)
    assert share["status"] == "active"
    assert "/s/" in share["url"]
    assert share["qr_svg"].lstrip().startswith("<svg")
    assert share["item_count"] == 1


def test_public_info_and_download(client, headers):
    _, share = make_share(client, headers)
    token = share["url"].rsplit("/", 1)[-1]

    info = client.get(f"/api/public/{token}")
    assert info.status_code == 200
    assert info.json()["label"] == "shared.txt"
    assert info.json()["items"][0]["name"] == "shared.txt"

    file_id = info.json()["items"][0]["id"]
    download = client.get(f"/api/public/{token}/files/{file_id}/download")
    assert download.status_code == 200
    assert download.content == b"shared content"
    assert download.headers["content-disposition"].startswith("attachment")


def test_unknown_token_is_404(client):
    assert client.get("/api/public/not-a-real-token").status_code == 404


def test_download_limit_is_atomic(client, headers):
    _, share = make_share(client, headers, max_downloads=1)
    token = share["url"].rsplit("/", 1)[-1]
    file_id = client.get(f"/api/public/{token}").json()["items"][0]["id"]

    assert client.get(f"/api/public/{token}/files/{file_id}/download").status_code == 200
    assert client.get(f"/api/public/{token}/files/{file_id}/download").status_code == 410


def test_share_password_gate(client, headers):
    _, share = make_share(client, headers, password="open sesame")
    token = share["url"].rsplit("/", 1)[-1]

    locked = client.get(f"/api/public/{token}").json()
    assert locked["password_required"] is True
    assert locked["items"] == []

    wrong = client.post(f"/api/public/{token}/unlock", json={"password": "nope"})
    assert wrong.status_code == 401

    right = client.post(f"/api/public/{token}/unlock", json={"password": "open sesame"})
    assert right.status_code == 200

    unlocked = client.get(f"/api/public/{token}").json()
    assert unlocked["password_required"] is False
    assert len(unlocked["items"]) == 1
    assert client.get(f"/api/public/{token}/files/{unlocked['items'][0]['id']}/download").status_code == 200


def test_expired_link_is_blocked(client, headers, db):
    _, share = make_share(client, headers)
    row = db.get(Share, share["id"])
    row.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()

    response = client.get(f"/api/public/{share['url'].rsplit('/', 1)[-1]}")
    assert response.status_code == 410
    assert "expired" in response.json()["detail"].lower()


def test_revoked_link_is_blocked(client, headers):
    _, share = make_share(client, headers)
    assert client.delete(f"/api/shares/{share['id']}", headers=headers).status_code == 204
    response = client.get(f"/api/public/{share['url'].rsplit('/', 1)[-1]}")
    assert response.status_code == 410


def test_tokens_are_not_stored_in_plaintext(client, headers, db):
    _, share = make_share(client, headers)
    token = share["url"].rsplit("/", 1)[-1]
    row = db.get(Share, share["id"])
    assert row.token_hash != token
    assert token not in row.token_enc


def test_collection_share_zip(client, headers):
    first = upload(client, headers, "a.txt", b"a").json()
    second = upload(client, headers, "b.txt", b"b").json()
    share = client.post(
        "/api/shares",
        headers=headers,
        json={"file_ids": [first["id"], second["id"]]},
    ).json()
    token = share["url"].rsplit("/", 1)[-1]
    info = client.get(f"/api/public/{token}").json()
    assert info["kind"] == "collection"
    assert info["zip_available"] is True

    archive = client.get(f"/api/public/{token}/zip")
    assert archive.status_code == 200
    assert archive.headers["content-type"] == "application/zip"


def test_folder_share_lists_nested_files(client, headers):
    folder = client.post("/api/files/folder", headers=headers, json={"name": "project"}).json()
    upload(client, headers, "root.txt", b"r", folder_id=folder["id"])
    nested = client.post(
        "/api/files/folder", headers=headers, json={"name": "nested", "parent_id": folder["id"]}
    ).json()
    upload(client, headers, "deep.txt", b"d", folder_id=nested["id"])

    share = client.post(
        "/api/shares", headers=headers, json={"folder_id": folder["id"]}
    ).json()
    token = share["url"].rsplit("/", 1)[-1]
    names = [item["name"] for item in client.get(f"/api/public/{token}").json()["items"]]
    assert "root.txt" in names
    assert "deep.txt" in names


def test_share_listing_and_status(client, headers):
    _, share = make_share(client, headers)
    listing = client.get("/api/shares", headers=headers).json()
    assert len(listing["items"]) == 1
    assert listing["items"][0]["status"] == "active"
    assert listing["items"][0]["url"] == share["url"]


def test_share_requires_file_or_folder(client, headers):
    response = client.post("/api/shares", headers=headers, json={"file_ids": []})
    assert response.status_code == 422


def test_share_of_other_users_file_is_404(client, headers, db):
    from app.models import User
    from app.security import hash_password

    file = upload(client, headers, "mine.txt", b"x").json()
    user = User(username="mallory", password_hash=hash_password("mallory pass"), role="user")
    db.add(user)
    db.commit()
    login = client.post(
        "/api/auth/login", json={"username": "mallory", "password": "mallory pass"}
    ).json()
    other = {"Authorization": f"Bearer {login['access_token']}"}
    response = client.post("/api/shares", headers=other, json={"file_ids": [file["id"]]})
    assert response.status_code == 404
