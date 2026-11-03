from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from typing import Literal

TLS_MODES = {"on", "off"}

DESKTOP_ENV = "FILEPILOT_DESKTOP"
RESTART_MARKER = "restart.pending"


def runtime_path(data_dir: Path) -> Path:
    return data_dir / "runtime.json"


def restart_marker_path(data_dir: Path) -> Path:
    return data_dir / RESTART_MARKER


def write_restart_marker(data_dir: Path) -> None:
    """Ask the desktop shell to respawn the backend (shell-managed restarts)."""
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        restart_marker_path(data_dir).write_text("restart", encoding="utf-8")
    except OSError:
        pass


def clear_restart_marker(data_dir: Path) -> None:
    try:
        restart_marker_path(data_dir).unlink()
    except OSError:
        pass


def is_desktop() -> bool:
    """True when running as the packaged desktop sidecar (shell manages restarts)."""
    return os.getenv(DESKTOP_ENV) == "1"


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


def restart_process(data_dir: Path | None = None, delay: float = 0.8) -> None:
    """Apply a saved TLS change by restarting the server process.

    Inside the desktop shell (FILEPILOT_DESKTOP=1) the shell owns the backend
    lifecycle, so we drop a marker file and exit; the shell respawns the sidecar
    and reloads the window once the new transport answers. This is much more
    reliable than exec() on Windows, where the PyInstaller one-file bootloader
    owns the process tree.
    """

    def _restart() -> None:
        if is_desktop():
            if data_dir is not None:
                write_restart_marker(data_dir)
            # The marker file is the shell's signal that a restart was requested.
            os._exit(75)
        if getattr(sys, "frozen", False):
            # PyInstaller sidecar: sys.executable is the bundled server itself.
            os.execv(sys.executable, [sys.executable, *sys.argv[1:]])
        else:
            os.execv(sys.executable, [sys.executable, "-m", "backend.app", *sys.argv[1:]])

    threading.Timer(delay, _restart).start()
