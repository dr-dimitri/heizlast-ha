"""Verify the traced plan's shared zones without deriving invented room areas."""

import json
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

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
        (4, {"Diele"}),
        (5, {"Wohnen und Essen"}),
        (6, {"Schlafzimmer"}),
    ]:
        members = [shape for shape in data["shapes"] if shape["zone"] == identifier]
        assert {shape["name"] for shape in members} == names
        assert sum(shape["area"] for shape in members) == pytest.approx(
            zones[identifier]["area"]
        )


def test_merged_rooms_have_single_boundary_and_bad_is_confirmed():
    data = json.loads(DATA.read_text())
    assert len(data["shapes"]) == 11
    for identifier, count in [(4, 1), (5, 1), (6, 1)]:
        members = [shape for shape in data["shapes"] if shape["zone"] == identifier]
        assert sum(shape["poly"] is not None for shape in members) == count
    bad = next(zone for zone in data["zones"] if zone["id"] == 7)
    assert bad["uncertain"] is False
    assert bad["area"] == 12.74
    assert bad["load"] == 641.59
    bad_shape = next(shape for shape in data["shapes"] if shape["zone"] == 7)
    assert bad_shape["name"] == bad_shape["short"] == "Bad"
    assert bad_shape["area"] is None
    assert not any(zone["uncertain"] for zone in data["zones"])
    for identifier, name in [
        (4, "Diele"),
        (5, "Wohnen und Essen"),
        (6, "Schlafzimmer"),
        (9, "Basti"),
        (11, "Ostzimmer"),
    ]:
        assert (
            next(zone for zone in data["zones"] if zone["id"] == identifier)["name"]
            == name
        )
        assert {
            shape["name"] for shape in data["shapes"] if shape["zone"] == identifier
        } == {name}


def test_living_area_uses_one_label_and_preserves_documented_values():
    data = json.loads(DATA.read_text())
    members = [shape for shape in data["shapes"] if shape["zone"] == 5]
    assert len(members) == 1
    assert members[0]["key"] == "eg_wohnen"
    assert members[0]["area"] == pytest.approx(25.07 + 18.94 + 12.45)
    zone = next(zone for zone in data["zones"] if zone["id"] == 5)
    assert (zone["area"], zone["load"], zone["transmission"], zone["ventilation"]) == (
        56.46,
        2432.26,
        1578.8,
        853.47,
    )
    assert all(shape["poly"] is not None for shape in data["shapes"])


def test_bedroom_join_preserves_both_traced_rooms_and_documented_values():
    data = json.loads(DATA.read_text())
    bedroom = next(shape for shape in data["shapes"] if shape["zone"] == 6)
    assert bedroom["area"] == 26.35
    zone = next(zone for zone in data["zones"] if zone["id"] == 6)
    assert (zone["load"], zone["transmission"], zone["ventilation"]) == (
        917.0,
        537.8,
        379.17,
    )
    original_sleeping = Polygon(
        [
            (15.162, 137.162),
            (169.567, 137.162),
            (169.567, 238.934),
            (173.633, 238.934),
            (173.633, 269.954),
            (169.567, 269.954),
            (169.567, 293.292),
            (15.162, 293.292),
        ]
    )
    original_dressing = box(173.633, 137.162, 300.344, 215.43)
    separating_wall = box(169.567, 137.162, 173.633, 215.43)
    polygon = Polygon(bedroom["poly"])
    assert polygon.equals(
        unary_union([original_sleeping, original_dressing, separating_wall])
    )
    assert polygon.covers(original_sleeping) and polygon.covers(original_dressing)
    assert len(polygon.interiors) == 0
    hall = Polygon(
        next(shape for shape in data["shapes"] if shape["zone"] == 8)["poly"]
    )
    assert polygon.intersection(hall).area == 0
    assert polygon.boundary.intersection(hall.boundary).length == pytest.approx(31.02)


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


def test_room_labels_fit_inside_their_contours_without_covering_stairs():
    data = json.loads(DATA.read_text())
    contours = {
        identifier: unary_union(
            [
                Polygon(shape["poly"])
                for shape in data["shapes"]
                if shape["zone"] == identifier and shape["poly"] is not None
            ]
        )
        for identifier in range(1, 12)
    }
    for floor in ("EG", "OG"):
        labels = []
        stairs = Polygon(data["floors"][floor]["stairs"])
        for shape in data["shapes"]:
            if shape["floor"] != floor:
                continue
            x, y = shape["center"]
            width, height = shape["label_box"]
            assert width >= 80 and height == 30
            label = box(x - width / 2, y - height / 2, x + width / 2, y + height / 2)
            assert contours[shape["zone"]].covers(label), shape["key"]
            assert label.disjoint(stairs), shape["key"]
            assert all(label.disjoint(other) for other in labels), shape["key"]
            labels.append(label)


def test_room_contours_do_not_overlap_other_calculation_zones():
    data = json.loads(DATA.read_text())
    for floor in ("EG", "OG"):
        polygons = [
            Polygon(shape["poly"])
            for shape in data["shapes"]
            if shape["floor"] == floor and shape["poly"] is not None
        ]
        for index, polygon in enumerate(polygons):
            assert all(
                polygon.intersection(other).area == 0 for other in polygons[index + 1 :]
            )
