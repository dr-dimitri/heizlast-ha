"""Home Assistant-backed project storage with optimistic concurrency."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_KEY, STORAGE_VERSION
from .images import check_image_file, decode_image, write_image
from .validation import (
    JsonObject,
    ProjectError,
    is_temperature_state,
    load_validator,
    validate_bindings,
    validate_plan,
    validate_removals,
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
    """One persistent floor plan project belonging to this HA installation."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize storage; setup loads data before making APIs available."""
        self.hass = hass
        self.image_dir = Path(hass.config.path(".storage", f"{DOMAIN}_images"))
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
            "plan": None,
            "bindings": {},
            "images": [],
        }

    async def async_load(self) -> None:
        """Load the validator and persisted data without touching existing files."""
        self.validator = await self.hass.async_add_executor_job(load_validator)
        stored = await self.store.async_load()
        if stored is None:
            return
        # Invalid storage must not be treated as an empty project and overwritten.
        if (
            not isinstance(stored, dict)
            or type(stored.get("revision")) is not int
            or stored["revision"] < 0
            or not isinstance(stored.get("images"), list)
            or not isinstance(stored.get("bindings"), dict)
            or "plan" not in stored
        ):
            raise ProjectError("Die gespeicherten Projektdaten sind ungültig.")
        await self.hass.async_add_executor_job(self._validate_loaded, stored)
        self.data = deepcopy(stored)

    def _validate_loaded(self, stored: JsonObject) -> None:
        """Validate persisted geometry and reject malformed image metadata."""
        known_backgrounds: set[str] = set()
        for metadata in stored["images"]:
            if (
                not isinstance(metadata, dict)
                or set(metadata) != {"background", "name", "width", "height", "mime"}
                or not isinstance(metadata.get("background"), str)
                or not isinstance(metadata.get("name"), str)
                or type(metadata.get("width")) is not int
                or type(metadata.get("height")) is not int
                or metadata.get("mime") not in ("image/png", "image/jpeg")
                or metadata["background"] in known_backgrounds
            ):
                raise ProjectError("Die gespeicherten Bildmetadaten sind ungültig.")
            # Validate the UUID even for temporarily missing files. Keeping their
            # metadata preserves a plan that can be recovered from a backup.
            check_image_file(self.image_dir, metadata)
            known_backgrounds.add(metadata["background"])
        plan = validate_plan(stored["plan"], stored["images"], self.validator)
        validate_bindings(plan, stored["bindings"], stored["bindings"], lambda _: False)

    def snapshot(self) -> JsonObject:
        """Return an isolated copy; callers cannot accidentally mutate persistence."""
        self._ensure_active()
        return deepcopy(self.data)

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

    async def async_upload(self, name: Any, encoded: Any) -> JsonObject:
        """Append a validated background image without changing plan revision."""
        async with self.lock:
            self._ensure_active()
            image_bytes, metadata = await self.hass.async_add_executor_job(
                decode_image, name, encoded
            )
            await self.hass.async_add_executor_job(
                write_image, self.image_dir, metadata["background"], image_bytes
            )
            candidate = deepcopy(self.data)
            candidate["images"].append(metadata)
            await self._async_persist(candidate)
            return deepcopy(metadata)

    async def async_save(
        self,
        revision: int,
        plan: Any,
        bindings: Any,
        confirmed_removed_room_ids: list[str],
    ) -> JsonObject:
        """Validate then atomically save, rejecting stale edits and unsafe removals."""
        async with self.lock:
            self._ensure_active()
            if type(revision) is not int or revision != self.data["revision"]:
                raise ProjectError(
                    "Das Projekt wurde zwischenzeitlich geändert. "
                    "Bitte neu laden und Änderungen erneut prüfen.",
                    "conflict",
                )
            checked_plan = await self.hass.async_add_executor_job(
                validate_plan, plan, self.data["images"], self.validator
            )
            if checked_plan is not None:
                await self.hass.async_add_executor_job(
                    self._check_plan_images, checked_plan
                )
            validate_removals(
                self.data["plan"], checked_plan, confirmed_removed_room_ids
            )
            checked_bindings = validate_bindings(
                checked_plan,
                bindings,
                self.data["bindings"],
                lambda entity_id: is_temperature_state(
                    entity_id, self.hass.states.get(entity_id)
                ),
            )
            candidate = {
                "revision": self.data["revision"] + 1,
                "plan": checked_plan,
                "bindings": checked_bindings,
                "images": deepcopy(self.data["images"]),
            }
            await self._async_persist(candidate)
            return self.snapshot()

    def _check_plan_images(self, plan: JsonObject) -> None:
        """Ensure the selected backgrounds still exist before committing edits."""
        images = {item["background"]: item for item in self.data["images"]}
        for floor in plan["floors"]:
            if check_image_file(self.image_dir, images[floor["background"]]) is None:
                raise ProjectError(
                    f"Etage {floor['id']}: Das gespeicherte Bild fehlt. "
                    "Bitte aus der Sicherung wiederherstellen oder erneut hochladen."
                )

    async def async_shutdown(self) -> None:
        """Complete current writes and stop accepting mutations before unload."""
        async with self.lock:
            self.active = False
