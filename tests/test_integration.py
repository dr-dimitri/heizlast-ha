"""Run the config flow, APIs and persistence in real Home Assistant instances."""

import json
from pathlib import Path

import pytest
from homeassistant import config_entries, loader
from homeassistant.components.repairs import repairs_flow_manager
from homeassistant.helpers import issue_registry as ir
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
from custom_components.heizlast_ha.repairs import ISSUE_PREFIX

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
    assert get_project(hass).snapshot() == {"revision": 0, "planning_bindings": {}}
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


@pytest.mark.parametrize("command", ["save_project", "upload_image"])
async def test_removed_geometry_commands_are_not_registered(
    hass, entry, hass_ws_client, command
):
    """An old card cannot mutate or import an editable floor plan anymore."""
    ws = await hass_ws_client(hass)
    response = await send(
        ws, 1, command, revision=0, plan=None, bindings={}, name="plan.png"
    )
    assert response["error"]["code"] == "unknown_command"
    assert get_project(hass).snapshot() == {"revision": 0, "planning_bindings": {}}
    assert not Path(hass.config.path(".storage", STORAGE_KEY)).exists()
    assert not hasattr(get_project(hass), "async_save")


async def test_sensor_assignments_survive_a_new_home_assistant_instance(hass, entry):
    """Reload assignments from the actual disk store in a fresh HA instance."""
    project = get_project(hass)
    hass.states.async_set("sensor.room", "unavailable", {"device_class": "temperature"})
    expected = await project.async_save_planning_bindings(0, {"5": ["sensor.room"]})
    assert await hass.config_entries.async_reload(entry.entry_id)
    assert get_project(hass) is not project
    assert get_project(hass).snapshot() == expected
    stored = json.loads(Path(hass.config.path(".storage", STORAGE_KEY)).read_text())
    assert stored["data"] == expected

    async with async_test_home_assistant(
        load_registries=False, config_dir=hass.config.config_dir
    ) as restarted:
        restarted.data.pop(loader.DATA_CUSTOM_COMPONENTS)
        replacement = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={})
        replacement.add_to_hass(restarted)
        assert await restarted.config_entries.async_setup(replacement.entry_id)
        await restarted.async_block_till_done()
        assert get_project(restarted).snapshot() == expected
        assert not Path(restarted.config.path(".storage", f"{DOMAIN}_images")).exists()
        assert await restarted.config_entries.async_unload(replacement.entry_id)
        await restarted.async_stop(force=True)


async def test_unloaded_snapshot_reports_not_loaded_and_can_reload(
    hass, entry, hass_ws_client
):
    ws = await hass_ws_client(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    unloaded = await send(ws, 1, "get_project")
    assert unloaded["error"]["code"] == "not_loaded"
    assert await hass.config_entries.async_setup(entry.entry_id)
    loaded = await send(ws, 2, "get_project")
    assert loaded["result"] == {"revision": 0, "planning_bindings": {}}
