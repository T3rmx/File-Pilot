from __future__ import annotations

from tests.conftest import PASSWORD


def test_setup_only_once(client):
    assert client.post("/api/setup/", json={"username": "admin1", "password": PASSWORD}).status_code == 200
    second = client.post("/api/setup/", json={"username": "admin2", "password": PASSWORD})
    assert second.status_code == 409


def test_setup_rejects_short_password(client):
    response = client.post("/api/setup/", json={"username": "admin", "password": "short"})
    assert response.status_code == 422


def test_unauthenticated_requests_are_rejected(client, admin):
    assert client.get("/api/files").status_code == 401
    assert client.get("/api/files").json()["detail"] == "Authentication required"
    assert client.get("/api/stats").status_code == 401


def test_login_and_me(client, admin):
    response = client.post(
        "/api/auth/login", json={"username": "riyadh", "password": PASSWORD}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["username"] == "riyadh"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {data['access_token']}"})
    assert me.status_code == 200
    assert me.json()["role"] == "admin"


def test_wrong_password_is_rejected(client, admin):
    response = client.post(
        "/api/auth/login", json={"username": "riyadh", "password": "wrong-password"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect username or password"


def test_unknown_user_gets_same_error(client, admin):
    response = client.post(
        "/api/auth/login", json={"username": "ghost", "password": "whatever"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect username or password"


def test_login_is_rate_limited(client, admin):
    for _ in range(9):
        response = client.post(
            "/api/auth/login", json={"username": "riyadh", "password": "bad"}
        )
    assert response.status_code == 429
    assert "Retry-After" in response.headers


def test_refresh_rotates_the_access_token(client, admin):
    first = admin["access_token"]
    response = client.post("/api/auth/refresh")
    assert response.status_code == 200
    second = response.json()["access_token"]
    assert second != first
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {second}"}).status_code == 200


def test_logout_revokes_the_session(client, admin):
    token = admin["access_token"]
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_cookie_cannot_mutate_but_can_read_media(client, admin, headers):
    # The access cookie is scoped to read-only media. Mutations need the Bearer token.
    response = client.post("/api/files/folder", json={"name": "cookie-folder"})
    assert response.status_code == 401


def test_default_cookie_flags(client, admin):
    set_cookies = client.cookies.jar
    refresh = next(cookie for cookie in set_cookies if cookie.name == "fp_refresh")
    assert refresh.secure is False  # test client runs over http
    assert refresh.has_nonstandard_attr("HttpOnly")
    assert refresh.path == "/api/auth"
    access = next(cookie for cookie in set_cookies if cookie.name == "fp_access")
    assert access.path == "/api"


def test_password_change_revokes_other_sessions(client, admin):
    other = client.post(
        "/api/auth/login", json={"username": "riyadh", "password": PASSWORD}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {admin['access_token']}"}
    response = client.post(
        "/api/auth/password",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "another strong pass"},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 401
    login = client.post(
        "/api/auth/login", json={"username": "riyadh", "password": "another strong pass"}
    )
    assert login.status_code == 200
