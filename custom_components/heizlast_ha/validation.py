"""Validate the interchange format and geometry before changing project data."""

import json
import math
from collections.abc import Callable, Iterator, Mapping
from copy import deepcopy
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from shapely import LineString, Point, Polygon, STRtree, line_merge
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
    inherited: Mapping[str, set[str]] | None = None,
) -> dict[str, list[str]]:
    """Validate selections, preserving sensors of stable and confirmed removed rooms."""
    if not isinstance(bindings, dict):
        raise ProjectError("bindings: Sensorzuordnungen müssen ein Objekt sein.")
    ids = room_ids(plan)
    for key in bindings:
        if key not in ids:
            raise ProjectError(f"bindings.{key}: Der Raum ist nicht im Grundriss.")
    transferable = {
        entity_id
        for room_id, entity_ids in previous.items()
        if room_id not in ids
        for entity_id in entity_ids
    }
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
            if (
                entity_id not in previous.get(room_id, [])
                and entity_id not in transferable
                and entity_id not in (inherited or {}).get(room_id, set())
                and not is_temperature_sensor(entity_id)
            ):
                raise ProjectError(
                    f"bindings.{room_id}: {entity_id} ist kein vorhandener "
                    "Sensor mit Temperatur-Geräteklasse."
                )
            checked.append(entity_id)
        result[room_id] = checked
    return result


