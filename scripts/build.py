"""Build a versioned source archive and include compiled dashboard assets."""

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def build(root: Path, output: Path, build_id: str | None = None) -> Path:
    """Package tracked files; reject inconsistent or incomplete components."""
    version = (root / "VERSION").read_text().strip()
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("VERSION must contain a major.minor.patch version.")
    if build_id is not None and not re.fullmatch(
        r"[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*", build_id
    ):
        raise ValueError("Invalid build ID.")
    components = root / "custom_components"
    integrations: list[Path] = []
    if components.exists():
        integrations = [
            path
            for path in components.iterdir()
            if path.is_dir()
            and path.name != "__pycache__"
            and not path.name.startswith(".")
        ]
        if not integrations:
            raise ValueError("custom_components contains no integration.")
        for integration in integrations:
            manifest = json.loads((integration / "manifest.json").read_text())
            if manifest.get("version") != version:
                raise ValueError(
                    f"{integration.name}: manifest version differs from VERSION."
                )
            if not (integration / "__init__.py").is_file():
                raise ValueError(f"{integration.name}: missing __init__.py.")
    frontend = root / "frontend"
    assets = []
    if frontend.exists():
        package = json.loads((frontend / "package.json").read_text())
        if package.get("version") != version:
            raise ValueError("frontend/package.json version differs from VERSION.")
        asset_paths = sorted((frontend / "dist").rglob("*"))
        if any(path.is_symlink() for path in asset_paths):
            raise ValueError("Cannot package symbolic links in dashboard output.")
        assets = [path for path in asset_paths if path.is_file()]
        if not assets:
            raise ValueError("Dashboard build output is missing or empty.")
    tracked = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True, text=True
    ).stdout.split("\0")
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    hacs = root / "hacs.json"
    hacs_files: list[tuple[Path, str]] = []
    if hacs.exists():
        if "hacs.json" not in tracked:
            raise ValueError("The HACS manifest hacs.json must be tracked.")
        config = json.loads(hacs.read_text())
        if (
            config.get("zip_release") is not True
            or config.get("filename") != "heizlast_ha.zip"
            or config.get("hide_default_branch") is not True
        ):
            raise ValueError("HACS requires the heizlast_ha.zip release asset.")
        if len(integrations) != 1 or integrations[0].name != "heizlast_ha":
            raise ValueError("HACS requires exactly the heizlast_ha integration.")
        integration = integrations[0]
        prefix = "custom_components/heizlast_ha/"
        for name in sorted(filter(None, tracked)):
            if name.startswith(prefix):
                hacs_files.append((root / name, name.removeprefix(prefix)))
        required = {
            "__init__.py",
            "manifest.json",
            "frontend.py",
            "planning.py",
            "planning-data.json",
            "repairs.py",
            "brand/icon.png",
        }
        if not required <= {name for _, name in hacs_files}:
            raise ValueError("HACS integration runtime files must be tracked.")
        if not any(
            asset.relative_to(frontend / "dist").as_posix() == "heizlast-ha-card.js"
            for asset in assets
        ):
            raise ValueError("HACS dashboard module is missing.")
        # HACS installs only this directory. The card travels with every update.
        destination = integration / "www"
        if destination.is_symlink():
            raise ValueError("Cannot copy dashboard assets into a symbolic link.")
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir()
        for asset in assets:
            name = Path("www") / asset.relative_to(frontend / "dist")
            target = integration / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(asset, target)
            hacs_files.append((asset, name.as_posix()))
    artifact_version = f"{version}+{build_id}" if build_id else version
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"heizlast-ha-{artifact_version}.zip"
    info = json.dumps({"version": artifact_version, "source_commit": commit}, indent=2)
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
        for name in sorted(filter(None, tracked)):
            path = root / name
            if path.is_symlink():
                raise ValueError(f"Cannot package symbolic link: {name}")
            bundle.write(path, name)
        for asset in assets:
            if asset.is_symlink():
                raise ValueError(f"Cannot package symbolic link: {asset}")
            name = Path("www/heizlast-ha") / asset.relative_to(frontend / "dist")
            if name.as_posix() in bundle.namelist():
                raise ValueError(f"Duplicate dashboard asset: {name}")
            bundle.write(asset, name.as_posix())
        if hacs_files:
            for path, name in hacs_files:
                if name.startswith("www/"):
                    bundle.write(path, f"custom_components/heizlast_ha/{name}")
        bundle.writestr(
            "build-info.json",
            info + "\n",
        )
    if hacs_files:
        hacs_archive = output / "heizlast_ha.zip"
        with ZipFile(hacs_archive, "w", compression=ZIP_DEFLATED) as bundle:
            for path, name in hacs_files:
                if path.is_symlink():
                    raise ValueError(f"Cannot package symbolic link: {path}")
                bundle.write(path, name)
            bundle.writestr("build-info.json", info + "\n")
        print(hacs_archive)
    print(archive)
    return archive


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-id")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    build(root, root / "dist", args.build_id)


if __name__ == "__main__":
    main()
