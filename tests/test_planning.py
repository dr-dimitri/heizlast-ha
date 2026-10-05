"""Check calculation-zone assignments through real Home Assistant persistence."""

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from homeassistant.helpers.storage import Store
from homeassistant.util.file import WriteError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.heizlast_ha.api import get_project
from custom_components.heizlast_ha.const import DOMAIN, STORAGE_KEY
from custom_components.heizlast_ha.planning import (
    PLANNING_ZONE_IDS,
    ProjectError,
    validate_planning_bindings,
)
from custom_components.heizlast_ha.project import Project

pytestmark = pytest.mark.usefixtures("enable_custom_integrations", "bundled_card")


@pytest.fixture
def hass_storage():
    """Use actual disk persistence instead of the fixture's Store mock."""
    return {}


@pytest.fixture
def hass_config_dir(tmp_path):
    """Provide independent on-disk storage for each test."""
    return str(tmp_path)


@pytest.fixture
async def entry(hass):
    """Load the integration and register its authenticated API."""
    config_entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    return config_entry


def legacy_plan():
    """Use neutral legacy data solely to prove it remains hidden and unchanged."""
    return {
        "schema_version": "1.1",
        "floors": [
            {
                "id": "floor",
                "name": "Etage",
                "canvas": {"width": 100, "height": 100},
                "rooms": [
                    {
                        "id": "room",
                        "name": "Raum",
                        "polygon": [[0, 0], [100, 0], [100, 100], [0, 100]],
                        "area_m2": None,
                    }
                ],
            }
        ],
    }


async def send(ws, message_id, command, **payload):
    """Exercise the complete HA websocket schema and permission checks."""
    await ws.send_json({"id": message_id, "type": f"{DOMAIN}/{command}", **payload})
    response = await ws.receive_json()
    assert response["id"] == message_id
    return response


def test_planning_zone_ids_match_the_bundled_dataset():
    """Assignments target actual calculation zones, never other building parts."""
    path = (
        Path(__file__).parents[1]
        / "custom_components"
        / "heizlast_ha"
        / "planning-data.json"
    )
    data = json.loads(path.read_text())
    assert PLANNING_ZONE_IDS == {str(zone["id"]) for zone in data["zones"]}


@pytest.mark.parametrize(
    "bindings",
    [
        None,
        [],
        {"0": []},
        {"12": []},
        {"__proto__": []},
        {"constructor": []},
        {"prototype": []},
        {1: []},
        {"1": "sensor.room"},
        {"1": ["sensor.room", "sensor.room"]},
        {"1": ["sensor."]},
        {"1": ["sensor.room.invalid"]},
        {"1": ["climate.room"]},
        {"1": [False]},
        {"1": [f"sensor.room_{index}" for index in range(101)]},
    ],
)
def test_planning_validation_rejects_invalid_shapes_and_identifiers(bindings):
    """Do not accept prototype keys, malformed IDs, duplicates or oversized lists."""
    with pytest.raises(ProjectError):
        validate_planning_bindings(bindings, {}, lambda _: True)


@pytest.mark.parametrize("old_plan", [None, legacy_plan(), {"schema_version": "1.0"}])
async def test_planning_save_preserves_user_plan_and_survives_reload(
    hass, entry, hass_ws_client, old_plan
):
    """Inactive old user data stays on disk and never becomes part of the API."""
    ws = await hass_ws_client(hass)
    initial = await send(ws, 1, "get_project")
    assert initial["result"] == {"revision": 0, "planning_bindings": {}}
    hass.states.async_set("sensor.zone", "21", {"device_class": "temperature"})
    old_data = {
        "revision": 1,
        "plan": old_plan,
        "bindings": {"room": ["sensor.legacy_removed"]},
        "legacy_metadata": {"retained": True},
    }
    await get_project(hass).store.async_save(old_data)
    storage_path = Path(hass.config.path(".storage", STORAGE_KEY))
    before = storage_path.read_bytes()
    assert await hass.config_entries.async_reload(entry.entry_id)
    assert storage_path.read_bytes() == before
    assert get_project(hass).snapshot() == {"revision": 1, "planning_bindings": {}}
    saved = await send(
        ws,
        2,
        "save_planning_bindings",
        revision=1,
        bindings={"1": ["sensor.zone"]},
    )
    expected = {
        "revision": 2,
        "planning_bindings": {"1": ["sensor.zone"]},
    }
    assert saved["result"] == expected
    stored = json.loads(storage_path.read_text())
    assert stored["data"] == {**old_data, **expected}
    assert await hass.config_entries.async_reload(entry.entry_id)
    assert get_project(hass).snapshot() == expected
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == expected

    changed = await send(
        ws, 3, "save_planning_bindings", revision=2, bindings={"1": []}
    )
    assert changed["success"]
    assert changed["result"]["planning_bindings"] == {"1": []}
    assert changed["result"]["revision"] == 3
    assert json.loads(storage_path.read_text())["data"] == {
        **old_data,
        **changed["result"],
    }
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == changed["result"]


async def test_planning_assignments_without_user_plan_never_create_geometry(
    hass, entry, hass_ws_client
):
    ws = await hass_ws_client(hass)
    hass.states.async_set("sensor.zone", "unknown", {"device_class": "temperature"})
    saved = await send(
        ws,
        1,
        "save_planning_bindings",
        revision=0,
        bindings={"11": ["sensor.zone"]},
    )
    assert saved["result"] == {
        "revision": 1,
        "planning_bindings": {"11": ["sensor.zone"]},
    }
    stored = json.loads(Path(hass.config.path(".storage", STORAGE_KEY)).read_text())
    assert stored["data"] == saved["result"]


