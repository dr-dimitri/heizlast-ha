"""Home Assistant-backed project storage with optimistic concurrency."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION
from .planning import (
    JsonObject,
    ProjectError,
    is_temperature_state,
    validate_planning_bindings,
)


def _verify_saved_project(path: str, expected: JsonObject) -> None:
    """Check persistence; HA's Store logs some write errors without raising them."""
    try:
        stored = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise ProjectError(
            "Das Projekt konnte nicht sicher gespeichert werden. "
            "Bitte erneut versuchen.",
            "storage_error",
        ) from err
    if not isinstance(stored, dict) or stored.get("data") != expected:
        raise ProjectError(
            "Das Projekt wurde nicht auf den Datenträger geschrieben.", "storage_error"
        )


class Project:
    """Persistent sensors for fixed calculation zones, preserving inactive old data."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize storage; setup loads data before making APIs available."""
        self.hass = hass
        self.store: Store[JsonObject] = Store(
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
            private=True,
            atomic_writes=True,
            serialize_in_event_loop=False,
        )
        self.lock = asyncio.Lock()
        self.active = True
        self.data: JsonObject = {
            "revision": 0,
            "planning_bindings": {},
        }

    async def async_load(self) -> None:
        """Load current assignments and retain legacy data without rewriting files."""
        stored = await self.store.async_load()
        if stored is None:
            return
        # Invalid storage must not be treated as an empty project and overwritten.
        if (
            not isinstance(stored, dict)
            or type(stored.get("revision")) is not int
            or stored["revision"] < 0
        ):
            raise ProjectError("Die gespeicherten Projektdaten sind ungültig.")
        legacy = "plan" in stored or "bindings" in stored
        if legacy and (
            "plan" not in stored
            or stored["plan"] is not None
            and not isinstance(stored["plan"], dict)
            or not isinstance(stored.get("bindings"), dict)
        ):
            raise ProjectError("Die gespeicherten Altdaten sind ungültig.")
        if "planning_bindings" not in stored and not legacy:
            raise ProjectError("Die gespeicherten Sensorzuordnungen fehlen.")
        if "planning_bindings" in stored:
            validate_planning_bindings(
                stored["planning_bindings"],
                stored["planning_bindings"],
                lambda _: False,
            )
        self.data = deepcopy(stored)

    def snapshot(self) -> JsonObject:
        """Return an isolated copy; callers cannot accidentally mutate persistence."""
        self._ensure_active()
        return {
            "revision": self.data["revision"],
            "planning_bindings": deepcopy(self.data.get("planning_bindings", {})),
        }

    def _ensure_active(self) -> None:
        if not self.active:
            raise ProjectError("Die Integration ist nicht geladen.", "not_loaded")

    async def _async_persist(self, candidate: JsonObject) -> None:
        """Finish durable storage before updating the public project revision."""
        await self.store.async_save(candidate)
        await self.hass.async_add_executor_job(
            _verify_saved_project, self.store.path, candidate
        )
        self.data = candidate

    async def async_save_planning_bindings(
        self,
        revision: int,
        bindings: Any,
    ) -> JsonObject:
        """Persist calculation-zone sensors, leaving any inactive legacy data intact."""
        async with self.lock:
            self._ensure_active()
            if type(revision) is not int or revision != self.data["revision"]:
                raise ProjectError(
                    "Das Projekt wurde zwischenzeitlich geändert. "
                    "Bitte neu laden und Änderungen erneut prüfen.",
                    "conflict",
                )
            checked = validate_planning_bindings(
                bindings,
                self.data.get("planning_bindings", {}),
                lambda entity_id: is_temperature_state(
                    entity_id, self.hass.states.get(entity_id)
                ),
            )
            candidate = deepcopy(self.data)
            candidate["revision"] += 1
            candidate["planning_bindings"] = checked
            await self._async_persist(candidate)
            return self.snapshot()

    async def async_shutdown(self) -> None:
        """Complete current writes and stop accepting mutations before unload."""
        async with self.lock:
            self.active = False
