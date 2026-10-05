"""Verify the traced plan's shared zones without deriving invented room areas."""

import json
import math
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

DATA = (
    Path(__file__).resolve().parents[1]
    / "custom_components/heizlast_ha/planning-data.json"
)


def test_heating_design_temperatures_have_neutral_source_without_emitter_assumptions():
    data = json.loads(DATA.read_text())
    heating = data["underfloor_heating"]
    assert heating == {
        "design_supply_temperature_c": 35,
        "design_return_temperature_c": 28,
    }
    assert data["sources"]["heating"] == {
        "document": "EnEV-Nachweis",
        "pages": [8, 10],
    }
    supply = heating["design_supply_temperature_c"]
    return_temperature = heating["design_return_temperature_c"]
    assert math.isfinite(supply) and math.isfinite(return_temperature)
    assert supply - return_temperature == 7
    assert (
        supply > return_temperature > max(zone["temperature"] for zone in data["zones"])
    )
    # Active floor area and a room-specific emitter curve are not documented.
    assert not any("underfloor_heating" in zone for zone in data["zones"])


def test_documented_design_temperature_has_neutral_source_and_valid_zone_deltas():
    data = json.loads(DATA.read_text())
    outdoor_temperature = data["building"]["design_outdoor_temperature_c"]
    assert outdoor_temperature == -12.2
    assert data["sources"]["climate"] == {
        "document": "Heizlastberechnung",
        "page": 2,
        "sheet": "G1",
    }
    assert len(data["zones"]) == 11
    for zone in data["zones"]:
        design_delta = zone["temperature"] - outdoor_temperature
        assert math.isfinite(design_delta) and design_delta > 0, zone["id"]
    assert {zone["temperature"] - outdoor_temperature for zone in data["zones"]} == {
        34.2,
        36.2,
    }


def test_solar_factors_match_the_documented_transparent_component_calculation():
    data = json.loads(DATA.read_text())
    assumptions = data["solar_assumptions"]
    expected = {
        "glazing_fraction": 0.70,
        "g_value": 0.50,
        "shading_factor": 0.90,
        "sun_protection_factor": 1.00,
        "incidence_factor": 0.90,
    }
    assert {key: assumptions[key] for key in expected} == expected
    assert all(math.isfinite(value) and 0 < value <= 1 for value in expected.values())
    assert assumptions["window_tilt_deg"] == 90
    assert data["sources"]["solar"] == {
        "document": "EnEV-Nachweis",
        "pages": [5, 6],
        "section": "5.3",
    }
    # The source's south-facing example applies glass, shading and incidence once.
    assert 23.30 * math.prod(expected.values()) == pytest.approx(6.61, abs=0.005)
    assert "Bauteilflächen, keine Netto-Glasflächen" in data["notes"]["solar"]


def test_zone_window_areas_match_both_documented_facade_totals_and_orientations():
    data = json.loads(DATA.read_text())
    areas = {}
    for zone in data["zones"]:
        windows = zone["solar_windows"]
        assert len({window["orientation"] for window in windows}) == len(windows)
        assert all(
            window["orientation"] in {"N", "E", "S", "W"}
            and math.isfinite(window["area_m2"])
            and window["area_m2"] > 0
            for window in windows
        )
        areas[zone["id"]] = {
            window["orientation"]: window["area_m2"] for window in windows
        }
    assert areas == {
        1: {"N": 0.8626},
        2: {"N": 1.50388},
        3: {"N": 0.8626},
        4: {"N": 2.706975},
        5: {"W": 4.1408, "S": 14.9778, "E": 3.31648},
        6: {"N": 0.8626, "W": 4.092},
        7: {"N": 1.50388, "E": 1.007},
        8: {},
        9: {"W": 4.092, "S": 2.332},
        10: {"S": 3.657},
        11: {"S": 2.332, "E": 1.50388},
    }
    documented = data["solar_assumptions"]["facade_areas_m2"]
    assert documented == {"N": 8.30, "E": 5.83, "S": 23.30, "W": 12.33}
    for orientation, expected in documented.items():
        assert sum(
            area.get(orientation, 0) for area in areas.values()
        ) == pytest.approx(expected, abs=0.02)
    assert sum(sum(area.values()) for area in areas.values()) == pytest.approx(49.7535)
    assert sum(documented.values()) == pytest.approx(49.76)


def test_transparent_door_inclusion_and_derived_west_window_are_explicit():
    data = json.loads(DATA.read_text())
    zone = next(zone for zone in data["zones"] if zone["id"] == 5)
    areas = {
        window["orientation"]: window["area_m2"] for window in zone["solar_windows"]
    }
    assert areas["W"] == pytest.approx(0.76 * 2.38 + 1.76 * 1.325)
    assert areas["S"] == pytest.approx(2.76 * 2.385 + 2 * 1.76 * 2.385)
    # The source rounds the eastern wall's deduction to five decimal places.
    assert areas["E"] == pytest.approx(0.76 * 2.385 + 1.135 * 1.325, abs=0.00001)
    # The separately listed entrance door is excluded from zone 4's glazing.
    assert next(zone for zone in data["zones"] if zone["id"] == 4)["solar_windows"] == [
        {"orientation": "N", "area_m2": 2.706975}
    ]
    assert "keine eigene Orientierungsangabe" in data["notes"]["solar"]
    assert "West ist aus der Abzugsfläche" in data["notes"]["solar"]


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
