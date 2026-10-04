"""Tests for authoritative backend schema, standalone geometry, and sensors."""

import math
from copy import deepcopy

import pytest
from homeassistant.core import State

from custom_components.heizlast_ha.validation import (
    ProjectError,
    is_temperature_state,
    load_validator,
    validate_bindings,
    validate_plan,
    validate_removals,
)


@pytest.fixture
def validator():
    """Use the exact installed interchange schema."""
    return load_validator()


@pytest.fixture
def plan():
    """Two adjacent rooms with a shared boundary and no positive overlap."""
    return {
        "schema_version": "1.1",
        "floors": [
            {
                "id": "eg",
                "name": "Erdgeschoss",
                "canvas": {"width": 100, "height": 100},
                "rooms": [
                    {
                        "id": "eg_links",
                        "name": "Links",
                        "polygon": [[0, 0], [50, 0], [50, 100], [0, 100]],
                        "area_m2": None,
                    },
                    {
                        "id": "eg_rechts",
                        "name": "Rechts",
                        "polygon": [[50, 0], [100, 0], [100, 100], [50, 100]],
                        "area_m2": 21.5,
                    },
                ],
            }
        ],
    }


def test_plan_is_validated_and_copied(plan, validator):
    """Shared room edges are valid, and caller mutations cannot affect saved plans."""
    checked = validate_plan(plan, validator)
    assert checked == plan
    checked["floors"][0]["rooms"][0]["name"] = "Bearbeitet"
    assert plan["floors"][0]["rooms"][0]["name"] == "Links"


@pytest.mark.parametrize("version", ["0.1", "1.0", "2.0", 1.0, None])
def test_unsupported_schema_versions(plan, validator, version):
    plan["schema_version"] = version
    with pytest.raises(ProjectError, match="schema_version"):
        validate_plan(plan, validator)


@pytest.mark.parametrize("coordinate", [math.nan, math.inf, -math.inf, -1, 101, True])
def test_invalid_coordinates(plan, validator, coordinate):
    plan["floors"][0]["rooms"][0]["polygon"][0][0] = coordinate
    with pytest.raises(ProjectError):
        validate_plan(plan, validator)


@pytest.mark.parametrize(
    "polygon",
    [
        [[0, 0], [0, 0], [50, 50]],
        [[0, 0], [10, 10], [20, 20]],
        [[0, 0], [50, 50], [0, 50], [50, 0]],
        [[0, 0], [50, 0], [0, 50], [0, 0]],
        [[0, 0], [0.00001, 0], [0, 0.00001]],
    ],
)
def test_invalid_or_degenerate_polygons(plan, validator, polygon):
    plan["floors"][0]["rooms"][0]["polygon"] = polygon
    with pytest.raises(ProjectError):
        validate_plan(plan, validator)


def test_contained_room_overlap_is_rejected(plan, validator):
    """Containment must be rejected as well as crossing room boundaries."""
    plan["floors"][0]["rooms"][1]["polygon"] = [[10, 10], [30, 10], [30, 30], [10, 30]]
    with pytest.raises(ProjectError, match="eg_links.*eg_rechts.*überlappen"):
        validate_plan(plan, validator)


def test_identical_room_overlap_is_rejected(plan, validator):
    """Equal polygons have positive overlap although edges only coincide."""
    plan["floors"][0]["rooms"][1]["polygon"] = deepcopy(
        plan["floors"][0]["rooms"][0]["polygon"]
    )
    with pytest.raises(ProjectError, match="überlappen"):
        validate_plan(plan, validator)


def test_crossing_room_overlap_is_rejected(plan, validator):
    plan["floors"][0]["rooms"][1]["polygon"] = [[40, 20], [60, 20], [60, 80], [40, 80]]
    with pytest.raises(ProjectError, match="überlappen"):
        validate_plan(plan, validator)


def test_concave_non_overlapping_rooms_are_valid(plan, validator):
    """A room may wrap around another one without their interiors intersecting."""
    plan["floors"][0]["rooms"][0]["polygon"] = [
        [0, 0],
        [50, 0],
        [50, 10],
        [10, 10],
        [10, 50],
        [0, 50],
    ]
    plan["floors"][0]["rooms"][1]["polygon"] = [[20, 20], [40, 20], [40, 40], [20, 40]]
    assert validate_plan(plan, validator) == plan


