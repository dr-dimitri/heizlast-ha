"""Require AGENTS.md in changes affecting the CI contract."""

import argparse
import subprocess

CI_FILES = {
    ".python-version",
    "pyproject.toml",
    "requirements-ci.txt",
    "scripts/build.py",
    "scripts/prepare_release.py",
    "hacs.json",
    "scripts/check_ci_docs.py",
    "frontend/package.json",
    "frontend/package-lock.json",
}


def requires_documentation(paths: set[str]) -> bool:
    """Report CI changes without an accompanying AGENTS.md update."""
    changed_ci = any(
        path.startswith(".github/workflows/") or path in CI_FILES for path in paths
    )
    return changed_ci and "AGENTS.md" not in paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", default="HEAD")
    parser.add_argument(
        "--event", choices=["push", "pull_request", "workflow_dispatch"], default="push"
    )
    args = parser.parse_args()
    if not args.base:
        print("Manual run: no comparison base; CI documentation check skipped.")
        return
    base = args.base
    if set(base) == {"0"}:
        base = subprocess.run(
            ["git", "hash-object", "-t", "tree", "--stdin"],
            input="",
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    diff_command = ["git", "diff", "--name-only"]
    if args.event == "pull_request":
        diff_command.append("--merge-base")
    paths = set(
        subprocess.run(
            [*diff_command, base, args.head],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
    )
    if requires_documentation(paths):
        raise SystemExit(
            "CI configuration changed. Update the CI description in AGENTS.md "
            "in the same change."
        )
    print("CI documentation check passed.")


if __name__ == "__main__":
    main()
