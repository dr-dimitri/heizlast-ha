"""Verify the traced plan's shared zones without deriving invented room areas."""

import json
from pathlib import Path

import pytest
from shapely.geometry import Polygon

DATA = (
    Path(__file__).resolve().parents[1]
    / "custom_components/heizlast_ha/planning-data.json"
)


def test_documented_floor_totals_and_shared_zone_areas():
    data = json.loads(DATA.read_text())
    zones = {zone["id"]: zone for zone in data["zones"]}
    assert set(zones) == set(range(1, 12))
    assert {zone["floor"] for zone in zones.values()} == {"EG", "OG"}
    assert data["building"]["heat_load_w"] == 5989
    assert data["room_heat_load_sum_w"] == 7354.5
    assert sum(zone["load"] for zone in zones.values()) == pytest.approx(7354.55)
    for floor, area, load in [("EG", 91.22, 3886.77), ("OG", 92.90, 3467.78)]:
        group = [zone for zone in zones.values() if zone["floor"] == floor]
        assert sum(zone["area"] for zone in group) == pytest.approx(area)
        assert sum(zone["load"] for zone in group) == pytest.approx(load)
    for identifier, names in [
        (4, {"Gard.", "Diele"}),
        (5, {"Wohnen", "Essen", "Küche"}),
        (6, {"Schlafen", "Ankleide"}),
    ]:
        members = [shape for shape in data["shapes"] if shape["zone"] == identifier]
        assert {shape["name"] for shape in members} == names
        assert sum(shape["area"] for shape in members) == pytest.approx(
            zones[identifier]["area"]
        )


def test_open_zones_have_single_boundary_and_bad_remains_uncertain():
    data = json.loads(DATA.read_text())
    assert len(data["shapes"]) == 15
    for identifier, count in [(4, 1), (5, 1), (6, 2)]:
        members = [shape for shape in data["shapes"] if shape["zone"] == identifier]
        assert sum(shape["poly"] is not None for shape in members) == count
    bad = next(zone for zone in data["zones"] if zone["id"] == 7)
    assert bad["uncertain"] is True
    assert bad["area"] == 12.74
    assert bad["load"] == 641.59
    assert next(shape for shape in data["shapes"] if shape["zone"] == 7)["area"] is None
    assert [zone["id"] for zone in data["zones"] if zone["uncertain"]] == [7]


def test_contours_fit_their_floor_without_metric_area_inference():
    data = json.loads(DATA.read_text())
    for shape in data["shapes"]:
        x, y, max_x, max_y = data["floors"][shape["floor"]]["bounds"]
        assert x <= shape["center"][0] <= max_x
        assert y <= shape["center"][1] <= max_y
        if shape["poly"] is None:
            continue
        polygon = Polygon(shape["poly"])
        assert polygon.is_valid and polygon.area > 0
        assert all(
            x <= point[0] <= max_x and y <= point[1] <= max_y for point in shape["poly"]
        )
