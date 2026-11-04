# Releasing FilePilot

FilePilot uses three long-lived branches and fully automatic semantic versioning.

| Branch | Purpose | Push behaviour |
| --- | --- | --- |
| `dev` | Development | **No Actions run.** Run checks locally. |
| `beta` | Integration testing | Tests plus Linux and Windows packages, uploaded as Actions artifacts. Nothing is published. |
| `rel` | Production | Calculates the next version, updates every manifest, builds and signs all packages, creates `vX.Y.Z`, and publishes the stable release. |

`rel` is the repository's default branch and the **only** branch that can publish a stable release. The normal flow is:

```text
dev  ->  beta  ->  rel
```

Changes move forward with pull requests or merges. You do not edit `VERSION`, package manifests, Git tags, or release names for a normal release.

## Automatic version calculation

The latest stable tag in the form `vX.Y.Z` is the baseline. Prerelease tags such as `v1.2.0-beta.4` are ignored, and the existing `VERSION` file is never assumed to be the latest published version.

The workflow reads every commit after the baseline tag and applies Conventional Commits rules:

| Commit | Bump |
| --- | --- |
| `fix: repair transfer bug` | patch |
| `feat: add device discovery` | minor |
| `feat!: redesign networking protocol` | major |
| `fix: change protocol` with `BREAKING CHANGE: ...` in the body | major |

The highest required bump wins. For example, if a range contains a `fix:` and a `feat:`, the release is a minor bump.

These commits do **not** trigger a release on their own:

- `docs:`
- `ci:`
- `chore:`
- `test:`
- `build:`
- `style:`
- `refactor:`
- `perf:`

Merge commits and the workflow's own `chore(release): vX.Y.Z [skip ci]` commit are ignored. If no `fix:`, `feat:`, or breaking commit exists, the workflow skips the release instead of guessing a version.

Example: with `v1.1.0` as the latest stable tag and a `feat:` commit since then, the next version is `1.2.0`.

You can inspect the calculation locally:

```bash
python scripts/conventional_version.py detect
python scripts/conventional_version.py latest-tag
python scripts/conventional_version.py notes --from-tag v1.1.0 --to-ref HEAD
```

## What happens on a push to `rel`

1. The workflow verifies `VERSION` is a plain `X.Y.Z` and that every manifest is synchronized.
2. It finds the latest stable tag and reads commits since then.
3. It calculates the next semantic version.
4. If the tag or GitHub Release already exists, the run stops before building.
5. It updates every version reference:
   - `VERSION`
   - `backend/pyproject.toml`
   - `backend/app/__init__.py`
   - `web/package.json` and `web/package-lock.json`
   - `desktop/package.json` and `desktop/package-lock.json`
   - `desktop/src-tauri/tauri.conf.json`
   - `desktop/src-tauri/Cargo.toml`
   - `desktop/src-tauri/Cargo.lock` when it is tracked
6. If the version changed, it creates an automated commit as `github-actions[bot]`:

   ```text
   chore(release): v1.2.0 [skip ci]
   ```

7. Tests, lint, and the web build run against that exact commit.
8. Linux (`.deb`, `.rpm`, `.AppImage`) and Windows (`.exe`, `.msi`) packages are built.
9. Tauri signs the updater artifacts with `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
10. A draft GitHub Release is created at the exact built commit, and every asset is uploaded, including `latest.json` and `SHA256SUMS.txt`.
11. The tag target and complete asset list are verified.
12. The release is published, marked **Latest**, and `latest.json` becomes the stable updater manifest.

The tag is created only after all builds and signing succeed. If an upload or verification fails, the draft and tag are removed so the release is never visible in an incomplete state and a retry is safe.

## Beta builds

Pushes to `dev` do not start Actions. Run the checks locally, then merge `dev`
into `beta` and push:

```bash
git switch beta
git merge dev
git push origin beta
```

The workflow runs the tests, builds the web UI, and produces:

- Linux: `.deb`, `.rpm`, `.AppImage`, plus the AppImage updater signature
- Windows: NSIS `.exe` and `.msi`, plus the setup updater signature

The packages are available as `filepilot-linux-x86_64-<version>` and `filepilot-windows-x86_64-<version>` in the workflow run. Beta builds use the plain version from `VERSION`, which is why RPM and MSI are supported. They never create a tag, GitHub Release, or stable updater manifest.

## Publishing a stable release

After testing the beta artifacts:

```bash
git switch rel
git merge beta
git push origin rel
```

That is the entire production release action. There is no manual dispatch, tag creation, version edit, or deployment approval.

The in-app updater endpoint is:

```text
https://github.com/T3rmx/File-Pilot/releases/latest/download/latest.json
```

Because the release is published as Latest and contains `latest.json`, users on the previous stable version (for example `1.1.0`) discover the new version (for example `1.2.0`) on their next startup check.

## Verification builds (never publish)

**Actions → CI/CD → Run workflow** performs a verification build. The selected
branch decides what runs:

- `beta` runs the tests and builds the Linux and Windows test packages.
- `rel` calculates the next version with the same Conventional Commits logic and
  runs the full release build.

`dev` does not run Actions; select `beta` or `rel`. Every manual run **never**
commits, tags, creates a release, or publishes updater metadata.

Use this to test packaging or workflow changes without creating a production release. Normal releases still only require a push to `rel`.

## Recovery

- **Build failed:** nothing was published. Fix the problem and push the fix; re-running the failed workflow is also safe. The version commit is reused if `VERSION` already matches the calculated version.
- **Upload failed:** the draft release and tag are removed automatically, so the next run can publish cleanly.
- **Tag or release already exists:** the workflow refuses to overwrite or republish it. Delete the incomplete tag/release intentionally before retrying.
- **`VERSION` is ahead but there are no release commits:** the workflow fails instead of guessing. Restore `VERSION` to the latest stable tag or add the missing `fix:`/`feat:`/breaking commit.
- **Workflow was cancelled after the draft was created:** a draft release or tag may remain. Delete it from the GitHub Releases/Tags UI before retrying.

## Limitations

- `dev` pushes intentionally start no Actions. Run the local checks before merging to `beta`; the first automated gate is the `beta` build.
- Package builds (especially Windows/Tauri) can only be validated in GitHub Actions; a local machine without the Rust/WebKit toolchain cannot reproduce them.
- The first automated release uses the existing stable tag as its baseline. The baseline tag must exist and be an ancestor of `rel`.
- Only Linux AppImage and Windows NSIS are used by the Tauri updater. The `.deb`, `.rpm`, and `.msi` packages are release assets but are not in-app update targets.
- If GitHub Actions is unavailable or the signing secrets are missing, no release is published.
- An interrupted run can leave a draft release or tag that needs manual cleanup, as described above.
