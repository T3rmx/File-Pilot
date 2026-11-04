# FilePilot

Secure, local-first file sharing for your LAN — files stay on the host device, shares stay private.

- **Port:** `6969` for everything: web UI, REST API, WebSocket, share links, QR targets, TLS.
- **Stack:** FastAPI + SQLAlchemy (SQLite WAL) backend, React 19 + TypeScript + Vite frontend.
- **Security:** AES-256-GCM share tokens, Argon2id password hashing, per-share passwords, download/upload limits, expiry + instant revoke, rate limiting, audit log, security headers, attachment-only downloads, safe inline preview allowlist, path-traversal + symlink containment, filename sanitisation, CSRF protection, same-origin enforcement.
- **Access control:** Admins, Members, and Viewers. Manage users and roles from **Settings → Users & roles**.
- **TLS:** Choose HTTP or HTTPS at first-run setup. Switch later in **Settings → Connection security** (auto-restarts when changed).
- **Desktop:** Tauri v2 shell with a bundled PyInstaller backend sidecar. Linux (`.deb`, `.rpm`, `.AppImage`) and Windows (`.exe`, `.msi`) packages are built by GitHub Actions from the `beta` and `release` channels — see [docs/linux.md](docs/linux.md), [docs/windows.md](docs/windows.md), and [docs/releasing.md](docs/releasing.md).

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

Open <https://127.0.0.1:6969> (or `http://` if you chose HTTP).

First run shows the setup wizard: choose HTTP or HTTPS, create the admin account, then upload files. If you switch HTTP<->HTTPS later, FilePilot will restart to apply it.

### Options

| Env / flag | Default | Meaning |
| --- | --- | --- |
| `FILEPILOT_PORT` / `--port` | `6969` | Bind port (must stay 6969 for the v1 plan) |
| `FILEPILOT_HOST` / `--host` | `0.0.0.0` | Bind address; `--lan` → `0.0.0.0`; `--host 127.0.0.1` → loopback only |
| `FILEPILOT_TLS` / `--tls` | `auto` | `auto` \| `on` \| `off`; `--no-tls` forces plain HTTP. CLI/env lock TLS in Settings (restart still applies changes saved in the wizard/runtime). |
| `FILEPILOT_DATA_DIR` | `data` | Runtime directory (db, uploads, certs, logs, secret) |
| `FILEPILOT_IMPORT_LEGACY` | `true` | One-time import of the old Flask `shared/` content on first setup |

## Features (v1 — Phase 0 → 3)

- Private upload + browse + download file manager (grid/list, search, breadcrumbs, drag & drop, upload progress dock).
- Unique share links for a file, a folder, or a multi-file selection; QR code per link; copy link; instant revoke; password, expiry, download limit; ZIP for folders/multi-file shares. Link addresses can be random or a custom readable token.
- Public share page at `/s/<token>` with password unlock, preview, downloads, and `.zip` bundle.
- **Upload links (dropzone):** a "Receive files" panel below the files list creates a link anyone can use to send files into your storage — no account needed. Optional password, expiry and upload limit; received files land in your home folder, never overwrite existing names, and respect the server upload size/quota settings. Revoke any upload link from Share links.
- Dashboard with usage stats, storage meter, activity feed, quick actions.
- Transfer log for uploads and downloads.
- Admin settings: server name, max upload size, uploads toggle, LAN discovery, HTTP/HTTPS transport; users & roles; audit log; password change.
- Theming (light/dark), language (English / Arabic with full RTL support).

## Upload links

Give someone a URL to send you files — they don't need an account or the app.

1. Open **Files** and scroll below the list to the **Receive files** panel.
2. Choose **Create upload link**, then optionally set a title, password, expiry and upload limit.
3. Copy the link or open its QR code, and send it to anyone.
4. They open `/s/<token>`, drop files into the page, and each file is uploaded straight to your home folder.

Received files appear in **Files** immediately (live WebSocket refresh), are logged in **Transfers** and the audit log, and never overwrite an existing name. Upload links can only receive files — they cannot list, preview, download or zip anything. Revoke a link at any time from **Share links**.

## Users & roles

Admins manage accounts in **Settings → Users & roles**. Each account has a role, optional storage quota, and an enabled/disabled state.

| Role | Can do |
| --- | --- |
| **Admin** | Everything: server settings, users, audit log, files, shares, upload links |
| **Member** | Manage their own files, shares, and upload links |
| **Viewer** | Browse and download only — no uploads, edits, deletes, shares, or upload links |

- You cannot change your own role, disable yourself, or delete your own account.
- The last active admin cannot be demoted, disabled, or deleted.
- Resetting a password or disabling an account revokes that user's sessions immediately.
- Deleting a user permanently removes their files, shares, sessions, and transfer history links. Type the username to confirm.

New accounts default to **Member**. Set a storage limit in MB, or leave it empty for unlimited.

## HTTP and HTTPS