def test_multiple_floors_preserve_all_rooms(plan, validator):
    upper = deepcopy(plan["floors"][0])
    upper.update(id="og", name="Obergeschoss")
    for room in upper["rooms"]:
        room["id"] = room["id"].replace("eg_", "og_")
    plan["floors"].append(upper)
    assert validate_plan(plan, validator) == plan


@pytest.mark.parametrize("duplicate", ["room", "floor", "cross_floor", "floor_room"])
def test_ids_are_globally_unique(plan, validator, duplicate):
    if duplicate == "room":
        plan["floors"][0]["rooms"][1]["id"] = "eg_links"
    elif duplicate == "floor_room":
        plan["floors"][0]["rooms"][1]["id"] = "eg"
    else:
        upper = deepcopy(plan["floors"][0])
        upper["id"] = "og" if duplicate == "cross_floor" else "eg"
        plan["floors"].append(upper)
    with pytest.raises(ProjectError, match="Doppelte ID"):
        validate_plan(plan, validator)


def test_canvas_bounds_are_checked_without_an_original_image(plan, validator):
    plan["floors"][0]["canvas"]["width"] = 99
    with pytest.raises(ProjectError, match="außerhalb der Zeichenfläche"):
        validate_plan(plan, validator)


@pytest.mark.parametrize(
    "reference", [None, "/local/plan.png", "https://example.com/plan.png"]
)
def test_image_references_are_not_part_of_the_standalone_format(
    plan, validator, reference
):
    plan["floors"][0]["background"] = reference
    with pytest.raises(ProjectError, match="background"):
        validate_plan(plan, validator)


@pytest.mark.parametrize("name", ["", " ", "\n\t"])
def test_room_names_must_be_visible(plan, validator, name):
    plan["floors"][0]["rooms"][0]["name"] = name
    with pytest.raises(ProjectError):
        validate_plan(plan, validator)


@pytest.mark.parametrize("area", [0, -1, math.nan, math.inf, True])
def test_area_must_be_unknown_or_finite_and_positive(plan, validator, area):
    plan["floors"][0]["rooms"][0]["area_m2"] = area
    with pytest.raises(ProjectError):
        validate_plan(plan, validator)


def test_bindings_preserve_stable_ids_and_later_removed_entities(plan):
    previous = {"eg_links": ["sensor.deleted"]}
    bindings = {"eg_rechts": ["sensor.new"]}
    assert validate_bindings(plan, bindings, previous, lambda _: True) == {
        "eg_links": ["sensor.deleted"],
        "eg_rechts": ["sensor.new"],
    }
    assert (
        validate_bindings(plan, {"eg_links": []}, previous, lambda _: False)["eg_links"]
        == []
    )


@pytest.mark.parametrize(
    "bindings",
    [
        {"unknown_room": []},
        {"eg_links": ["sensor.not_temperature"]},
        {"eg_links": ["light.room"]},
        {"eg_links": [None]},
        {"eg_links": "sensor.foo"},
        {"eg_links": ["sensor.foo", "sensor.foo"]},
    ],
)
def test_invalid_new_bindings(plan, bindings):
    with pytest.raises(ProjectError):
        validate_bindings(plan, bindings, {}, lambda _: False)


def test_existing_entity_cannot_be_moved_to_new_room_without_validation(plan):
    with pytest.raises(ProjectError, match="Temperatur"):
        validate_bindings(
            plan,
            {"eg_rechts": ["sensor.deleted"]},
            {"eg_links": ["sensor.deleted"]},
            lambda _: False,
        )


def test_removal_needs_explicit_confirmation(plan):
    revised = deepcopy(plan)
    revised["floors"][0]["rooms"].pop()
    with pytest.raises(ProjectError, match="eg_rechts") as error:
        validate_removals(plan, revised, [])
    assert error.value.code == "confirmation_required"
    validate_removals(plan, revised, ["eg_rechts"])
    validate_removals(plan, plan, [])


def test_temperature_state_uses_device_class_not_unit_or_numeric_value():
    """Unavailable temperatures remain selectable by their device class."""
    temperature = State("sensor.t", "unavailable", {"device_class": "temperature"})
    assert is_temperature_state("sensor.t", temperature)
    assert not is_temperature_state("sensor.t", None)
    assert not is_temperature_state("sensor.t", State("sensor.t", "23", {}))
    assert not is_temperature_state("number.t", temperature)
