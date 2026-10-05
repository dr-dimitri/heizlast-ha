"""Verify CI artifact provenance before publishing the HACS installation ZIP."""

import argparse
import json
import re
import shutil
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def prepare_release(root: Path, artifacts: Path, output: Path, commit: str) -> Path:
    """Accept only a complete HACS asset built from the requested main commit."""
    version = (root / "VERSION").read_text().strip()
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Invalid release version.")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Invalid source commit.")
    filename = json.loads((root / "hacs.json").read_text())["filename"]
    if filename != "heizlast_ha.zip":
        raise ValueError("Unexpected HACS asset filename.")
    candidates = list(artifacts.rglob(filename))
    if len(candidates) != 1:
        raise ValueError("Expected exactly one HACS installation archive.")
    source = candidates[0]
    with ZipFile(source) as bundle:
        names = bundle.namelist()
        if len(names) != len(set(names)) or any(
            PurePosixPath(name).is_absolute()
            or ".." in PurePosixPath(name).parts
            or "\\" in name
            for name in names
        ):
            raise ValueError("Invalid installation archive paths.")
        required = {
            "__init__.py",
            "manifest.json",
            "frontend.py",
            "planning.py",
            "planning-data.json",
            "repairs.py",
            "floorplan-v1.schema.json",
            "www/heizlast-ha-card.js",
            "brand/icon.png",
            "build-info.json",
        }
        if not required <= set(names) or bundle.testzip() is not None:
            raise ValueError("Incomplete or corrupt HACS archive.")
        if bundle.getinfo("www/heizlast-ha-card.js").file_size == 0:
            raise ValueError("Empty dashboard module.")
        manifest = json.loads(bundle.read("manifest.json"))
        info = json.loads(bundle.read("build-info.json"))
        if (
            manifest.get("domain") != "heizlast_ha"
            or manifest.get("version") != version
            or info.get("source_commit") != commit
            or not re.fullmatch(
                re.escape(version) + r"(?:\+ci\.\d+\.\d+)?", info.get("version", "")
            )
        ):
            raise ValueError("HACS archive version or source commit differs.")
    output.mkdir(parents=True, exist_ok=True)
    destination = output / filename
    shutil.copyfile(source, destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    print(prepare_release(root, args.artifacts, args.output, args.commit))


if __name__ == "__main__":
    main()