def validate_room_operations(
    previous_plan: JsonObject | None,
    plan: JsonObject | None,
    previous_bindings: JsonObject,
    operations: Any,
    validator: Draft202012Validator,
) -> dict[str, set[str]]:
    """Replay geometric proofs to authorize only historical split/merge sensors.

    Contour corrections are already allowed for stable IDs, so each operation
    carries its valid input contours. Proofs are request metadata, never stored.
    A new drawn room has no historical assignments; a split inherits its source
    history, and a verified merge carries both histories to the retained ID.
    """
    if not isinstance(operations, list) or len(operations) > 1000:
        raise ProjectError(
            "room_operations: Höchstens 1000 Bearbeitungsschritte erlaubt."
        )
    _check_finite(operations, "room_operations")
    if not operations:
        return {}

    floors = {
        floor["id"]: floor
        for candidate in [previous_plan, plan]
        if candidate
        for floor in candidate["floors"]
    }
    nodes: dict[str, tuple[str, set[str]]] = {
        room["id"]: (floor["id"], set(previous_bindings.get(room["id"], [])))
        for floor in (previous_plan or {}).get("floors", [])
        for room in floor["rooms"]
    }
    used = set(nodes) | set(floors)
    retired: set[str] = set()
    vertices = 0
    for index, operation in enumerate(operations):
        field = f"room_operations[{index}]"
        if not isinstance(operation, dict):
            raise ProjectError(
                f"{field}: Ein Bearbeitungsschritt muss ein Objekt sein."
            )
        kind = operation.get("kind")
        required = (
            {
                "kind",
                "floor_id",
                "source_room_id",
                "created_room_id",
                "source_polygon",
                "retained_polygon",
                "created_polygon",
            }
            if kind == "split"
            else {
                "kind",
                "floor_id",
                "source_room_ids",
                "source_polygons",
                "result_polygon",
            }
        )
        if (
            not isinstance(kind, str)
            or kind not in {"split", "merge"}
            or set(operation) != required
        ):
            raise ProjectError(
                f"{field}: Ungültiger Teilungs- oder Verbindungsnachweis."
            )
        if kind == "split":
            proof_polygons = [
                operation["source_polygon"],
                operation["retained_polygon"],
                operation["created_polygon"],
            ]
        else:
            inputs = operation["source_polygons"]
            if not isinstance(inputs, list) or len(inputs) != 2:
                raise ProjectError(f"{field}: Genau zwei Quellkonturen nötig.")
            proof_polygons = [*inputs, operation["result_polygon"]]
        if any(not isinstance(points, list) for points in proof_polygons):
            raise ProjectError(f"{field}: Raumkonturen müssen Punktlisten sein.")
        vertices += sum(len(points) for points in proof_polygons)
        if vertices > 25000:
            raise ProjectError(f"{field}: Höchstens 25000 Nachweispunkte erlaubt.")
        floor_id = operation["floor_id"]
        if not isinstance(floor_id, str):
            raise ProjectError(f"{field}.floor_id: Eine Geschoss-ID ist erforderlich.")
        # A newly created floor may have been entirely deleted again. It has no
        # historical assignments, and absent final outputs receive no grants.
        if floor_id not in floors:
            continue
        floor = floors[floor_id]

        def source(
            room_id: Any, floor_id: str = floor_id, field: str = field
        ) -> set[str]:
            if not isinstance(room_id, str):
                raise ProjectError(f"{field}: Eine Raum-ID ist erforderlich.")
            if room_id not in nodes:
                if room_id in used:
                    raise ProjectError(
                        f"{field}: Die Raum-ID {room_id} wurde entfernt."
                    )
                nodes[room_id] = (floor_id, set())
                used.add(room_id)
            source_floor, sensors = nodes[room_id]
            if source_floor != floor_id:
                raise ProjectError(f"{field}: Räume müssen im selben Geschoss liegen.")
            return sensors

        def polygon(
            points: Any,
            room_id: str,
            floor: JsonObject = floor,
            floor_id: str = floor_id,
            field: str = field,
        ) -> Polygon:
            proof = {
                "schema_version": "1.1",
                "floors": [
                    {
                        "id": floor_id,
                        "name": floor["name"],
                        # Canvas sizes may have changed after the operation;
                        # validate proof snapshots against the format bounds.
                        # The final plan was already checked against its canvas.
                        "canvas": {"width": 8192, "height": 8192},
                        "rooms": [
                            {
                                "id": room_id,
                                "name": "Bearbeitungsnachweis",
                                "polygon": points,
                                "area_m2": None,
                            }
                        ],
                    }
                ],
            }
            try:
                validate_plan(proof, validator)
            except ProjectError as err:
                raise ProjectError(f"{field}: {err}") from err
            return Polygon(points)

        try:
            if kind == "split":
                source_id = operation["source_room_id"]
                sensors = source(source_id)
                created_id = operation["created_room_id"]
                if not isinstance(created_id, str) or created_id in used:
                    raise ProjectError(
                        f"{field}: Der zweite Raum benötigt eine neue ID."
                    )
                original = polygon(operation["source_polygon"], source_id)
                retained = polygon(operation["retained_polygon"], source_id)
                created = polygon(operation["created_polygon"], created_id)
                _validate_split_proof(original, retained, created, field)
                nodes[created_id] = (floor_id, sensors.copy())
                used.add(created_id)
            else:
                ids = operation["source_room_ids"]
                inputs = operation["source_polygons"]
                if (
                    not isinstance(ids, list)
                    or len(ids) != 2
                    or any(not isinstance(room_id, str) for room_id in ids)
                    or ids[0] == ids[1]
                    or not isinstance(inputs, list)
                    or len(inputs) != 2
                ):
                    raise ProjectError(f"{field}: Genau zwei verschiedene Räume nötig.")
                sensors = source(ids[0]) | source(ids[1])
                first = polygon(inputs[0], ids[0])
                second = polygon(inputs[1], ids[1])
                result = polygon(operation["result_polygon"], ids[0])
                _validate_merge_proof(first, second, result, field)
                nodes[ids[0]] = (floor_id, sensors)
                del nodes[ids[1]]
                retired.add(ids[1])
        except GEOSException as err:
            raise ProjectError(f"{field}: Die Raumgeometrie ist ungültig.") from err

    final_ids = room_ids(plan)
    if final_ids & retired:
        raise ProjectError(
            "room_operations: Entfernte Raum-IDs dürfen nicht neu entstehen."
        )
    return {
        room["id"]: nodes[room["id"]][1]
        for floor in (plan or {}).get("floors", [])
        for room in floor["rooms"]
        if room["id"] in nodes and nodes[room["id"]][0] == floor["id"]
    }


