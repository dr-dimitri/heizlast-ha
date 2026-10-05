"""Check the HACS installation layout and refuse incorrect release artifacts."""

import json
import shutil
import subprocess
from pathlib import Path
from zipfile import ZipFile

import pytest

from scripts.build import build
from scripts.prepare_release import prepare_release

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def hacs_repository(tmp_path):
    root = tmp_path / "repository"
    root.mkdir()
    shutil.copy(ROOT / "hacs.json", root / "hacs.json")
    shutil.copy(ROOT / "VERSION", root / "VERSION")
    shutil.copytree(
        ROOT / "custom_components/heizlast_ha",
        root / "custom_components/heizlast_ha",
        ignore=shutil.ignore_patterns("__pycache__", "www"),
    )
    frontend = root / "frontend"
    (frontend / "dist").mkdir(parents=True)
    shutil.copy(ROOT / "frontend/package.json", frontend / "package.json")
    (frontend / "dist/heizlast-ha-card.js").write_text("export const card = true;\n")
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(
        ["git", "add", "hacs.json", "VERSION", "custom_components"],
        cwd=root,
        check=True,
    )
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-qm",
            "Fixture",
        ],
        cwd=root,
        check=True,
    )
    return root


def head(root):
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True
    ).strip()


def rewrite(archive, changes=None, omit=None):
    with ZipFile(archive) as bundle:
        files = {name: bundle.read(name) for name in bundle.namelist() if name != omit}
    files.update(changes or {})
    with ZipFile(archive, "w") as bundle:
        for name, data in files.items():
            bundle.writestr(name, data)


def test_hacs_installation_includes_card_and_only_integration_files(
    hacs_repository, tmp_path
):
    root = hacs_repository
    project_archive = build(root, root / "dist", "ci.42.1")
    archive = root / "dist/heizlast_ha.zip"
    with ZipFile(archive) as bundle:
        names = set(bundle.namelist())
        assert {
            "manifest.json",
            "__init__.py",
            "www/heizlast-ha-card.js",
            "brand/icon.png",
            "floorplan-v1.schema.json",
            "planning.py",
            "planning-data.json",
        } <= names
        assert not any(
            name.startswith(("custom_components/", "frontend/", "tests/"))
            for name in names
        )
        assert not any("__pycache__" in name for name in names)
        planning = bundle.read("planning-data.json")
        assert (
            planning
            == (root / "custom_components/heizlast_ha/planning-data.json").read_bytes()
        )
        assert json.loads(planning)["schema_version"] == 1
        assert (
            bundle.read("planning.py")
            == (root / "custom_components/heizlast_ha/planning.py").read_bytes()
        )
        # HACS extracts the ZIP directly into this directory.
        destination = tmp_path / "config/custom_components/heizlast_ha"
        bundle.extractall(destination)
        assert (
            destination / "www/heizlast-ha-card.js"
        ).read_text() == "export const card = true;\n"
        assert (
            json.loads((destination / "manifest.json").read_text())["domain"]
            == "heizlast_ha"
        )
    with ZipFile(project_archive) as bundle:
        assert (
            "custom_components/heizlast_ha/www/heizlast-ha-card.js" in bundle.namelist()
        )
        assert (
            bundle.read("custom_components/heizlast_ha/planning-data.json") == planning
        )
    assert (root / "custom_components/heizlast_ha/www/heizlast-ha-card.js").is_file()
    assert (
        prepare_release(root, root / "dist", root / "release", head(root)).read_bytes()
        == archive.read_bytes()
    )


def test_hacs_build_refuses_wrong_domain_or_missing_card(hacs_repository):
    root = hacs_repository
    (root / "frontend/dist/heizlast-ha-card.js").rename(root / "frontend/dist/wrong.js")
    with pytest.raises(ValueError, match="module is missing"):
        build(root, root / "dist")
    (root / "frontend/dist/wrong.js").rename(root / "frontend/dist/heizlast-ha-card.js")
    (root / "custom_components/heizlast_ha").rename(root / "custom_components/other")
    with pytest.raises(ValueError, match="exactly"):
        build(root, root / "dist")


