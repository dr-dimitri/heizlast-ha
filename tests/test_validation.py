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
    validate_room_operations,
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


def test_empty_floor_preserves_canvas_and_drops_deleted_room_bindings(plan, validator):
    previous = deepcopy(plan)
    plan["floors"][0]["rooms"] = []
    assert validate_plan(plan, validator) == plan
    with pytest.raises(ProjectError, match="eg_links, eg_rechts") as error:
        validate_removals(previous, plan, [])
    assert error.value.code == "confirmation_required"
    validate_removals(previous, plan, ["eg_links", "eg_rechts"])
    assert (
        validate_bindings(plan, {}, {"eg_links": ["sensor.deleted"]}, lambda _: False)
        == {}
    )


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


@pytest.mark.parametrize("target_id", ["eg_links", "eg_combined"])
def test_removed_room_sensors_can_be_transferred_without_current_state(plan, target_id):
    """Previously assigned sensors survive a merge even after disappearing in HA."""
    plan["floors"][0]["rooms"].pop()
    plan["floors"][0]["rooms"][0]["id"] = target_id
    previous = {"eg_rechts": ["sensor.deleted", "sensor.changed"]}
    assert validate_bindings(
        plan,
        {target_id: ["sensor.deleted", "sensor.changed"]},
        previous,
        lambda _: False,
    ) == {target_id: ["sensor.deleted", "sensor.changed"]}
    with pytest.raises(ProjectError, match="sensor.unknown.*Temperatur"):
        validate_bindings(
            plan, {target_id: ["sensor.unknown"]}, previous, lambda _: False
        )


def split_plan(plan, *, corrected=False):
    """Split the left room horizontally, optionally after a contour correction."""
    revised = deepcopy(plan)
    source = revised["floors"][0]["rooms"][0]
    left = 5 if corrected else 0
    original = [[left, 0], [50, 0], [50, 100], [left, 100]]
    retained = [[left, 0], [50, 0], [50, 50], [left, 50]]
    created = [[left, 50], [50, 50], [50, 100], [left, 100]]
    source.update(polygon=retained, area_m2=None)
    revised["floors"][0]["rooms"].append(
        {"id": "eg_neu", "name": "Neu", "polygon": created, "area_m2": None}
    )
    return revised, {
        "kind": "split",
        "floor_id": "eg",
        "source_room_id": "eg_links",
        "created_room_id": "eg_neu",
        "source_polygon": original,
        "retained_polygon": retained,
        "created_polygon": created,
    }


@pytest.mark.parametrize("corrected", [False, True])
def test_verified_split_preserves_only_source_sensors(plan, validator, corrected):
    revised, operation = split_plan(plan, corrected=corrected)
    previous = {
        "eg_links": ["sensor.deleted", "sensor.changed"],
        "eg_rechts": ["sensor.unrelated"],
    }
    inherited = validate_room_operations(
        plan, revised, previous, [operation], validator
    )
    bindings = {
        "eg_links": ["sensor.deleted"],
        "eg_neu": ["sensor.deleted", "sensor.changed"],
    }
    result = validate_bindings(revised, bindings, previous, lambda _: False, inherited)
    assert result["eg_neu"] == ["sensor.deleted", "sensor.changed"]
    assert result["eg_links"] == ["sensor.deleted"]
    with pytest.raises(ProjectError, match="Temperatur"):
        validate_bindings(
            revised,
            {"eg_neu": ["sensor.unrelated"]},
            previous,
            lambda _: False,
            inherited,
        )


def test_new_drawn_room_split_does_not_authorize_historical_sensors(plan, validator):
    revised, operation = split_plan(plan)
    revised["floors"][0]["id"] = "og"
    revised["floors"][0]["rooms"][0]["id"] = "eg_gezeichnet"
    revised["floors"][0]["rooms"][1]["id"] = "og_rechts"
    revised["floors"].append(deepcopy(plan["floors"][0]))
    operation["floor_id"] = "og"
    operation["source_room_id"] = "eg_gezeichnet"
    inherited = validate_room_operations(
        plan, revised, {"eg_links": ["sensor.deleted"]}, [operation], validator
    )
    assert inherited["eg_neu"] == set()
    with pytest.raises(ProjectError, match="Temperatur"):
        validate_bindings(
            revised,
            {"eg_neu": ["sensor.deleted"]},
            {"eg_links": ["sensor.deleted"]},
            lambda _: False,
            inherited,
        )