def _validate_split_proof(
    source: Polygon, retained: Polygon, created: Polygon, field: str
) -> None:
    """Require two complete, disjoint pieces sharing one straight cut."""
    combined = retained.union(created)
    if (
        retained.intersection(created).area > GEOMETRY_EPSILON
        or source.symmetric_difference(combined).area > GEOMETRY_EPSILON
    ):
        raise ProjectError(
            f"{field}: Die Teilräume müssen den Ursprungsraum exakt teilen."
        )
    boundary = line_merge(retained.boundary.intersection(created.boundary))
    if boundary.geom_type != "LineString" or boundary.length <= GEOMETRY_EPSILON:
        raise ProjectError(
            f"{field}: Die Teilung benötigt eine zusammenhängende Linie."
        )
    coordinates = list(boundary.coords)
    straight = LineString([coordinates[0], coordinates[-1]])
    if (
        straight.hausdorff_distance(boundary) > GEOMETRY_EPSILON
        or source.boundary.distance(Point(coordinates[0])) > GEOMETRY_EPSILON
        or source.boundary.distance(Point(coordinates[-1])) > GEOMETRY_EPSILON
    ):
        raise ProjectError(f"{field}: Die Schnittlinie muss zwei Randpunkte verbinden.")


def _validate_merge_proof(
    first: Polygon, second: Polygon, result: Polygon, field: str
) -> None:
    """Match exact unions and the frontend's bounded parallel-wall bridges."""
    if first.intersection(second).area > GEOMETRY_EPSILON:
        raise ProjectError(f"{field}: Die zu verbindenden Räume überlappen sich.")
    combined = first.union(second)
    if combined.geom_type == "Polygon":
        if (
            not combined.interiors
            and combined.symmetric_difference(result).area <= GEOMETRY_EPSILON
        ):
            return
    elif combined.geom_type == "MultiPolygon":
        for bridge in _wall_bridges(first, second):
            if (
                not bridge.is_valid
                or bridge.area <= GEOMETRY_EPSILON
                or bridge.intersection(first).area > GEOMETRY_EPSILON
                or bridge.intersection(second).area > GEOMETRY_EPSILON
            ):
                continue
            bridged = combined.union(bridge)
            if (
                bridged.geom_type == "Polygon"
                and not bridged.interiors
                and bridged.symmetric_difference(result).area <= GEOMETRY_EPSILON
            ):
                return
    raise ProjectError(
        f"{field}: Die Verbindung stimmt nicht mit den Raumkonturen überein."
    )


def _wall_bridges(first: Polygon, second: Polygon) -> Iterator[Polygon]:
    """Mirror the card's small gap and nearly parallel facing-edge restrictions."""
    maximum_gap = 0.15 * math.sqrt(min(first.area, second.area))
    first_points = list(first.exterior.coords)
    second_points = list(second.exterior.coords)
    for a, b in zip(first_points, first_points[1:], strict=False):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length <= GEOMETRY_EPSILON:
            continue
        axis = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)

        def projection(point, a=a, axis=axis):
            return (point[0] - a[0]) * axis[0] + (point[1] - a[1]) * axis[1]

        def distance(point, a=a, axis=axis):
            return axis[0] * (point[1] - a[1]) - axis[1] * (point[0] - a[0])

        for c, d in zip(second_points, second_points[1:], strict=False):
            c_projection, d_projection = projection(c), projection(d)
            projected_length = d_projection - c_projection
            if (
                abs(projected_length) <= GEOMETRY_EPSILON
                or abs((distance(d) - distance(c)) / projected_length) > 0.05
            ):
                continue
            start = max(0, min(c_projection, d_projection))
            end = min(length, max(c_projection, d_projection))
            if end - start <= GEOMETRY_EPSILON:
                continue
            c_start = _interpolate(c, d, (start - c_projection) / projected_length)
            c_end = _interpolate(c, d, (end - c_projection) / projected_length)
            start_distance, end_distance = distance(c_start), distance(c_end)
            gap = max(abs(start_distance), abs(end_distance))
            if (
                abs(start_distance) <= GEOMETRY_EPSILON
                or abs(end_distance) <= GEOMETRY_EPSILON
                or start_distance * end_distance < 0
                or gap > maximum_gap
                or end - start < 2 * gap
            ):
                continue
            yield Polygon(
                [
                    _interpolate(a, b, start / length),
                    _interpolate(a, b, end / length),
                    c_end,
                    c_start,
                ]
            )


def _interpolate(a: tuple, b: tuple, ratio: float) -> tuple[float, float]:
    if abs(ratio) < GEOMETRY_EPSILON:
        return a
    if abs(ratio - 1) < GEOMETRY_EPSILON:
        return b
    return (a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio)


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
