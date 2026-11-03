# Linux desktop packages

FilePilot ships as a desktop app for Linux in three formats:

| Package | Best for |
| --- | --- |
| `.deb` | Ubuntu, Debian, Linux Mint, Pop!_OS, Zorin |
| `.rpm` | Fedora, RHEL, Rocky, AlmaLinux, openSUSE |
| `.AppImage` | Any current Linux distribution, no installation needed |

The desktop app bundles its own FilePilot server, so users do not need Python,
Node.js, or a separate service. It listens on port `6969` and opens the local
web UI in a desktop window.

## Building

All packages are built by GitHub Actions. Nothing needs to be compiled on your
machine.

- **Manual test build:** GitHub → **Actions** → **Desktop packages** → **Run
  workflow**. Download the `filepilot-linux-x86_64` artifact when it finishes.
- **Release build:** push a tag such as `v1.1.0`. The same workflow builds the
  Linux and Windows packages, then waits for approval on the `release`
  environment before publishing them to a GitHub Release.

The workflow runs on `ubuntu-22.04` with Python 3.12, Node.js 22, and stable
Rust. It installs WebKitGTK 4.1, RPM tooling, AppImage tooling, and then:

1. Runs backend tests and lint, type-checks and builds the web UI.
2. Builds the backend as a one-file PyInstaller sidecar.
3. Runs a short smoke test against the sidecar (`/api/health` and the SPA).
4. Builds the Tauri app and the `.deb`, `.rpm`, and `.AppImage` bundles.
5. Writes `SHA256SUMS.txt`.
6. On `v*` tags, publishes a GitHub Release with every file.

The tag should match the app version. For example, tag `v1.1.0` for version
`1.1.0`.

## Install

Download the files from the GitHub Release or the workflow artifact.

### Debian / Ubuntu (`.deb`)

```bash
sudo apt install ./FilePilot_1.1.0_amd64.deb
```

Then launch **FilePilot** from your application menu, or run `filepilot`.

### Fedora / RHEL / openSUSE (`.rpm`)

```bash
sudo dnf install ./FilePilot-1.1.0-1.x86_64.rpm
# openSUSE:
sudo zypper install ./FilePilot-1.1.0-1.x86_64.rpm
```

Then launch **FilePilot** from your application menu, or run `filepilot`.

### Any distribution (`.AppImage`)

```bash
chmod +x FilePilot_1.1.0_amd64.AppImage
./FilePilot_1.1.0_amd64.AppImage
```

If your distribution does not have FUSE 2 installed, either install it
(`libfuse2` on Debian/Ubuntu, `fuse-libs` on Fedora) or run:

```bash
./FilePilot_1.1.0_amd64.AppImage --appimage-extract-and-run
```

## First run

1. FilePilot starts its local server and opens a window.
2. The setup wizard asks whether to use **HTTPS** (default) or **HTTP**, then
   asks you to create the admin account.
3. Upload files, share links, or create an upload link.
4. Scan a share QR code from a phone on the same network.

HTTPS uses a certificate authority generated on your device. The desktop window
accepts that certificate automatically. Phones and other browsers still show a
one-time warning until you install the CA from **Settings → Trust certificate**
or by opening `https://<your-ip>:6969/trust`.

You can switch between HTTP and HTTPS later in **Settings → Connection
security**. FilePilot restarts itself to apply the change.

## Data and logs

Runtime data lives outside the installation:

```
~/.local/share/FilePilot/
├── filepilot.db
├── storage/        uploaded files
├── certs/          local certificate authority
├── logs/           backend and desktop logs
├── runtime.json    saved HTTP/HTTPS choice
└── secret.key      session signing key
```

If `XDG_DATA_HOME` is set, FilePilot uses `$XDG_DATA_HOME/FilePilot` instead.

Uninstalling the `.deb` or `.rpm`, or deleting the AppImage, does **not** delete
this folder. Remove it manually only if you want to erase all FilePilot data.

## Uninstall

```bash
# Debian / Ubuntu
sudo apt remove file-pilot

# Fedora / RHEL
sudo dnf remove file-pilot

# AppImage
rm FilePilot_1.1.0_amd64.AppImage
```

## Troubleshooting

**The window does not open, or says port 6969 is in use**

Another program or an older FilePilot server is already using the port. Close
it, then start FilePilot again. Check `~/.local/share/FilePilot/logs/desktop.log`
for details.

**The AppImage does not start**

Install FUSE 2 or use `--appimage-extract-and-run` as shown above.

**The app starts but the window is blank**

Check `~/.local/share/FilePilot/logs/desktop.log`. On minimal distributions,
install the WebKitGTK runtime (usually `libwebkit2gtk-4.1-0` and `libgtk-3-0`).

**The app is unsigned**

The current packages are not code-signed. Your distribution may warn the first
time you install them. Verify the download with `sha256sum -c SHA256SUMS.txt`
before installing.

## Supported distributions

Because Tauri v2 uses WebKitGTK 4.1, the practical baseline is:

- Ubuntu 22.04 or newer
- Debian 12 or newer
- Fedora 36 or newer
- openSUSE Tumbleweed
- Arch Linux and other rolling distributions

Very old releases such as Ubuntu 20.04 and Debian 11 are not supported.

## Updates

The AppImage build supports in-app updates. On startup, FilePilot checks the
release manifest and offers **Dismiss** or **Install** when a newer version is
available. After a successful install the app restarts automatically.

The `.deb` and `.rpm` packages do not self-update; install the newer package to
upgrade.

## Windows

Windows packages are built by the same workflow. See
[docs/windows.md](windows.md) for install, update, and troubleshooting notes.
