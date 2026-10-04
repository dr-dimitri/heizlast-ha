"""Run the config flow, APIs and persistence in real Home Assistant instances."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import pytest
from homeassistant import config_entries, loader
from homeassistant.components.repairs import repairs_flow_manager
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.storage import Store
from homeassistant.util.file import WriteError
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_test_home_assistant,
)

from custom_components.heizlast_ha.api import get_project
from custom_components.heizlast_ha.const import (
    CONF_DASHBOARD_FINGERPRINT,
    DOMAIN,
    STORAGE_KEY,
)
from custom_components.heizlast_ha.project import Project
from custom_components.heizlast_ha.repairs import ISSUE_PREFIX
from custom_components.heizlast_ha.validation import ProjectError

pytestmark = pytest.mark.usefixtures("enable_custom_integrations", "bundled_card")


@pytest.fixture
def hass_storage():
    """Deliberately disable the plugin's storage mock: writes must reach disk."""
    return {}


@pytest.fixture
def hass_config_dir(tmp_path):
    """Use private on-disk Home Assistant storage for every test."""
    return str(tmp_path)


@pytest.fixture
async def entry(hass):
    """Set up a real, loaded custom config entry."""
    config_entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    return config_entry


def standalone_plan():
    """Create two adjacent room polygons without a source image."""
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
                        "area_m2": None,
                    },
                ],
            }
        ],
    }


async def send(ws, message_id, command, **payload):
    """Execute the actual HA websocket protocol, including schema and permissions."""
    await ws.send_json({"id": message_id, "type": f"{DOMAIN}/{command}", **payload})
    response = await ws.receive_json()
    assert response["id"] == message_id
    return response


async def test_config_flow_is_single_instance(hass):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] == "form"
    assert result["step_id"] == "user"
    configured = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert configured["type"] == "create_entry"
    await hass.async_block_till_done()
    assert get_project(hass).snapshot()["plan"] is None
    duplicate = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert duplicate["type"] == "abort"
    assert duplicate["reason"] in {"already_configured", "single_instance_allowed"}


@pytest.mark.parametrize("confirm", [False, True])
async def test_dashboard_reload_confirmation_survives_restart(
    hass, bundled_card, confirm
):
    """Recover actual saved config entries in a fresh Home Assistant instance."""
    initial = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    created = await hass.config_entries.flow.async_configure(initial["flow_id"], {})
    await hass.async_block_till_done()
    entry = created["result"]
    baseline = entry.data[CONF_DASHBOARD_FINGERPRINT]
    bundled_card.write_text("export const upgradedDashboard = true;\n")
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    fingerprint = hass.data[DOMAIN]["dashboard"].fingerprint
    assert fingerprint != baseline
    issue_id = f"{ISSUE_PREFIX}{fingerprint}"
    if confirm:
        manager = repairs_flow_manager(hass)
        flow = await manager.async_init(DOMAIN, data={"issue_id": issue_id})
        assert (await manager.async_configure(flow["flow_id"], {}))["type"] == (
            "create_entry"
        )
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_stop(force=True)
    async with async_test_home_assistant(
        load_registries=False, config_dir=hass.config.config_dir
    ) as restarted:
        restarted.data.pop(loader.DATA_CUSTOM_COMPONENTS)
        await restarted.config_entries.async_initialize()
        recovered_entry = restarted.config_entries.async_get_entry(entry.entry_id)
        assert recovered_entry is not None
        assert (
            recovered_entry.data.get(CONF_DASHBOARD_FINGERPRINT) == fingerprint
        ) == (confirm)
        assert await restarted.config_entries.async_setup(entry.entry_id)
        await restarted.async_block_till_done()
        issue = ir.async_get(restarted).async_get_issue(DOMAIN, issue_id)
        assert (issue is None) == confirm
        assert await restarted.config_entries.async_unload(entry.entry_id)
        await restarted.async_stop(force=True)


