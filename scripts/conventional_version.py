#!/usr/bin/env python3
"""Calculate the next FilePilot version from Conventional Commits.

The latest stable tag in the form ``vX.Y.Z`` is the release baseline. Prerelease
tags (for example ``v1.2.0-beta.4``) are ignored. Every commit after that tag is
inspected with these rules:

* ``fix: ...`` -> patch
* ``feat: ...`` -> minor
* ``BREAKING CHANGE:`` in the body or ``!`` after the type -> major

The highest required bump wins. Documentation, CI, refactoring, test, build,
style, performance, and chore commits do not trigger a release by themselves;
they are still listed in the generated release notes. Merge commits and the
automation's own ``chore(release): ...`` commits are ignored.

If there is no release-worthy commit the command succeeds with
``release=false``. That lets the workflow skip publishing instead of guessing a
version.

Usage::

    python scripts/conventional_version.py detect
    python scripts/conventional_version.py detect --json-out version.json
    python scripts/conventional_version.py notes --from-tag v1.1.0 --out notes.md

The default repository is this checkout. Pass ``--repo PATH`` to inspect another
git repository (useful for tests).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
STABLE_TAG = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
CONVENTIONAL = re.compile(
    r"^(?P<type>[A-Za-z][A-Za-z0-9-]*)"
    r"(?:\((?P<scope>[^()\r\n]*)\))?"
    r"(?P<bang>!)?: (?P<description>.+)$"
)
BREAKING = re.compile(r"(?im)^BREAKING[ -]CHANGE:\s*(?P<text>.+)$")
BOT_RELEASE = re.compile(r"^chore\(release\):\s*v?\d+\.\d+\.\d+\b", re.IGNORECASE)

BUMP_ORDER = {"patch": 1, "minor": 2, "major": 3}
RELEASE_TYPES = {"fix": "patch", "feat": "minor"}


@dataclass(frozen=True)
class ParsedCommit:
    sha: str
    subject: str
    type: str | None
    scope: str | None
    description: str
    breaking: bool
    bump: str | None


def git(repo: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise SystemExit(f"git {' '.join(args)} failed: {message}")
    return result.stdout


def stable_tags(repo: Path) -> list[tuple[tuple[int, int, int], str]]:
    tags: list[tuple[tuple[int, int, int], str]] = []
    for line in git(repo, "tag", "--list", "v*").splitlines():
        tag = line.strip()
        match = STABLE_TAG.match(tag)
        if match:
            tags.append((tuple(int(part) for part in match.groups()), tag))
    return sorted(tags)


def latest_stable_tag(repo: Path) -> str:
    tags = stable_tags(repo)
    if not tags:
        raise SystemExit(
            "no stable tag (vX.Y.Z) found; create the release baseline tag first"
        )
    return tags[-1][1]


def tag_version(tag: str) -> str:
    match = STABLE_TAG.match(tag)
    if not match:
        raise SystemExit(f"{tag!r} is not a stable tag (expected vX.Y.Z)")
    return ".".join(match.groups())


def read_version(repo: Path) -> str:
    path = repo / "VERSION"
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        raise SystemExit(f"missing {path}")
    if not SEMVER.match(raw):
        raise SystemExit(
            f"VERSION must be a plain X.Y.Z version, found {raw!r}"
        )
    return raw


def version_tuple(version: str) -> tuple[int, int, int]:
    return tuple(int(part) for part in version.split("."))  # type: ignore[return-value]


def ensure_ancestor(repo: Path, tag: str, ref: str) -> None:
    result = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", tag, ref],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"{tag} is not an ancestor of {ref}; refusing to calculate a release "
            "from divergent history"
        )


def parse_commit(sha: str, subject: str, body: str) -> ParsedCommit:
    subject = subject.strip()
    if subject.startswith("Merge ") or BOT_RELEASE.match(subject):
        return ParsedCommit(sha, subject, None, None, subject, False, None)

    match = CONVENTIONAL.match(subject)
    if not match:
        return ParsedCommit(sha, subject, None, None, subject, False, None)

    commit_type = match.group("type").lower()
    scope = match.group("scope")
    description = match.group("description").strip()
    breaking = bool(match.group("bang")) or bool(BREAKING.search(body))

    bump: str | None = None
    if breaking:
        bump = "major"
    elif commit_type in RELEASE_TYPES:
        bump = RELEASE_TYPES[commit_type]

    return ParsedCommit(
        sha=sha,
        subject=subject,
        type=commit_type,
        scope=scope,
        description=description,
        breaking=breaking,
        bump=bump,
    )


def read_commits(repo: Path, from_tag: str, to_ref: str) -> list[ParsedCommit]:
    raw = git(
        repo,
        "log",
        "-z",
        "--format=%H%x1f%s%x1f%b",
        f"{from_tag}..{to_ref}",
    )
    commits: list[ParsedCommit] = []
    for record in raw.split("\x00"):
        record = record.strip("\n")
        if not record.strip():
            continue
        parts = record.split("\x1f", 2)
        if len(parts) != 3:
            continue
        sha, subject, body = parts
        commits.append(parse_commit(sha.strip(), subject, body))
    return commits


def bump_version(version: str, bump: str) -> str:
    major, minor, patch = version_tuple(version)
    if bump == "major":
        major, minor, patch = major + 1, 0, 0
    elif bump == "minor":
        minor, patch = minor + 1, 0
    elif bump == "patch":
        patch += 1
    else:
        raise SystemExit(f"unknown bump {bump!r}")
    return f"{major}.{minor}.{patch}"


def detect(repo: Path, from_tag: str | None, to_ref: str) -> dict:
    current = read_version(repo)
    tag = from_tag or latest_stable_tag(repo)
    base = tag_version(tag)
    ensure_ancestor(repo, tag, to_ref)

    commits = read_commits(repo, tag, to_ref)
    release_commits = [commit for commit in commits if commit.bump]
    bump = None
    if release_commits:
        bump = max(
            (commit.bump for commit in release_commits if commit.bump),
            key=lambda value: BUMP_ORDER[value],
        )

    release = bump is not None
    if release:
        next_version = bump_version(base, bump)
        current_tuple = version_tuple(current)
        next_tuple = version_tuple(next_version)
        if next_tuple < current_tuple:
            raise SystemExit(
                f"calculated version {next_version} is lower than VERSION "
                f"{current}; refusing to downgrade. Move VERSION back to the "
                "latest stable tag or fix the baseline tag."
            )
        needs_commit = next_tuple > current_tuple
    else:
        next_version = current
        needs_commit = False

    return {
        "release": release,
        "bump": bump,
        "previous_tag": tag,
        "tag_version": base,
        "current_version": current,
        "next_version": next_version,
        "version_matches_tag": current == base,
        "needs_commit": needs_commit,
        "release_commit_count": len(release_commits),
        "commits": [asdict(commit) for commit in commits],
    }


def render_notes(result: dict) -> str:
    lines = [f"## FilePilot {result['next_version']}", ""]
    if not result["release"]:
        lines.append("No release-worthy changes.")
        return "\n".join(lines) + "\n"

    groups = [
        (
            "Breaking changes",
            [c for c in result["commits"] if c["breaking"]],
        ),
        (
            "Features",
            [c for c in result["commits"] if c["type"] == "feat" and not c["breaking"]],
        ),
        (
            "Bug fixes",
            [c for c in result["commits"] if c["type"] == "fix" and not c["breaking"]],
        ),
        (
            "Other changes",
            [
                c
                for c in result["commits"]
                if not c["bump"]
                and not c["breaking"]
                and not c["subject"].startswith("Merge ")
                and not BOT_RELEASE.match(c["subject"])
            ],
        ),
    ]

    for title, commits in groups:
        if not commits:
            continue
        lines.append(f"### {title}")
        for commit in commits:
            lines.append(f"- {commit['subject']} (`{commit['sha'][:7]}`)")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def write_github_output(path: Path, result: dict) -> None:
    mapping = {
        "release": str(result["release"]).lower(),
        "bump": result["bump"] or "",
        "previous_tag": result["previous_tag"],
        "tag_version": result["tag_version"],
        "current_version": result["current_version"],
        "next_version": result["next_version"],
        "version_matches_tag": str(result["version_matches_tag"]).lower(),
        "needs_commit": str(result["needs_commit"]).lower(),
        "release_commit_count": str(result["release_commit_count"]),
    }
    with path.open("a", encoding="utf-8") as handle:
        for key, value in mapping.items():
            handle.write(f"{key}={value}\n")


def print_summary(result: dict) -> None:
    print(f"latest stable tag: {result['previous_tag']}")
    if result["release"]:
        print(f"release: yes ({result['bump']})")
        print(f"next version: {result['next_version']}")
        print(f"release commits: {result['release_commit_count']}")
        print(f"needs version commit: {str(result['needs_commit']).lower()}")
    else:
        print("release: no (no feat/fix/BREAKING commits since the baseline)")
        print(f"current version: {result['current_version']}")


def resolve_repo(value: str | None) -> Path:
    return Path(value).resolve() if value else ROOT


def main() -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--repo",
        help="git repository to inspect (defaults to this checkout)",
    )

    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    detect_parser = subparsers.add_parser(
        "detect",
        parents=[common],
        help="calculate the next version and release intent",
    )
    detect_parser.add_argument(
        "--from-tag",
        help="baseline tag (defaults to the latest stable vX.Y.Z tag)",
    )
    detect_parser.add_argument(
        "--to-ref",
        default="HEAD",
        help="end of the commit range (defaults to HEAD)",
    )
    detect_parser.add_argument("--json-out", help="write the full result as JSON")
    detect_parser.add_argument("--notes-out", help="write release notes as Markdown")
    detect_parser.add_argument(
        "--github-output",
        help="append release outputs to this file ($GITHUB_OUTPUT in Actions)",
    )

    notes_parser = subparsers.add_parser(
        "notes",
        parents=[common],
        help="write release notes for a commit range",
    )
    notes_parser.add_argument("--from-tag", required=True)
    notes_parser.add_argument("--to-ref", default="HEAD")
    notes_parser.add_argument("--out", help="output file (defaults to stdout)")

    subparsers.add_parser(
        "latest-tag",
        parents=[common],
        help="print the latest stable tag",
    )

    args = parser.parse_args()
    repo = resolve_repo(args.repo)

    if args.command == "latest-tag":
        print(latest_stable_tag(repo))
        return 0

    if args.command == "detect":
        result = detect(repo, args.from_tag, args.to_ref)
        if args.json_out:
            write_json(Path(args.json_out), result)
        if args.notes_out:
            Path(args.notes_out).write_text(render_notes(result), encoding="utf-8")
        if args.github_output:
            write_github_output(Path(args.github_output), result)
        if args.json_out or args.github_output:
            print_summary(result)
        else:
            print(json.dumps(result, indent=2))
        return 0

    if args.command == "notes":
        result = detect(repo, args.from_tag, args.to_ref)
        notes = render_notes(result)
        if args.out:
            Path(args.out).write_text(notes, encoding="utf-8")
        else:
            sys.stdout.write(notes)
        return 0

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
