"""Exercise the build and the documentation guard without Home Assistant."""

import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

import pytest

from scripts.build import build
from scripts.check_ci_docs import requires_documentation


def commit_all(repository: Path) -> None:
    subprocess.run(["git", "add", "."], cwd=repository, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=CI Test",
            "-c",
            "user.email=ci@example.invalid",
            "commit",
            "-qm",
            "Fixture",
        ],
        cwd=repository,
        check=True,
    )


@pytest.fixture
def repository(tmp_path: Path) -> Path:
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / "VERSION").write_text("0.1.0\n")
    (tmp_path / "README.md").write_text("Project documentation\n")
    commit_all(tmp_path)
    return tmp_path


def test_build_contains_tracked_sources_and_version_but_no_local_files(
    repository: Path,
):
    (repository / ".env").write_text("PRIVATE_LOCAL_CONFIGURATION=true\n")
    archive = build(repository, repository / "dist", "ci.12.1")
    assert archive.name == "heizlast-ha-0.1.0+ci.12.1.zip"
    with ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        assert set(bundle.namelist()) == {"VERSION", "README.md", "build-info.json"}
        info = json.loads(bundle.read("build-info.json"))
        assert info["version"] == "0.1.0+ci.12.1"
        assert len(info["source_commit"]) == 40


@pytest.mark.parametrize("version", ["../bad", "1.0", "01.2.3", "1.2.3/invalid"])
def test_build_rejects_invalid_version(repository: Path, version: str):
    (repository / "VERSION").write_text(version)
    with pytest.raises(ValueError, match="VERSION"):
        build(repository, repository / "dist")


def test_build_rejects_inconsistent_integration_version(repository: Path):
    integration = repository / "custom_components/heizlast_ha"
    integration.mkdir(parents=True)
    (integration / "__init__.py").write_text("")
    (integration / "manifest.json").write_text('{"version": "0.2.0"}')
    with pytest.raises(ValueError, match="manifest version"):
        build(repository, repository / "dist")


def test_build_requires_dashboard_output_and_includes_built_assets(repository: Path):
    frontend = repository / "frontend"
    frontend.mkdir()
    (frontend / "package.json").write_text('{"version": "0.1.0"}')
    with pytest.raises(ValueError, match="output is missing"):
        build(repository, repository / "dist")
    (frontend / "dist").mkdir()
    (frontend / "dist/card.js").write_text("export const card = {};\n")
    archive = build(repository, repository / "dist")
    with ZipFile(archive) as bundle:
        assert bundle.read("www/heizlast-ha/card.js") == b"export const card = {};\n"


@pytest.mark.parametrize(
    "paths, expected",
    [
        ({".github/workflows/ci.yml"}, True),
        ({".github/workflows/ci.yml", "AGENTS.md"}, False),
        ({"scripts/build.py"}, True),
        ({"scripts/prepare_release.py"}, True),
        ({"hacs.json"}, True),
        ({"requirements-ci.txt"}, True),
        ({"frontend/package.json"}, True),
        ({"custom_components/heizlast_ha/sensor.py"}, False),
        ({"README.md"}, False),
    ],
)
def test_ci_changes_require_an_agents_update(paths: set[str], expected: bool):
    assert requires_documentation(paths) is expected


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_documentation_guard_checks_real_git_changes(repository: Path, event: str):
    base = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    workflows = repository / ".github/workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text("name: CI\n")
    commit_all(repository)
    command = [
        sys.executable,
        str(Path(__file__).resolve().parents[1] / "scripts/check_ci_docs.py"),
        "--base",
        base,
        "--event",
        event,
    ]
    result = subprocess.run(command, cwd=repository, capture_output=True, text=True)
    assert result.returncode == 1
    assert "Update the CI description in AGENTS.md" in result.stderr
    (repository / "AGENTS.md").write_text("Updated CI documentation\n")
    commit_all(repository)
    result = subprocess.run(command, cwd=repository, capture_output=True, text=True)
    assert result.returncode == 0


def test_build_handles_integration_with_python_cache(repository: Path):
    components = repository / "custom_components"
    integration = components / "heizlast_ha"
    integration.mkdir(parents=True)
    (components / "__pycache__").mkdir()
    (integration / "__init__.py").write_text('"""Integration."""\n')
    (integration / "manifest.json").write_text('{"version": "0.1.0"}')
    subprocess.run(["git", "add", "."], cwd=repository, check=True)
    archive = build(repository, repository / "dist")
    with ZipFile(archive) as bundle:
        assert "custom_components/heizlast_ha/__init__.py" in bundle.namelist()
        assert "custom_components/heizlast_ha/manifest.json" in bundle.namelist()
