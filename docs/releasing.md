# Releasing FilePilot

FilePilot uses three long-lived branches and one version file. The workflow never
builds on a normal push to `main`.

| Branch | Purpose | Push behaviour |
| --- | --- | --- |
| `main` | Development and fast iteration | No packages are built |
| `beta` | Pre-release testing | Builds `<VERSION>-beta.<run>` and publishes a prerelease automatically |
| `release` | Stable channel | No build on push; final releases come from `vX.Y.Z` tags |

`VERSION` at the repository root is the only version source of truth. The
workflow refuses to build if the tag, the requested version, and `VERSION`
disagree.

## Version management

Always change versions with the helper script, never by editing manifests:

```bash
python scripts/version.py show          # current version
python scripts/version.py bump patch    # 1.2.0 -> 1.2.1
python scripts/version.py bump minor    # 1.2.0 -> 1.3.0
python scripts/version.py bump major    # 1.2.0 -> 2.0.0
python scripts/version.py set 2.1.0     # exact version
python scripts/version.py check         # verify every manifest
```

`set` and `bump` update all of these together:

- `VERSION`
- `backend/pyproject.toml`
- `backend/app/__init__.py`
- `web/package.json` and `web/package-lock.json`
- `desktop/package.json` and `desktop/package-lock.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock` (when it exists)

CI runs `version.py check` before building, so a forgotten manifest fails the
run instead of shipping a mismatched version.

## Beta release

Beta builds are automatic and need no approval.

```bash
git switch main
git pull
git switch beta
git merge main
git push origin beta
```

The workflow:

1. reads `VERSION` (for example `1.2.0`);
2. stamps `1.2.0-beta.<run_number>` into every manifest;
3. builds Linux (`.deb`, `.rpm`, `.AppImage`) and Windows (NSIS `.exe`);
4. publishes a GitHub **prerelease** tagged `v1.2.0-beta.<run_number>`.

Prereleases are never returned by `releases/latest`, so the stable in-app
updater ignores them.

## Final release

A final release is the "end version" and requires approval.

```bash
# 1. choose the next version and commit it on main
python scripts/version.py bump minor
git add VERSION backend web desktop
git commit -m "chore: release 1.3.0"
git push origin main

# 2. promote the same commit through the channels
git switch beta
git merge main
git push origin beta

git switch release
git merge beta
git push origin release
```

Then publish with either option:

**Option A — tag push (recommended)**

```bash
git switch release
git tag v1.3.0
git push origin v1.3.0
```

**Option B — manual run**

GitHub → **Actions** → **Desktop packages** → **Run workflow**:

- branch: `release`
- channel: `release`
- version: leave empty to use `VERSION` (or type the same value as confirmation)

Both options build every platform, then the **Publish final release** job waits
for approval on the `release` environment. Approve it to publish. The release is
marked as latest, and its `latest.json` becomes the manifest the in-app updater
reads.

> If you push a tag that does not match `VERSION`, the `meta` job fails before
> anything is built. Fix it with `python scripts/version.py set <tag version>`,
> commit, move the branch, and push the tag again.

## Test build (no publish)

Use this to check packaging without creating a release:

GitHub → **Actions** → **Desktop packages** → **Run workflow**:

- branch: any branch
- channel: `artifacts`

Download `filepilot-release-<version>` from the run. Linux and Windows artifacts
are also available separately. Nothing is published.

## What the workflow runs

| Job | Runs when | Publishes |
| --- | --- | --- |
| `meta` | Every run | Resolves channel, version, and tag |
| `checks` | Every run | Tests, lint, web build, version check |
| `linux` | Every run | Linux bundles + checksums |
| `windows` | Every run | NSIS (and MSI for final releases) + checksums |
| `release-artifacts` | Every run | Combined artifact and `latest.json` |
| `publish-beta` | beta channel | GitHub prerelease, automatic |
| `publish-release` | release channel | Final GitHub Release, approval required |

## Current state

- `v1.1.0` is the last published final release.
- `VERSION` is `1.2.0`, the next development line.
- `main` is the development branch.
- `beta` and `release` are created from `main` and move forward by merging.
