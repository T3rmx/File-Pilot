"""Entry point used by PyInstaller to bundle the FilePilot server."""

from backend.app.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