At first-run setup you pick **HTTPS** (default, self-signed CA generated locally) or **HTTP** (plain, easier on devices that won't trust the certificate). The choice is saved in `data/runtime.json` and reused on every start.

Change it later in **Settings → Connection security**:

1. Pick HTTP or HTTPS and save.
2. FilePilot asks to restart; the server re-execs itself and the UI opens the new address.
3. Update bookmarks or QR targets — all share URLs follow the active scheme automatically.

Precedence at boot: CLI flag (`--tls`, `--no-tls`) → `FILEPILOT_TLS` → saved choice → default (`auto`). When TLS is locked by a CLI flag or environment variable, Settings shows it as read-only. Trust certificates and `/ca.crt` are only offered while HTTPS is active.

On HTTPS, phones will show a one-time certificate warning until you install the local CA from **Settings → Trust certificate** (or visit `/trust`).

## Desktop packages

FilePilot also runs as a desktop app on Linux and Windows. It bundles its own backend, so Python and Node.js are not required on the target machine.

| Package | For |
| --- | --- |
| `.deb` | Ubuntu, Debian, Linux Mint, Pop!_OS |
| `.rpm` | Fedora, RHEL, Rocky, openSUSE |
| `.AppImage` | Any current Linux distribution, no installation |
| `.exe` (NSIS) | Windows 10/11, normal installation and in-app updates |
| `.msi` | Windows 10/11, managed deployment |

Packages are built **only** by GitHub Actions — no local Rust or packaging tools needed. A normal push to `main` never starts a build.

Linux data lives in `~/.local/share/FilePilot`; Windows data lives in `%APPDATA%\FilePilot`. Uninstalling the app does not delete that folder.

The AppImage and NSIS builds check for updates on startup and offer **Dismiss** or **Install**. Install commands, TLS notes, and troubleshooting are in [docs/linux.md](docs/linux.md) and [docs/windows.md](docs/windows.md).

## Branches, versions, and releases

FilePilot keeps `main` for development, `beta` for pre-release testing, and `release` for final versions. Pushing to `main` does not build anything.

| Branch | Purpose | What a push does |
| --- | --- | --- |
| `main` | Development and fast iteration | Nothing — no packages are built |
| `beta` | Pre-release testing | Builds `<VERSION>-beta.<run>` and publishes a GitHub **prerelease** automatically |
| `release` | Stable channel | Nothing on push; a `vX.Y.Z` tag (or a manual `release` run) publishes the final version |

`VERSION` at the repository root is the single source of truth for the version. All manifests are kept in sync from it.

### Version management

```bash
python scripts/version.py show          # print the current version
python scripts/version.py bump patch    # 1.2.0 -> 1.2.1 (also: minor, major)
python scripts/version.py set 1.2.0     # set an exact version
python scripts/version.py check         # verify every manifest matches VERSION
```

`bump`/`set` update `VERSION`, the backend package, web and desktop `package.json`, both lockfiles, the Tauri config, and `Cargo.toml` together. CI runs `check` on every build, so a release cannot ship mismatched versions. Never edit those files by hand.

### Beta releases (fast, automatic)

1. Merge your work from `main` into `beta`.
2. Push `beta`:

   ```bash
   git switch beta
   git merge main
   git push origin beta
   ```

3. GitHub Actions stamps the version as `<VERSION>-beta.<run_number>` (for example `1.2.0-beta.12`), builds Linux and Windows packages, and publishes a prerelease. No approval is needed, and the stable updater ignores prereleases. Beta Linux packages are `.deb` and `.AppImage`; final releases also add `.rpm` and MSI (RPM cannot encode a prerelease version).

### Final releases (the "end version")

1. Bump the version and move it through the channels:

   ```bash
   python scripts/version.py bump minor    # 1.2.0 -> 1.3.0 (or patch / major)
   git add VERSION backend web desktop
   git commit -m "chore: release 1.3.0"
   git push origin main

   git switch beta && git merge main && git push origin beta
   git switch release && git merge beta && git push origin release
   ```

2. Publish in either way:
   - Push the tag from `release`: `git tag v1.3.0 && git push origin v1.3.0`
   - Or open **Actions → Desktop packages → Run workflow**, select the `release` branch, channel `release`, and run it.

3. The build runs, then **Publish final release** waits for approval on the `release` environment. Approve it to publish the final GitHub Release.

The final release becomes `releases/latest`, which is what the in-app updater reads. Beta prereleases are ignored by the updater. Full details are in [docs/releasing.md](docs/releasing.md).

### Test builds

Open **Actions → Desktop packages → Run workflow**, pick any branch, and choose channel `artifacts`. It builds Linux and Windows packages without publishing anything; download `filepilot-release-<version>` from the run.

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
desktop/   Tauri v2 desktop shell (src-tauri/, loader/) and app icons
packaging/ PyInstaller entry point and spec for the backend sidecar
scripts/   Version management helper (scripts/version.py)
docs/      Linux and Windows package guides, plus docs/releasing.md
.github/   GitHub Actions workflow for tests and desktop packages
legacy/    The original Flask app, kept for reference / import source
shared/    Legacy demo content (gitignored) — imported once on first run
data/      Runtime data (gitignored): db, uploads, certs, logs, secret key, runtime.json (saved TLS mode)
VERSION    Single source of truth for the app version
```
