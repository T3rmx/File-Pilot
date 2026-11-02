from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from typing import Literal

TLS_MODES = {"on", "off"}


def runtime_path(data_dir: Path) -> Path:
    return data_dir / "runtime.json"


def read_runtime(data_dir: Path) -> dict:
    path = runtime_path(data_dir)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_runtime(data_dir: Path, **values: object) -> None:
    """Persist boot-time choices (currently TLS) next to the database."""
    data_dir.mkdir(parents=True, exist_ok=True)
    path = runtime_path(data_dir)
    data = read_runtime(data_dir)
    for key, value in values.items():
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value

    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        tmp.chmod(0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def read_tls(data_dir: Path) -> Literal["on", "off"] | None:
    value = read_runtime(data_dir).get("tls")
    return value if value in TLS_MODES else None


def set_tls(data_dir: Path, mode: Literal["on", "off"]) -> None:
    write_runtime(data_dir, tls=mode)


def restart_process(delay: float = 0.8) -> None:
    """Re-exec this process so a changed TLS mode takes effect.

    The short delay lets the HTTP response finish before the socket closes.
    """

    def _restart() -> None:
        if getattr(sys, "frozen", False):
            # PyInstaller sidecar: sys.executable is the bundled server itself.
            os.execv(sys.executable, [sys.executable, *sys.argv[1:]])
        else:
            os.execv(sys.executable, [sys.executable, "-m", "backend.app", *sys.argv[1:]])

    threading.Timer(delay, _restart).start()
