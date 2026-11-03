from __future__ import annotations

import json
import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.routers import system
from app.runtime import read_runtime, read_tls, set_tls, write_runtime
from tests.conftest import PASSWORD


def fresh_client(tmp_path: Path, **overrides) -> TestClient:
    settings = Settings(
        data_dir=tmp_path / "data",
        tls=overrides.pop("tls", "off"),
        max_upload_bytes=5 * 1024 * 1024,
        import_legacy=False,
        **overrides,
    )
    return TestClient(create_app(settings))


def setup(client: TestClient, tls: str) -> dict:
    response = client.post(
        "/api/setup/",
        json={"username": "riyadh", "password": PASSWORD, "tls": tls},
    )
    assert response.status_code == 200, response.text
    return response.json()


def auth(payload: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['access_token']}"}


def test_runtime_file_roundtrip(tmp_path):
    data_dir = tmp_path / "data"
    assert read_tls(data_dir) is None

    set_tls(data_dir, "off")
    assert read_tls(data_dir) == "off"
    assert read_runtime(data_dir) == {"tls": "off"}

    write_runtime(data_dir, tls="on", note="kept")
    assert read_runtime(data_dir) == {"tls": "on", "note": "kept"}

    runtime = data_dir / "runtime.json"
    assert stat.S_IMODE(runtime.stat().st_mode) == 0o600


def test_corrupt_runtime_file_is_ignored(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "runtime.json").write_text("{not json", encoding="utf-8")
    assert read_runtime(data_dir) == {}
    assert read_tls(data_dir) is None


def test_unknown_saved_tls_value_is_ignored(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "runtime.json").write_text(json.dumps({"tls": "maybe"}), encoding="utf-8")
    assert read_tls(data_dir) is None


def test_setup_with_http_does_not_require_restart(tmp_path):
    client = fresh_client(tmp_path)
    with client:
        payload = setup(client, "off")

    assert payload["tls"] == "off"
    assert payload["active_tls"] == "off"
    assert payload["restart_required"] is False
    assert payload["url"].startswith("http://")
    assert read_tls(tmp_path / "data") == "off"


def test_setup_with_https_requires_restart(tmp_path):
    client = fresh_client(tmp_path)
    with client:
        payload = setup(client, "on")

    assert payload["tls"] == "on"
    assert payload["active_tls"] == "off"
    assert payload["restart_required"] is True
    assert payload["url"].startswith("https://")
    assert read_tls(tmp_path / "data") == "on"


def test_settings_report_saved_mode(tmp_path):
    client = fresh_client(tmp_path)
    with client:
        payload = setup(client, "on")
        response = client.get("/api/settings", headers=auth(payload))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["tls_mode"] == "on"
        assert body["tls_active"] == "off"
        assert body["tls_source"] == "default"
        assert body["restart_required"] is True


def test_patch_tls_saves_choice(tmp_path):
    client = fresh_client(tmp_path)
    with client:
        payload = setup(client, "off")
        response = client.patch(
            "/api/settings", headers=auth(payload), json={"tls": "on"}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["tls_mode"] == "on"
        assert body["restart_required"] is True
        assert read_tls(tmp_path / "data") == "on"

        back = client.patch("/api/settings", headers=auth(payload), json={"tls": "off"})
        assert back.status_code == 200
        assert back.json()["restart_required"] is False


def test_patch_rejects_unknown_tls_value(tmp_path):
    client = fresh_client(tmp_path)
    with client:
        payload = setup(client, "off")
        response = client.patch(
            "/api/settings", headers=auth(payload), json={"tls": "sometimes"}
        )
        assert response.status_code == 422


def test_tls_is_locked_when_set_by_the_command_line(tmp_path):
    client = fresh_client(tmp_path, tls_source="cli")
    with client:
        payload = setup(client, "off")
        response = client.patch(
            "/api/settings", headers=auth(payload), json={"tls": "on"}
        )
        assert response.status_code == 409
        assert read_tls(tmp_path / "data") == "off"


def test_restart_requires_admin_and_re_execs(tmp_path, monkeypatch):
    called: list[bool] = []
    monkeypatch.setattr(system, "restart_process", lambda *args, **kwargs: called.append(True))

    client = fresh_client(tmp_path)
    with client:
        payload = setup(client, "on")
        created = client.post(
            "/api/users",
            headers=auth(payload),
            json={"username": "sara", "password": PASSWORD, "role": "user"},
        )
        assert created.status_code == 201
        member = client.post(
            "/api/auth/login", json={"username": "sara", "password": PASSWORD}
        ).json()

        denied = client.post("/api/system/restart", headers=auth(member))
        assert denied.status_code == 403
        assert called == []

        allowed = client.post("/api/system/restart", headers=auth(payload))
        assert allowed.status_code == 200
        assert allowed.json()["restarting"] is True
        assert called == [True]


def test_reset_removes_saved_transport(tmp_path):
    client = fresh_client(tmp_path)
    with client:
        payload = setup(client, "on")
        assert read_tls(tmp_path / "data") == "on"
        assert client.post("/api/system/reset", headers=auth(payload)).status_code == 200
        assert read_tls(tmp_path / "data") is None


@pytest.mark.parametrize("value", ["auto", "on", "off", "junk"])
def test_runtime_read_accepts_only_known_modes(tmp_path, value):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "runtime.json").write_text(json.dumps({"tls": value}), encoding="utf-8")
    expected = value if value in {"on", "off"} else None
    assert read_tls(data_dir) == expected