async def test_websocket_standalone_import_bindings_and_invalid_import(
    hass, entry, hass_ws_client
):
    ws = await hass_ws_client(hass)
    response = await send(ws, 1, "get_project")
    assert response["result"] == {
        "revision": 0,
        "plan": None,
        "bindings": {},
    }
    hass.states.async_set(
        "sensor.room",
        "23.5",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    plan = standalone_plan()
    saved = await send(
        ws,
        4,
        "save_project",
        revision=0,
        plan=plan,
        bindings={"eg_links": ["sensor.room"]},
    )
    assert saved["success"]
    assert saved["result"]["revision"] == 1
    assert saved["result"]["bindings"]["eg_links"] == ["sensor.room"]
    persisted = json.loads(Path(hass.config.path(".storage", STORAGE_KEY)).read_text())
    assert persisted["data"] == saved["result"]

    broken = deepcopy(plan)
    broken["floors"][0]["rooms"][0]["polygon"][0] = [-1, 0]
    invalid = await send(ws, 5, "save_project", revision=1, plan=broken, bindings={})
    assert not invalid["success"]
    assert invalid["error"]["code"] == "invalid_project"
    current = await send(ws, 6, "get_project")
    assert current["result"] == saved["result"]
    assert (
        json.loads(Path(hass.config.path(".storage", STORAGE_KEY)).read_text())
        == persisted
    )


async def test_reimport_preserves_stable_bindings_and_removed_entity(
    hass, entry, hass_ws_client
):
    ws = await hass_ws_client(hass)
    plan = standalone_plan()
    hass.states.async_set("sensor.room", "unknown", {"device_class": "temperature"})
    saved = await send(
        ws,
        2,
        "save_project",
        revision=0,
        plan=plan,
        bindings={"eg_links": ["sensor.room"]},
    )
    assert saved["success"]
    hass.states.async_remove("sensor.room")
    plan["floors"][0]["rooms"][0]["name"] = "Umbenannt"
    revised = await send(ws, 3, "save_project", revision=1, plan=plan, bindings={})
    assert revised["success"]
    assert revised["result"]["bindings"]["eg_links"] == ["sensor.room"]
    assert revised["result"]["plan"]["floors"][0]["rooms"][0]["name"] == "Umbenannt"

    new_invalid = await send(
        ws,
        4,
        "save_project",
        revision=2,
        plan=plan,
        bindings={"eg_rechts": ["sensor.room"]},
    )
    assert not new_invalid["success"]
    assert get_project(hass).snapshot() == revised["result"]


async def test_room_removal_requires_confirmation(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    plan = standalone_plan()
    await send(ws, 2, "save_project", revision=0, plan=plan, bindings={})
    plan["floors"][0]["rooms"].pop()
    refused = await send(ws, 3, "save_project", revision=1, plan=plan, bindings={})
    assert refused["error"]["code"] == "confirmation_required"
    assert len(get_project(hass).snapshot()["plan"]["floors"][0]["rooms"]) == 2
    saved = await send(
        ws,
        4,
        "save_project",
        revision=1,
        plan=plan,
        bindings={},
        confirmed_removed_room_ids=["eg_rechts"],
    )
    assert saved["success"]
    assert "eg_rechts" not in saved["result"]["bindings"]


async def test_concurrent_stale_saves_are_rejected(hass, entry):
    project = get_project(hass)
    plan = standalone_plan()
    changed = deepcopy(plan)
    changed["floors"][0]["rooms"][0]["name"] = "Zweite Änderung"
    results = await asyncio.gather(
        project.async_save(0, plan, {}, []),
        project.async_save(0, changed, {}, []),
        return_exceptions=True,
    )
    successes = [result for result in results if isinstance(result, dict)]
    errors = [result for result in results if isinstance(result, ProjectError)]
    assert len(successes) == 1
    assert len(errors) == 1
    assert errors[0].code == "conflict"
    assert project.snapshot() == successes[0]
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == successes[0]


async def test_disk_write_failure_does_not_publish_unpersisted_changes(
    hass, entry, hass_ws_client
):
    ws = await hass_ws_client(hass)
    plan = standalone_plan()
    saved = await send(ws, 2, "save_project", revision=0, plan=plan, bindings={})
    before = saved["result"]
    plan["floors"][0]["name"] = "Nicht gespeichert"
    # This is the actual Store failure path: Store.async_save logs and swallows
    # WriteError, so the project must explicitly confirm the disk write.
    with patch.object(
        Store, "_write_prepared_data", side_effect=WriteError("full disk")
    ):
        rejected = await send(ws, 3, "save_project", revision=1, plan=plan, bindings={})
    assert rejected["error"]["code"] == "storage_error"
    assert get_project(hass).snapshot() == before
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == before


async def test_project_survives_reload_and_a_new_home_assistant_instance(hass, entry):
    project = get_project(hass)
    hass.states.async_set("sensor.room", "unavailable", {"device_class": "temperature"})
    plan = standalone_plan()
    expected = await project.async_save(0, plan, {"eg_links": ["sensor.room"]}, [])
    assert await hass.config_entries.async_reload(entry.entry_id)
    assert get_project(hass) is not project
    assert get_project(hass).snapshot() == expected

    # A separate HA instance with fresh hass.data reads the actual disk store,
    # proving persistence independently of the first instance's caches.
    async with async_test_home_assistant(
        load_registries=False, config_dir=hass.config.config_dir
    ) as restarted:
        restarted.data.pop(loader.DATA_CUSTOM_COMPONENTS)
        replacement = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={})
        replacement.add_to_hass(restarted)
        assert await restarted.config_entries.async_setup(replacement.entry_id)
        await restarted.async_block_till_done()
        recovered = get_project(restarted)
        assert recovered.snapshot() == expected
        assert not Path(restarted.config.path(".storage", f"{DOMAIN}_images")).exists()
        assert await restarted.config_entries.async_unload(replacement.entry_id)
        await restarted.async_stop(force=True)


async def test_unloaded_entry_returns_not_loaded_and_can_reload(
    hass, entry, hass_ws_client
):
    ws = await hass_ws_client(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    response = await send(ws, 1, "get_project")
    assert response["error"]["code"] == "not_loaded"
    assert await hass.config_entries.async_setup(entry.entry_id)
    loaded = await send(ws, 2, "get_project")
    assert loaded["success"]


async def test_read_access_and_admin_only_mutations(
    hass, entry, hass_ws_client, hass_read_only_access_token
):
    ws = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    read = await send(ws, 1, "get_project")
    assert read["success"]
    save = await send(ws, 3, "save_project", revision=0, plan=None, bindings={})
    assert save["error"]["code"] == "unauthorized"
    assert get_project(hass).snapshot()["plan"] is None


async def test_image_upload_command_is_no_longer_registered(
    hass, entry, hass_ws_client
):
    ws = await hass_ws_client(hass)
    response = await send(ws, 1, "upload_image", name="plan.png", data="unused")
    assert response["error"]["code"] == "unknown_command"
    assert get_project(hass).snapshot() == {
        "revision": 0,
        "plan": None,
        "bindings": {},
    }
    assert not Path(hass.config.path(".storage", STORAGE_KEY)).exists()
    assert not Path(hass.config.path(".storage", f"{DOMAIN}_images")).exists()
