# Development

Local development setup and workflow for FilePilot contributors.

## Prerequisites

- Python 3.12+
- Node.js 22+
- Rust (stable) — for desktop app builds
- `uv` or `pip` for Python dependencies

## Quick start

```bash
# 1. Backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt

# terminal 1 — backend
FILEPILOT_DATA_DIR=data FILEPILOT_IMPORT_LEGACY=false \
  .venv/bin/python -m backend.app

# terminal 2 — frontend dev server (proxies /api, /ws, /ca.crt, /trust to :6969)
cd web
npm install
npm run dev
```

Open <https://127.0.0.1:6969> (or `http://` if you chose HTTP).

First run shows the setup wizard: choose HTTP or HTTPS, create the admin account, then upload files. If you switch HTTP↔HTTPS later, FilePilot will restart to apply it.

## Options

| Env / flag | Default | Meaning |
| --- | --- | --- |
| `FILEPILOT_PORT` / `--port` | `6969` | Bind port (must stay 6969 for the v1 plan) |
| `FILEPILOT_HOST` / `--host` | `0.0.0.0` | Bind address; `--lan` → `0.0.0.0`; `--host 127.0.0.1` → loopback only |
| `FILEPILOT_TLS` / `--tls` | `auto` | `auto` \| `on` \| `off`; `--no-tls` forces plain HTTP. CLI/env lock TLS in Settings (restart still applies changes saved in the wizard/runtime). |
| `FILEPILOT_DATA_DIR` | `data` | Runtime directory (db, uploads, certs, logs, secret) |
| `FILEPILOT_IMPORT_LEGACY` | `true` | One-time import of the old Flask `shared/` content on first setup |

## Tests

```bash
# Backend
cd backend && ../.venv/bin/python -m pytest
../.venv/bin/python -m ruff check app tests

# Frontend
cd web && npm run build && npm run lint
```

## Project layout

```
backend/   FastAPI application (app/, routers, services, tests)
web/       React + TypeScript + Vite SPA (src/, vite.config.ts)
desktop/   Tauri v2 desktop shell (src-tauri/, loader/) and app icons
packaging/ PyInstaller entry point and spec for the backend sidecar
scripts/   Version sync (scripts/version.py) and Conventional Commits detection
docs/      Linux and Windows package guides, plus docs/releasing.md
.github/   CI/CD workflow: beta test artifacts and automatic stable releases
legacy/    The original Flask app, kept for reference / import source
shared/    Legacy demo content (gitignored) — imported once on first run
data/      Runtime data (gitignored): db, uploads, certs, logs, secret key, runtime.json (saved TLS mode)
VERSION    Single source of truth for the app version
```

## Version management

`VERSION` at the repository root is the single source of truth. All manifests are synchronized automatically on release.

### Helper script

```bash
python scripts/version.py show       # current version
python scripts/version.py check      # verify every manifest matches VERSION
python scripts/version.py set 1.2.0  # emergency only; normal releases are automatic
```

The script updates:
- `VERSION`
- `backend/pyproject.toml`
- `backend/app/__init__.py`
- `web/package.json` and `web/package-lock.json`
- `desktop/package.json` and `desktop/package-lock.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock` (when tracked)

Never edit those files by hand — CI runs `check` on every build.

## Branches and CI

FilePilot uses three long-lived branches:

| Branch | Purpose | Push behavior |
| --- | --- | --- |
| `dev` | Development | **No Actions run.** Run checks locally. |
| `beta` | Integration testing | Tests + Linux/Windows packages as artifacts. No publish. |
| `rel` | Production | Full automatic release: version → bot commit → build/sign → tag → publish. |

**Normal flow:** `dev → beta → rel` via pull requests or merges.

- `rel` is the default branch and the only branch that can publish.
- Pushes to `dev` intentionally start no workflow; merge to `beta` when you want the CI build.

### Automatic versioning (Conventional Commits)

On a push to `rel`, the workflow:

1. Finds the latest **stable** tag (`vX.Y.Z`; prerelease tags ignored).
2. Reads every commit since that tag.
3. Chooses the highest required bump:
   - `fix: ...` → patch
   - `feat: ...` → minor
   - `BREAKING CHANGE:` in body or `!` after type → major
4. Updates all version files.
5. If version changed, creates bot commit `chore(release): vX.Y.Z [skip ci]`.
6. Builds and signs all packages from that exact commit.
7. Creates tag `vX.Y.Z`, publishes stable release marked **Latest** with `latest.json`.

`docs:`, `ci:`, `chore:`, `test:`, `build:`, `style:`, `refactor:`, `perf:` commits do not trigger a release. If no release-worthy commits exist, the workflow skips publishing instead of guessing.

### Beta test builds

```bash
git switch beta
git merge dev
git push origin beta
```

GitHub Actions runs tests, builds web UI, produces Linux (`.deb`, `.rpm`, `.AppImage`) and Windows (`.exe`, `.msi`) packages, uploads as artifacts. No tag, no release, no updater manifest.

### Stable releases

```bash
git switch rel
git merge beta
git push origin rel
```

That push is the entire release action. No manual version edit, tag, dispatch, or approval. The tag appears only after all tests, builds, and signing succeed.

### Verification builds (manual)

**Actions → CI/CD → Run workflow**:
- `beta` — test packages, no publish
- `rel` — full release build, no publish
- `dev` — rejected (run checks locally)

## Release process details

See [docs/releasing.md](releasing.md) for:
- Full automatic version calculation
- What happens on push to `rel`
- Recovery steps
- Limitations