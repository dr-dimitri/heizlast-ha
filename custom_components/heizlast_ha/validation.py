"""Validate the interchange format and geometry before changing project data."""

import json
import math
from collections.abc import Callable, Mapping
from copy import deepcopy
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from shapely import Polygon, STRtree
from shapely.errors import GEOSException
from shapely.validation import explain_validity

type JsonObject = dict[str, Any]
GEOMETRY_EPSILON = 1e-7


class ProjectError(ValueError):
    """A user-correctable project error with a websocket error code."""

    def __init__(self, message: str, code: str = "invalid_project") -> None:
        """Initialize the error."""
        super().__init__(message)
        self.code = code


def load_validator() -> Draft202012Validator:
    """Load the bundled, shared JSON Schema outside the event loop."""
    path = Path(__file__).with_name("floorplan-v1.schema.json")
    schema = json.loads(path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def room_ids(plan: JsonObject | None) -> set[str]:
    """Return all stable room IDs in a validated plan."""
    if plan is None:
        return set()
    return {room["id"] for floor in plan["floors"] for room in floor["rooms"]}


def _check_finite(value: Any, field: str = "plan") -> None:
    """Reject NaN and infinity, including Python's nonstandard JSON values."""
    if isinstance(value, float) and not math.isfinite(value):
        raise ProjectError(f"{field}: Die Zahl muss endlich sein.")
    if isinstance(value, dict):
        for key, item in value.items():
            _check_finite(item, f"{field}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _check_finite(item, f"{field}[{index}]")


def validate_plan(
    plan: Any,
    validator: Draft202012Validator,
) -> JsonObject | None:
    """Validate self-contained room geometry within the declared canvas."""
    if plan is None:
        return None
    _check_finite(plan)
    errors = sorted(validator.iter_errors(plan), key=lambda err: str(err.json_path))
    if errors:
        error = errors[0]
        raise ProjectError(f"{error.json_path}: {error.message}")

    seen: set[str] = set()
    for floor in plan["floors"]:
        field = f"Etage {floor['id']}"
        _check_id_and_name(floor, seen, field)
        width, height = floor["canvas"]["width"], floor["canvas"]["height"]
        polygons: list[Polygon] = []
        rooms = floor["rooms"]
        for room in rooms:
            room_field = f"{field}, Raum {room['id']}"
            _check_id_and_name(room, seen, room_field)
            points = room["polygon"]
            if len({tuple(point) for point in points}) < 3:
                raise ProjectError(
                    f"{room_field}.polygon: Mindestens drei verschiedene Punkte nötig."
                )
            if any(not (0 <= x <= width and 0 <= y <= height) for x, y in points):
                raise ProjectError(
                    f"{room_field}.polygon: Ein Punkt liegt "
                    "außerhalb der Zeichenfläche."
                )
            polygon = Polygon(points)
            if not polygon.is_valid or polygon.area <= GEOMETRY_EPSILON:
                raise ProjectError(
                    f"{room_field}.polygon: Ungültige Raumfläche "
                    f"({explain_validity(polygon)}); keine Selbstüberschneidung oder "
                    "Fläche von null erlaubt."
                )
            polygons.append(polygon)

        # The spatial index avoids comparing every pair in large floor plans.
        tree = STRtree(polygons)
        for index, polygon in enumerate(polygons):
            for other_index in tree.query(polygon, predicate="intersects"):
                if other_index <= index:
                    continue
                try:
                    overlap = polygon.intersection(polygons[other_index]).area
                except GEOSException as err:
                    raise ProjectError(f"{field}: Ungültige Raumgeometrie.") from err
                if overlap > GEOMETRY_EPSILON:
                    raise ProjectError(
                        f"{field}: Die Räume {rooms[index]['id']} und "
                        f"{rooms[other_index]['id']} überlappen sich flächig."
                    )
    return deepcopy(plan)


def _check_id_and_name(item: JsonObject, seen: set[str], field: str) -> None:
    """Require globally unique identifiers and visible display names."""
    if item["id"] in seen:
        raise ProjectError(f"{field}.id: Doppelte ID {item['id']}.")
    seen.add(item["id"])
    if not item["name"].strip():
        raise ProjectError(f"{field}.name: Bitte einen Namen angeben.")


def validate_bindings(
    plan: JsonObject | None,
    bindings: Any,
    previous: JsonObject,
    is_temperature_sensor: Callable[[str], bool],
) -> dict[str, list[str]]:
    """Validate new selections and preserve omitted bindings for stable room IDs."""
    if not isinstance(bindings, dict):
        raise ProjectError("bindings: Sensorzuordnungen müssen ein Objekt sein.")
    ids = room_ids(plan)
    for key in bindings:
        if key not in ids:
            raise ProjectError(f"bindings.{key}: Der Raum ist nicht im Grundriss.")
    result: dict[str, list[str]] = {}
    for room_id in ids:
        selected = bindings.get(room_id, previous.get(room_id, []))
        if not isinstance(selected, list) or len(selected) > 100:
            raise ProjectError(f"bindings.{room_id}: Höchstens 100 Sensoren erlaubt.")
        checked: list[str] = []
        for entity_id in selected:
            if not isinstance(entity_id, str) or not entity_id.startswith("sensor."):
                raise ProjectError(f"bindings.{room_id}: Ungültige Sensor-ID.")
            if entity_id in checked:
                raise ProjectError(
                    f"bindings.{room_id}: Doppelte Sensor-ID {entity_id}."
                )
            if entity_id not in previous.get(room_id, []) and not is_temperature_sensor(
                entity_id
            ):
                raise ProjectError(
                    f"bindings.{room_id}: {entity_id} ist kein vorhandener "
                    "Sensor mit Temperatur-Geräteklasse."
                )
            checked.append(entity_id)
        result[room_id] = checked
    return result


def validate_removals(
    previous_plan: JsonObject | None,
    plan: JsonObject | None,
    confirmed: Any,
) -> None:
    """Do not drop stable room IDs without explicit import confirmation."""
    if not isinstance(confirmed, list) or any(
        not isinstance(item, str) for item in confirmed
    ):
        raise ProjectError("confirmed_removed_room_ids: Eine Liste von IDs ist nötig.")
    removed = room_ids(previous_plan) - room_ids(plan)
    if removed - set(confirmed):
        missing = ", ".join(sorted(removed - set(confirmed)))
        raise ProjectError(
            f"Entfernte Raum-IDs zuerst ausdrücklich bestätigen: {missing}.",
            "confirmation_required",
        )


def is_temperature_state(entity_id: str, state: Any) -> bool:
    """Check a real Home Assistant state without depending on its concrete class."""
    return (
        entity_id.startswith("sensor.")
        and state is not None
        and isinstance(state.attributes, Mapping)
        and state.attributes.get("device_class") == "temperature"
    )
