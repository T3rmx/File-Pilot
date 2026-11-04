# Windows desktop packages

FilePilot ships as a desktop app for Windows 10 and 11 (64-bit). The app bundles
its own FilePilot server, so Python and Node.js are not required.

| Package | Best for |
| --- | --- |
| `.exe` (NSIS setup) | Normal installation and in-app updates |
| `.msi` | Managed deployment with Intune, Group Policy, or similar tooling |

The NSIS installer runs per user and does not require administrator rights.

## Building

All packages are built by GitHub Actions on `windows-latest`. Nothing needs to
be compiled on your machine.

- **Test build:** GitHub → **Actions** → **Desktop packages** → **Run
  workflow**, channel `artifacts`. Download the `filepilot-windows-x86_64`
  artifact when it finishes.
- **Beta build:** push to the `beta` branch. The workflow stamps
  `<VERSION>-beta.<run>`, builds the NSIS setup, and publishes a prerelease
  automatically.
- **Final release:** push a `vX.Y.Z` tag from the `release` branch. The same
  workflow builds the Linux and Windows packages (NSIS and MSI), then waits for
  approval on the `release` environment before publishing the final GitHub
  Release.

The version stamped into the installers comes from `VERSION`. Change it with
`python scripts/version.py bump patch` and commit it before tagging. See
[releasing.md](releasing.md) for the full flow.

## Install

Download the files from the GitHub Release or the workflow artifact.

### Setup installer (`.exe`)

```powershell
.\FilePilot_1.1.0_x64-setup.exe
```

Follow the installer, then launch **FilePilot** from the Start menu.

The signature inside the setup file is for the updater; the installer itself is
not code-signed yet. Windows SmartScreen may show **Windows protected your PC**.
Choose **More info → Run anyway** after verifying the download with
`SHA256SUMS.txt`.

### MSI package (`.msi`)

```powershell
msiexec /i FilePilot_1.1.0_x64_en-US.msi
```

MSI installs are intended for managed environments. Updates should be deployed
through your management tooling; the in-app updater is designed for the NSIS
installer.

## First run

1. FilePilot starts its local server and opens a window.
2. The setup wizard asks whether to use **HTTPS** (default) or **HTTP**, then
   asks you to create the admin account.
3. Upload files, share links, or create an upload link.
4. Scan a share QR code from a phone on the same network.

HTTPS uses a certificate authority generated on your device. The desktop window
accepts that certificate automatically. Phones and other browsers still show a
one-time warning until you install the CA from **Settings → Trust certificate**.

You can switch between HTTP and HTTPS later in **Settings → Connection
security**. FilePilot restarts itself to apply the change.

## Updates

On startup, the NSIS build checks the release manifest and offers **Dismiss** or
**Install** when a newer version is available. The installer runs in passive
mode, then FilePilot relaunches.

## Data and logs

Runtime data lives outside the installation:

```
%APPDATA%\FilePilot\
├── filepilot.db
├── storage\        uploaded files
├── certs\          local certificate authority
├── logs\           backend and desktop logs
├── runtime.json    saved HTTP/HTTPS choice
└── secret.key      session signing key
```

Uninstalling FilePilot does **not** delete this folder. Remove it manually only
if you want to erase all FilePilot data.

## Uninstall

Open **Settings → Apps → Installed apps**, find **FilePilot**, and choose
**Uninstall**.

## Troubleshooting

**The window does not open, or says port 6969 is in use**

Another program or an older FilePilot server is already using the port. Close
it, then start FilePilot again. Check `%APPDATA%\FilePilot\logs\desktop.log`
for details.

**SmartScreen blocks the installer**

The installer is not code-signed. Verify the download with `SHA256SUMS.txt`,
then choose **More info → Run anyway**.

**The app starts but the window is blank**

Check `%APPDATA%\FilePilot\logs\desktop.log` and make sure the WebView2 runtime
is installed. Windows 10 and 11 normally include it; older images may need the
Evergreen WebView2 Runtime from Microsoft.