def test_hacs_build_refuses_linked_dashboard_directory(hacs_repository):
    root = hacs_repository
    (root / "custom_components/heizlast_ha/www").symlink_to(
        root / "frontend/dist", target_is_directory=True
    )
    with pytest.raises(ValueError, match="symbolic link"):
        build(root, root / "dist")


def test_hacs_build_requires_tracked_repository_manifest(hacs_repository):
    root = hacs_repository
    subprocess.run(["git", "rm", "--cached", "hacs.json"], cwd=root, check=True)
    with pytest.raises(ValueError, match="hacs.json must be tracked"):
        build(root, root / "dist")


@pytest.mark.parametrize("filename", ["planning.py", "planning-data.json"])
def test_hacs_build_requires_tracked_planning_runtime(hacs_repository, filename):
    root = hacs_repository
    subprocess.run(
        ["git", "rm", "--cached", f"custom_components/heizlast_ha/{filename}"],
        cwd=root,
        check=True,
    )
    # A file that exists only locally would be absent from the installed archive.
    assert (root / "custom_components/heizlast_ha" / filename).is_file()
    with pytest.raises(ValueError, match="runtime files must be tracked"):
        build(root, root / "dist")
    assert not (root / "dist/heizlast_ha.zip").exists()


def test_packaged_planning_data_has_only_neutral_source_references(hacs_repository):
    root = hacs_repository
    build(root, root / "dist")
    with ZipFile(root / "dist/heizlast_ha.zip") as bundle:
        planning = json.loads(bundle.read("planning-data.json"))
    private_fields = {
        "source_files",
        "original_filename",
        "file_path",
        "owner",
        "client",
        "author",
        "address",
        "postcode",
        "postal_code",
        "location",
        "contact",
        "email",
        "phone",
    }

    def check(value):
        if isinstance(value, dict):
            assert not private_fields.intersection(value)
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)
        elif isinstance(value, str):
            assert not any(
                marker in value
                for marker in (
                    "/Users/",
                    "/home/",
                    "\\Users\\",
                    "CloudStorage",
                    "OneDrive",
                    "file://",
                    "http://",
                    "https://",
                    ".pdf",
                )
            )

    check(planning)
    sources = planning["sources"]
    references = [sources["building"], sources["room_sum"]]
    references.extend(sources["plans"].values())
    for reference in references:
        assert set(reference) == {"document", "page", "sheet"}
        assert reference["document"] in {"Plan EG", "Plan OG", "Heizlastberechnung"}


@pytest.mark.parametrize(
    "omit",
    [
        "manifest.json",
        "repairs.py",
        "planning.py",
        "planning-data.json",
        "www/heizlast-ha-card.js",
        "build-info.json",
    ],
)
def test_release_refuses_incomplete_installation(hacs_repository, omit):
    root = hacs_repository
    build(root, root / "dist")
    rewrite(root / "dist/heizlast_ha.zip", omit=omit)
    with pytest.raises(ValueError, match="Incomplete"):
        prepare_release(root, root / "dist", root / "release", head(root))


def test_release_refuses_another_commit(hacs_repository):
    root = hacs_repository
    build(root, root / "dist")
    with pytest.raises(ValueError, match="source commit"):
        prepare_release(root, root / "dist", root / "release", "0" * 40)


@pytest.mark.parametrize(
    "changes",
    [
        {"manifest.json": json.dumps({"domain": "heizlast_ha", "version": "99.0.0"})},
        {"www/heizlast-ha-card.js": ""},
        {"../outside.py": ""},
    ],
)
def test_release_refuses_invalid_assets(hacs_repository, changes):
    root = hacs_repository
    build(root, root / "dist")
    rewrite(root / "dist/heizlast_ha.zip", changes)
    with pytest.raises(ValueError):
        prepare_release(root, root / "dist", root / "release", head(root))
