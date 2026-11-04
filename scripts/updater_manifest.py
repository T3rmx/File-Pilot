#!/usr/bin/env python3
"""Generate the Tauri updater manifest (``latest.json``) from signed artifacts.

Tauri writes a ``.sig`` file next to every updater artifact when
``createUpdaterArtifacts`` is enabled. This script pairs the AppImage and the
NSIS setup with their signatures and writes the manifest consumed by the in-app
updater. Every required artifact and signature must exist; a partial release is
never produced.

Usage::

    python scripts/updater_manifest.py \
        --artifacts release-artifacts \
        --version 1.2.0 \
        --tag v1.2.0 \
        --repo T3rmx/File-Pilot \
        --out release-artifacts/latest.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from urllib.parse import quote

SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")

PLATFORMS = (
    ("linux-x86_64", "*.AppImage"),
    ("windows-x86_64", "*setup.exe"),
)


def find_one(directory: Path, pattern: str) -> Path:
    matches = sorted(path for path in directory.glob(pattern) if path.is_file())
    if not matches:
        raise SystemExit(f"no artifact matching {pattern!r} in {directory}")
    if len(matches) > 1:
        names = ", ".join(path.name for path in matches)
        raise SystemExit(f"expected one artifact matching {pattern!r}, found: {names}")
    return matches[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repo", required=True, help="OWNER/REPOSITORY")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--notes", help="text shown by the updater")
    args = parser.parse_args()

    if not SEMVER.match(args.version):
        raise SystemExit(f"updater version must be a plain X.Y.Z, got {args.version!r}")
    if not args.tag.startswith("v"):
        raise SystemExit(f"release tag must start with v, got {args.tag!r}")
    if not args.artifacts.is_dir():
        raise SystemExit(f"artifact directory does not exist: {args.artifacts}")

    base_url = f"https://github.com/{args.repo}/releases/download/{args.tag}"
    platforms: dict[str, dict[str, str]] = {}

    for key, pattern in PLATFORMS:
        artifact = find_one(args.artifacts, pattern)
        signature_path = artifact.with_name(f"{artifact.name}.sig")
        if not signature_path.is_file():
            raise SystemExit(f"missing signature for {artifact.name}")
        signature = signature_path.read_text(encoding="utf-8").strip()
        if not signature:
            raise SystemExit(f"empty signature for {artifact.name}")
        platforms[key] = {
            "signature": signature,
            "url": f"{base_url}/{quote(artifact.name)}",
        }

    manifest = {
        "version": args.version,
        "notes": args.notes or f"FilePilot {args.version}",
        "pub_date": dt.datetime.now(dt.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "platforms": platforms,
    }

    args.out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
