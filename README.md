# FilePilot

Secure, local-first file sharing for your LAN — files stay on the host device, shares stay private.

- **Port:** `6969` for everything: web UI, REST API, WebSocket, share links, QR targets, TLS.
- **Security:** AES-256-GCM share tokens, Argon2id password hashing, per-share passwords, download/upload limits, expiry + instant revoke, rate limiting, audit log, security headers, attachment-only downloads, safe inline preview allowlist, path-traversal + symlink containment, filename sanitisation, CSRF protection, same-origin enforcement.
- **Access control:** Admins, Members, and Viewers. Manage users and roles from **Settings → Users & roles**.
- **TLS:** Choose HTTP or HTTPS at first-run setup. Switch later in **Settings → Connection security** (auto-restarts when changed).
- **Desktop apps:** Linux (`.deb`, `.rpm`, `.AppImage`) and Windows (`.exe`, `.msi`) installers — no Python, Node.js, or extra tools required.

## Quick start

1. **Download** the latest release for your platform from [GitHub Releases](https://github.com/T3rmx/File-Pilot/releases/latest):
   - Linux: `.deb`, `.rpm`, or `.AppImage`
   - Windows: `.exe` (setup) or `.msi`
2. **Install** and launch FilePilot.
3. On first run, the setup wizard appears:
   - Choose **HTTPS** (default, self-signed certificate) or **HTTP**.
   - Create your admin account.
   - Start uploading and sharing files.

Open `https://<your-device>:6969` in any browser on your LAN (or `http://` if you chose HTTP).

## Features

- **Private file manager** — grid/list views, search, breadcrumbs, drag & drop, upload progress.
- **Share links** — unique link per file, folder, or selection; QR code; password, expiry, download limit; instant revoke; ZIP bundles for folders/multi-file shares.
- **Upload links (dropzone)** — give anyone a URL to send files directly into your storage; no account needed; optional password, expiry, and upload limit.
- **Dashboard** — usage stats, storage meter, activity feed, quick actions.
- **Transfer log** — uploads and downloads tracked in real time.
- **Admin settings** — server name, max upload size, LAN discovery, HTTP/HTTPS transport, users & roles, audit log, password change.
- **Theming & language** — light/dark mode, English / Arabic with full RTL support.

## Upload links

Give someone a URL to send you files — they don't need an account or the app.

1. Open **Files** and scroll below the list to the **Receive files** panel.
2. Choose **Create upload link**, then optionally set a title, password, expiry and upload limit.
3. Copy the link or open its QR code, and send it to anyone.
4. They open the link, drop files into the page, and each file is uploaded straight to your home folder.

Received files appear in **Files** immediately, are logged in **Transfers** and the audit log, and never overwrite an existing name. Revoke a link at any time from **Share links**.

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
- New accounts default to **Member**. Set a storage limit in MB, or leave it empty for unlimited.

## HTTP and HTTPS

At first-run setup you pick **HTTPS** (default, self-signed CA generated locally) or **HTTP** (plain, easier on devices that won't trust the certificate). The choice is saved and reused on every start.

Change it later in **Settings → Connection security**:
1. Pick HTTP or HTTPS and save.
2. FilePilot restarts automatically and the UI opens the new address.
3. All share URLs follow the active scheme automatically.

On HTTPS, phones will show a one-time certificate warning until you install the local CA from **Settings → Trust certificate** (or visit `/trust`).

## Desktop apps

FilePilot runs as a desktop app on Linux and Windows. It bundles its own backend, so Python and Node.js are not required on the target machine.

| Package | For |
| --- | --- |
| `.deb` | Ubuntu, Debian, Linux Mint, Pop!_OS |
| `.rpm` | Fedora, RHEL, Rocky, openSUSE |
| `.AppImage` | Any current Linux distribution, no installation |
| `.exe` (NSIS) | Windows 10/11, normal installation and in-app updates |
| `.msi` | Windows 10/11, managed deployment |

Linux data lives in `~/.local/share/FilePilot`; Windows data lives in `%APPDATA%\FilePilot`. Uninstalling the app does not delete that folder.

The AppImage and NSIS builds check for updates on startup and offer **Dismiss** or **Install**. Install commands, TLS notes, and troubleshooting are in [docs/linux.md](docs/linux.md) and [docs/windows.md](docs/windows.md).

## Documentation

- [Linux packages](docs/linux.md) — install, update, troubleshooting
- [Windows packages](docs/windows.md) — install, update, troubleshooting
- [Release process](docs/releasing.md) — developer documentation for the automated release pipeline
- [Development](docs/development.md) — local development setup and workflow

## License

MIT License — see [LICENSE](LICENSE) for details.