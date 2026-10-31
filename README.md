# FilePilot

Secure, local-first file sharing for your LAN — files stay on the host device, shares stay private.

- **Port:** `6969` for everything: web UI, REST API, WebSocket, share links, QR targets, TLS.
- **Stack:** FastAPI + SQLAlchemy (SQLite WAL) backend, React 19 + TypeScript + Vite frontend.
- **Security:** AES-256-GCM at rest, Argon2id password hashing, per-share passwords, download limits, expiry + instant revoke, rate limiting, audit log, security headers, attachment-only downloads, safe inline preview allowlist, path-traversal + symlink containment, filename sanitisation, CSRF protection, same-origin enforcement.
- **Desktop:** Tauri v2 shell (Phase 7 will spawn the local server as a sidecar).

## Quick start (development)

```bash
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

Open <http://127.0.0.1:6969>.

First run shows the setup wizard: create the admin account, then upload files.

### Options

| Env / flag | Default | Meaning |
| --- | --- | --- |
| `FILEPILOT_PORT` / `--port` | `6969` | Bind port (must stay 6969 for the v1 plan) |
| `FILEPILOT_HOST` / `--host` | `0.0.0.0` | Bind address; `--lan` → `0.0.0.0`; `--host 127.0.0.1` → loopback only |
| `FILEPILOT_TLS` / `--tls` | `auto` | `auto` \| `on` \| `off`; `--no-tls` forces plain HTTP |
| `FILEPILOT_DATA_DIR` | `data` | Runtime directory (db, uploads, certs, logs, secret) |
| `FILEPILOT_IMPORT_LEGACY` | `true` | One-time import of the old Flask `shared/` content on first setup |

## Features (v1 — Phase 0 → 3)

- Private upload + browse + download file manager (grid/list, search, breadcrumbs, drag & drop, upload progress dock).
- Unique share links for a file, a folder, or a multi-file selection; QR code per link; copy link; instant revoke; password, expiry, download limit; ZIP for folders/multi-file shares.
- Public share page at `/s/<token>` with password unlock, preview, downloads, and `.zip` bundle.
- Dashboard with usage stats, storage meter, activity feed, quick actions.
- Transfer log for uploads and downloads.
- Admin settings: server name, max upload size, uploads toggle, LAN discovery; audit log; password change.
- Theming (light/dark), language (English / Arabic with full RTL support).

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest
../.venv/bin/python -m ruff check app tests
cd web && npm run build && npm run lint
```

## Project layout

```
backend/   FastAPI application (app/, routers, services, tests)
web/       React + TypeScript + Vite SPA (src/, vite.config.ts)
legacy/    The original Flask app, kept for reference / import source
shared/    Legacy demo content (gitignored) — imported once on first run
data/      Runtime data (gitignored): db, uploads, certs, logs, secret key
```