async def test_planning_sensors_validate_additions_and_keep_historical_assignments(
    hass, entry, hass_ws_client
):
    """Unavailable historical sensors stay readable until deliberately unassigned."""
    ws = await hass_ws_client(hass)
    for entity_id in ["sensor.deleted", "sensor.changed", "sensor.available"]:
        hass.states.async_set(entity_id, "unavailable", {"device_class": "temperature"})
    saved = await send(
        ws,
        1,
        "save_planning_bindings",
        revision=0,
        bindings={"1": ["sensor.deleted", "sensor.changed"]},
    )
    assert saved["success"]
    hass.states.async_remove("sensor.deleted")
    hass.states.async_set("sensor.changed", "40", {"device_class": "humidity"})
    for index, bindings in enumerate(
        [
            {"1": ["sensor.unknown"]},
            {"2": ["sensor.deleted"]},
            {"2": ["sensor.changed"]},
            {"12": []},
            {"__proto__": []},
            {"1": ["sensor.available", "sensor.available"]},
        ],
        start=2,
    ):
        rejected = await send(
            ws, index, "save_planning_bindings", revision=1, bindings=bindings
        )
        assert rejected["error"]["code"] == "invalid_project"
        assert get_project(hass).snapshot() == saved["result"]
    retained = await send(
        ws,
        8,
        "save_planning_bindings",
        revision=1,
        bindings={"2": ["sensor.available"]},
    )
    assert retained["success"]
    assert retained["result"]["planning_bindings"] == {
        "1": ["sensor.deleted", "sensor.changed"],
        "2": ["sensor.available"],
    }
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == retained["result"]
    removed = await send(
        ws, 9, "save_planning_bindings", revision=2, bindings={"1": []}
    )
    assert removed["success"]
    assert removed["result"]["planning_bindings"]["1"] == []


async def test_planning_websocket_is_admin_only_but_snapshot_is_readable(
    hass, entry, hass_ws_client, hass_read_only_access_token
):
    ws = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    read = await send(ws, 1, "get_project")
    assert read["success"]
    rejected = await send(
        ws, 2, "save_planning_bindings", revision=0, bindings={"1": []}
    )
    assert rejected["error"]["code"] == "unauthorized"
    assert get_project(hass).snapshot() == read["result"]
    assert not Path(hass.config.path(".storage", STORAGE_KEY)).exists()


async def test_concurrent_planning_saves_share_optimistic_revision(hass, entry):
    """Simultaneous sensor edits cannot silently overwrite each other."""
    project = get_project(hass)
    results = await asyncio.gather(
        project.async_save_planning_bindings(0, {"2": []}),
        project.async_save_planning_bindings(0, {"1": []}),
        return_exceptions=True,
    )
    successes = [result for result in results if isinstance(result, dict)]
    errors = [result for result in results if isinstance(result, ProjectError)]
    assert len(successes) == len(errors) == 1
    assert errors[0].code == "conflict"
    assert project.snapshot() == successes[0]
    with pytest.raises(ProjectError, match="zwischenzeitlich"):
        await project.async_save_planning_bindings(0, {"1": []})
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == successes[0]


async def test_planning_write_failure_does_not_publish_a_new_revision(
    hass, entry, hass_ws_client
):
    """The shared durable-write check also protects the new assignment endpoint."""
    ws = await hass_ws_client(hass)
    before = get_project(hass).snapshot()
    with patch.object(
        Store, "_write_prepared_data", side_effect=WriteError("full disk")
    ):
        rejected = await send(
            ws, 1, "save_planning_bindings", revision=0, bindings={"1": []}
        )
    assert rejected["error"]["code"] == "storage_error"
    assert get_project(hass).snapshot() == before
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == before


@pytest.mark.parametrize(
    "bindings",
    [None, [], {"12": []}, {"__proto__": []}, {"1": "sensor.room"}, {"1": [False]}],
)
async def test_corrupt_planning_storage_is_rejected_without_reset(
    hass, entry, bindings
):
    """Invalid optional data must never be treated as empty sensor assignments."""
    project = get_project(hass)
    stored = {**project.snapshot(), "planning_bindings": bindings}
    await project.store.async_save(stored)
    path = Path(hass.config.path(".storage", STORAGE_KEY))
    before = path.read_bytes()
    fresh = Project(hass)
    with pytest.raises(ProjectError):
        await fresh.async_load()
    assert path.read_bytes() == before


async def test_unloaded_planning_endpoint_refuses_mutation(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    rejected = await send(
        ws, 1, "save_planning_bindings", revision=0, bindings={"1": []}
    )
    assert rejected["error"]["code"] == "not_loaded"


@pytest.mark.parametrize(
    "stored",
    [
        False,
        [],
        {"revision": True, "planning_bindings": {}},
        {"revision": -1, "planning_bindings": {}},
        {"revision": 0},
        {"revision": 0, "plan": None},
        {"revision": 0, "bindings": {}},
        {"revision": 0, "plan": [], "bindings": {}},
        {"revision": 0, "plan": None, "bindings": []},
    ],
)
async def test_corrupt_storage_header_does_not_reset_user_data(hass, entry, stored):
    """Reject corrupt envelopes before accepting mutations or rewriting storage."""
    project = get_project(hass)
    await project.store.async_save(stored)
    storage_path = Path(hass.config.path(".storage", STORAGE_KEY))
    before = storage_path.read_bytes()
    fresh = Project(hass)
    with pytest.raises(ProjectError):
        await fresh.async_load()
    assert storage_path.read_bytes() == before