@pytest.mark.parametrize(
    "change",
    [
        lambda proof: proof.update(created_room_id="eg_rechts"),
        lambda proof: proof.update(created_room_id="eg"),
        lambda proof: proof.update(created_room_id="Invalid Room"),
        lambda proof: proof.update(kind=["split"]),
        lambda proof: proof.update(unexpected=True),
        lambda proof: proof.update(
            created_polygon=[[0, 49], [50, 49], [50, 100], [0, 100]]
        ),
        lambda proof: proof.update(
            created_polygon=[[0, 51], [50, 51], [50, 100], [0, 100]]
        ),
        lambda proof: proof["source_polygon"][0].__setitem__(0, math.nan),
        lambda proof: proof["source_polygon"][0].__setitem__(0, -1),
    ],
)
def test_invalid_split_proofs_are_rejected(plan, validator, change):
    revised, operation = split_plan(plan)
    change(operation)
    with pytest.raises(ProjectError):
        validate_room_operations(
            plan, revised, {"eg_links": ["sensor.deleted"]}, [operation], validator
        )


def test_non_straight_split_proof_is_rejected(plan, validator):
    revised, operation = split_plan(plan)
    operation.update(
        retained_polygon=[[0, 0], [25, 0], [30, 50], [25, 100], [0, 100]],
        created_polygon=[[25, 0], [50, 0], [50, 100], [25, 100], [30, 50]],
    )
    with pytest.raises(ProjectError, match="Schnittlinie"):
        validate_room_operations(plan, revised, {}, [operation], validator)


def test_chained_splits_then_merge_and_delete_keep_sensor_lineage(plan, validator):
    revised, first = split_plan(plan)
    second = {
        "kind": "split",
        "floor_id": "eg",
        "source_room_id": "eg_neu",
        "created_room_id": "eg_dritter",
        "source_polygon": first["created_polygon"],
        "retained_polygon": [[0, 50], [25, 50], [25, 100], [0, 100]],
        "created_polygon": [[25, 50], [50, 50], [50, 100], [25, 100]],
    }
    combined = [[25, 50], [50, 50], [50, 0], [100, 0], [100, 100], [25, 100]]
    merge = {
        "kind": "merge",
        "floor_id": "eg",
        "source_room_ids": ["eg_rechts", "eg_dritter"],
        "source_polygons": [
            plan["floors"][0]["rooms"][1]["polygon"],
            second["created_polygon"],
        ],
        "result_polygon": combined,
    }
    # The other new child was deleted after the split; it needs no sensor grant.
    revised["floors"][0]["rooms"].pop()
    revised["floors"][0]["rooms"][1]["polygon"] = combined
    previous = {"eg_links": ["sensor.deleted"], "eg_rechts": ["sensor.other"]}
    inherited = validate_room_operations(
        plan, revised, previous, [first, second, merge], validator
    )
    assert inherited["eg_rechts"] == {"sensor.deleted", "sensor.other"}
    assert "eg_neu" not in inherited
    assert validate_bindings(
        revised,
        {"eg_rechts": ["sensor.deleted", "sensor.other"]},
        previous,
        lambda _: False,
        inherited,
    )["eg_rechts"] == ["sensor.deleted", "sensor.other"]


@pytest.mark.parametrize("gap", [0, 2, 20])
def test_merge_proof_matches_shared_edges_and_bounded_wall_gaps(plan, validator, gap):
    revised = deepcopy(plan)
    revised["floors"][0]["rooms"].pop()
    first = plan["floors"][0]["rooms"][0]["polygon"]
    second = [[50 + gap, 0], [100, 0], [100, 100], [50 + gap, 100]]
    result = [[0, 0], [100, 0], [100, 100], [0, 100]]
    revised["floors"][0]["rooms"][0]["polygon"] = result
    operation = {
        "kind": "merge",
        "floor_id": "eg",
        "source_room_ids": ["eg_links", "eg_rechts"],
        "source_polygons": [first, second],
        "result_polygon": result,
    }
    if gap == 20:
        with pytest.raises(ProjectError, match="Verbindung"):
            validate_room_operations(plan, revised, {}, [operation], validator)
    else:
        inherited = validate_room_operations(
            plan, revised, {"eg_rechts": ["sensor.deleted"]}, [operation], validator
        )
        assert inherited["eg_links"] == {"sensor.deleted"}


def test_retired_merge_id_cannot_be_recreated_to_inherit_sensors(plan, validator):
    revised, operation = split_plan(plan)
    combined = plan["floors"][0]["rooms"][0]["polygon"]
    merge = {
        "kind": "merge",
        "floor_id": "eg",
        "source_room_ids": ["eg_links", "eg_neu"],
        "source_polygons": [
            operation["retained_polygon"],
            operation["created_polygon"],
        ],
        "result_polygon": combined,
    }
    with pytest.raises(ProjectError, match="Entfernte Raum-IDs"):
        validate_room_operations(plan, revised, {}, [operation, merge], validator)


def test_operation_limits_and_undo_snapshot_revoke_grants(plan, validator):
    revised, operation = split_plan(plan)
    previous = {"eg_links": ["sensor.deleted"]}
    assert validate_room_operations(plan, plan, previous, [], validator) == {}
    assert validate_room_operations(plan, None, previous, [operation], validator) == {}
    with pytest.raises(ProjectError, match="1000"):
        validate_room_operations(plan, revised, previous, [operation] * 1001, validator)
    with pytest.raises(ProjectError, match="Temperatur"):
        validate_bindings(
            revised, {"eg_neu": ["sensor.deleted"]}, previous, lambda _: False
        )


