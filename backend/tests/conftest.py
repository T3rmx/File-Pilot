from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

PASSWORD = "correct horse battery"


@pytest.fixture
def settings(tmp_path):
    return Settings(
        data_dir=tmp_path / "data",
        tls="off",
        max_upload_bytes=5 * 1024 * 1024,
        import_legacy=False,
    )


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin(client):
    response = client.post(
        "/api/setup/", json={"username": "riyadh", "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def token(admin):
    return admin["access_token"]


@pytest.fixture
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def db(app):
    session = app.state.session_factory()
    try:
        yield session
    finally:
        session.close()


def upload(client, headers, name="hello.txt", content=b"hello filepilot", folder_id=None):
    data = {"folder_id": folder_id} if folder_id else {}
    return client.post(
        "/api/files/upload",
        headers=headers,
        files={"file": (name, content, "text/plain")},
        data=data,
    )
