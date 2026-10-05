"""Validate sensor assignments for the bundled residential calculation zones."""

import re
from collections.abc import Callable, Mapping
from typing import Any

type JsonObject = dict[str, Any]


class ProjectError(ValueError):
    """A user-correctable project error with a websocket error code."""

    def __init__(self, message: str, code: str = "invalid_project") -> None:
        """Initialize the error."""
        super().__init__(message)
        self.code = code


def is_temperature_state(entity_id: str, state: Any) -> bool:
    """Check a real Home Assistant state without depending on its concrete class."""
    return (
        entity_id.startswith("sensor.")
        and state is not None
        and isinstance(state.attributes, Mapping)
        and state.attributes.get("device_class") == "temperature"
    )


# These IDs are the stable calculation zones of the fixed residential floor plan.
PLANNING_ZONE_IDS = frozenset(str(zone_id) for zone_id in range(1, 12))
SENSOR_ENTITY_ID = re.compile(r"sensor\.[a-z0-9_]+\Z")


def validate_planning_bindings(
    bindings: Any,
    previous: dict[str, list[str]],
    is_temperature_sensor: Callable[[str], bool],
) -> dict[str, list[str]]:
    """Keep historical sensors in their zone; require real sensors for additions."""
    if not isinstance(bindings, dict):
        raise ProjectError(
            "planning_bindings: Sensorzuordnungen müssen ein Objekt sein."
        )
    for zone_id in bindings:
        if zone_id not in PLANNING_ZONE_IDS:
            raise ProjectError(
                "planning_bindings: Die Rechenzone ist nicht im Wohnhaus enthalten."
            )
    result: dict[str, list[str]] = {}
    for zone_id in PLANNING_ZONE_IDS:
        if zone_id not in bindings and zone_id not in previous:
            continue
        selected = bindings.get(zone_id, previous.get(zone_id, []))
        if not isinstance(selected, list) or len(selected) > 100:
            raise ProjectError(
                f"planning_bindings.{zone_id}: Höchstens 100 Sensoren erlaubt."
            )
        checked: list[str] = []
        for entity_id in selected:
            if not isinstance(entity_id, str) or not SENSOR_ENTITY_ID.fullmatch(
                entity_id
            ):
                raise ProjectError(f"planning_bindings.{zone_id}: Ungültige Sensor-ID.")
            if entity_id in checked:
                raise ProjectError(f"planning_bindings.{zone_id}: Doppelte Sensor-ID.")
            if entity_id not in previous.get(zone_id, []) and not (
                is_temperature_sensor(entity_id)
            ):
                raise ProjectError(
                    f"planning_bindings.{zone_id}: Der neue Sensor ist kein "
                    "vorhandener Sensor mit Temperatur-Geräteklasse."
                )
            checked.append(entity_id)
        result[zone_id] = checked
    return result
