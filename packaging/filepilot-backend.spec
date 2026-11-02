# -*- mode: python ; coding: utf-8 -*-
"""Bundle the FilePilot server and its built web UI into a single sidecar."""

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

ROOT = Path(SPECPATH).resolve().parent  # noqa: F821 - provided by PyInstaller

hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "websockets.legacy",
    "websockets.legacy.server",
    "sqlalchemy.dialects.sqlite",
    "python_multipart",
    "multipart",
    "argon2",
    "cryptography",
    "segno",
]
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("websockets")
hiddenimports += collect_submodules("segno")

datas = [(str(ROOT / "web" / "dist"), "web/dist")]
for package in ("uvicorn", "fastapi", "starlette", "pydantic", "sqlalchemy", "websockets"):
    try:
        datas += copy_metadata(package)
    except Exception:
        pass

a = Analysis(  # noqa: F821
    [str(ROOT / "packaging" / "backend_entry.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "ruff", "playwright"],
    noarchive=False,
)

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="filepilot-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
