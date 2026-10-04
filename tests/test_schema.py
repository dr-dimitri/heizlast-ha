"""Keep the floor plan contract, integration copy and example in agreement."""

import copy
import json
import struct
from pathlib import Path
from xml.etree import ElementTree

import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schemas/floorplan-v1.schema.json"
EXAMPLE = ROOT / "examples/ground-floor.json"


def test_packaged_schema_is_identical_to_authoritative_contract():
    integration = ROOT / "custom_components/heizlast_ha/floorplan-v1.schema.json"
    assert integration.read_bytes() == SCHEMA.read_bytes()


def test_example_matches_schema_and_original_image_dimensions():
    schema = json.loads(SCHEMA.read_text())
    Draft202012Validator.check_schema(schema)
    plan = json.loads(EXAMPLE.read_text())
    Draft202012Validator(schema).validate(plan)
    image = (ROOT / "examples/ground-floor.png").read_bytes()
    assert image[:8] == b"\x89PNG\r\n\x1a\n"
    assert image[12:16] == b"IHDR"
    width, height = struct.unpack(">II", image[16:24])
    assert (width, height) == (1200, 800)
    assert plan["floors"][0]["canvas"] == {"width": width, "height": height}


def test_example_polygons_match_exact_svg_room_boundaries():
    floor = json.loads(EXAMPLE.read_text())["floors"][0]
    vector = ElementTree.parse(ROOT / "examples/ground-floor.svg")
    rooms = vector.findall(".//{http://www.w3.org/2000/svg}rect")[2:]
    assert len(rooms) == len(floor["rooms"]) == 4
    for room, rectangle in zip(floor["rooms"], rooms, strict=True):
        left, top, width, height = (
            int(rectangle.attrib[key]) for key in ("x", "y", "width", "height")
        )
        assert room["polygon"] == [
            [left, top],
            [left + width, top],
            [left + width, top + height],
            [left, top + height],
        ]
        assert room["area_m2"] is None


@pytest.mark.parametrize(
    "change",
    [
        lambda plan: plan.update(schema_version="1.0"),
        lambda plan: plan.update(schema_version="2.0"),
        lambda plan: plan["floors"][0].update(background="/local/plan.png"),
        lambda plan: plan.update(unexpected=True),
        lambda plan: plan["floors"][0]["canvas"].update(width=8193),
        lambda plan: plan["floors"][0]["canvas"].update(height=0),
        lambda plan: plan["floors"][0]["rooms"][0].update(id="Invalid Room"),
        lambda plan: plan["floors"][0].update(name=" \t\n"),
        lambda plan: plan["floors"][0]["rooms"][0].update(name=" \t\n"),
        lambda plan: plan["floors"][0]["rooms"][0].update(area_m2=0),
        lambda plan: plan["floors"][0]["rooms"][0].update(polygon=[[1, 2]]),
        lambda plan: plan["floors"][0]["rooms"][0]["polygon"].append([110, 110]),
        lambda plan: plan["floors"][0]["rooms"][0]["polygon"][0].append(3),
        lambda plan: plan["floors"][0]["rooms"][0]["polygon"][0].__setitem__(0, -1),
    ],
)
def test_schema_rejects_malformed_plan(change):
    schema = json.loads(SCHEMA.read_text())
    plan = json.loads(EXAMPLE.read_text())
    change(plan)
    assert list(Draft202012Validator(schema).iter_errors(plan))


def test_schema_accepts_multiple_floors_without_discarding_data():
    schema = json.loads(SCHEMA.read_text())
    plan = json.loads(EXAMPLE.read_text())
    upstairs = copy.deepcopy(plan["floors"][0])
    upstairs.update(id="og", name="Obergeschoss")
    for room in upstairs["rooms"]:
        room["id"] = room["id"].replace("eg_", "og_")
    plan["floors"].append(upstairs)
    Draft202012Validator(schema).validate(plan)
    assert len(plan["floors"]) == 2


def test_schema_accepts_empty_floor_after_last_room_is_deleted():
    schema = json.loads(SCHEMA.read_text())
    plan = json.loads(EXAMPLE.read_text())
    plan["floors"][0]["rooms"] = []
    Draft202012Validator(schema).validate(plan)
    assert plan["schema_version"] == "1.1"