def test_canvas_and_child_contours_can_change_after_verified_split(plan, validator):
    revised, operation = split_plan(plan)
    for room in revised["floors"][0]["rooms"]:
        room["polygon"] = [[x / 2, y / 2] for x, y in room["polygon"]]
    revised["floors"][0]["canvas"] = {"width": 50, "height": 50}
    validate_plan(revised, validator)
    assert validate_room_operations(
        plan, revised, {"eg_links": ["sensor.deleted"]}, [operation], validator
    )["eg_neu"] == {"sensor.deleted"}


def test_proof_cannot_transfer_historical_sensors_across_floors(plan, validator):
    revised, operation = split_plan(plan)
    upstairs = deepcopy(plan["floors"][0])
    upstairs.update(id="og", rooms=[])
    revised["floors"].append(upstairs)
    operation["floor_id"] = "og"
    with pytest.raises(ProjectError, match="selben Geschoss"):
        validate_room_operations(plan, revised, {}, [operation], validator)


def test_unknown_deleted_floor_never_grants_historical_sensors(plan, validator):
    revised, operation = split_plan(plan)
    operation["floor_id"] = "deleted"
    inherited = validate_room_operations(
        plan, revised, {"eg_links": ["sensor.deleted"]}, [operation], validator
    )
    assert "eg_neu" not in inherited
    with pytest.raises(ProjectError, match="Temperatur"):
        validate_bindings(
            revised,
            {"eg_neu": ["sensor.deleted"]},
            {"eg_links": ["sensor.deleted"]},
            lambda _: False,
            inherited,
        )


@pytest.mark.parametrize("floor_id", ["eg", "deleted"])
def test_operation_vertex_budget_prevents_excessive_geometry_work(
    plan, validator, floor_id
):
    revised, operation = split_plan(plan)
    operation["floor_id"] = floor_id
    operation["source_polygon"] = [[0, 0]] * 25001
    with pytest.raises(ProjectError, match="25000"):
        validate_room_operations(plan, revised, {}, [operation], validator)


@pytest.mark.parametrize(
    ("source", "retained", "created"),
    [
        (
            [[10, 10], [210, 10], [210, 110], [10, 110]],
            [[10, 10], [210, 10], [210, 110]],
            [[210, 110], [10, 110], [10, 10]],
        ),
        (
            [[100, 0], [200, 100], [100, 200], [0, 100]],
            [[150, 50], [200, 100], [100, 200], [50, 150]],
            [[50, 150], [0, 100], [100, 0], [150, 50]],
        ),
        (
            [[10, 10], [230, 30], [210, 210], [0, 180]],
            [
                [103.6, 194.8],
                [0, 180],
                [10, 10],
                [128.11475409836066, 20.73770491803279],
            ],
            [
                [128.11475409836066, 20.73770491803279],
                [230, 30],
                [210, 210],
                [103.6, 194.8],
            ],
        ),
        (
            [
                [0, 0],
                [300, 0],
                [300, 300],
                [200, 300],
                [200, 100],
                [100, 100],
                [100, 300],
                [0, 300],
            ],
            [
                [300, 50],
                [300, 300],
                [200, 300],
                [200, 100],
                [100, 100],
                [100, 300],
                [0, 300],
                [0, 50],
            ],
            [[0, 50], [0, 0], [300, 0], [300, 50]],
        ),
    ],
    ids=["diagonal", "diamond", "fractional-skew", "concave"],
)
def test_real_frontend_split_outputs_are_valid_backend_proofs(
    validator, source, retained, created
):
    """Keep actual TypeScript output compatible with the Shapely verifier."""
    previous = {
        "schema_version": "1.1",
        "floors": [
            {
                "id": "eg",
                "name": "EG",
                "canvas": {"width": 300, "height": 300},
                "rooms": [
                    {"id": "source", "name": "Raum", "polygon": source, "area_m2": None}
                ],
            }
        ],
    }
    plan = deepcopy(previous)
    plan["floors"][0]["rooms"][0]["polygon"] = retained
    plan["floors"][0]["rooms"].append(
        {"id": "created", "name": "Teilraum", "polygon": created, "area_m2": None}
    )
    operation = {
        "kind": "split",
        "floor_id": "eg",
        "source_room_id": "source",
        "created_room_id": "created",
        "source_polygon": source,
        "retained_polygon": retained,
        "created_polygon": created,
    }
    validate_plan(plan, validator)
    assert validate_room_operations(
        previous, plan, {"source": ["sensor.old"]}, [operation], validator
    )["created"] == {"sensor.old"}


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
