"""Verify dashboard loading and delivery inside real Home Assistant instances."""

import json
from pathlib import Path

import pytest
from homeassistant.components.frontend import (
    DATA_EXTRA_MODULE_URL,
    DATA_PANELS,
    async_register_built_in_panel,
)
from homeassistant.config_entries import ConfigEntryState
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.heizlast_ha.const import DOMAIN
from custom_components.heizlast_ha.frontend import CARD_PATH, PANEL_PATH

pytestmark = pytest.mark.usefixtures("enable_custom_integrations", "bundled_card")
VERSION = json.loads(
    (
        Path(__file__).resolve().parents[1]
        / "custom_components/heizlast_ha/manifest.json"
    ).read_text()
)["version"]


async def setup_entry(hass):
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={})
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_card_is_served_and_automatically_loaded(hass, hass_client, bundled_card):
    entry = await setup_entry(hass)
    assert entry.state is ConfigEntryState.LOADED
    assert f"{CARD_PATH}?v={VERSION}" in hass.data[DATA_EXTRA_MODULE_URL].urls
    client = await hass_client()
    response = await client.get(f"{CARD_PATH}?v={VERSION}")
    assert response.status == 200
    assert await response.text() == bundled_card.read_text()
    assert "javascript" in response.headers["Content-Type"]
    assert "Cache-Control" not in response.headers
    # Public route contains only this static module, never private floor plans.
    assert (await client.get(f"{CARD_PATH}/../manifest.json")).status == 404


async def test_dashboard_is_available_in_sidebar_and_integration(hass, hass_ws_client):
    await setup_entry(hass)
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "get_panels"})
    response = await ws.receive_json()
    panel = response["result"][PANEL_PATH]
    assert panel["title"] == "Heizlast HA"
    assert panel["icon"] == "mdi:floor-plan"
    assert panel["show_in_sidebar"] is True
    assert panel["default_visible"] is True
    assert panel["require_admin"] is False
    assert panel["config_panel_domain"] == DOMAIN
    assert panel["config"]["_panel_custom"]["name"] == "heizlast-ha-panel"
    assert panel["config"]["_panel_custom"]["module_url"] == (
        f"{CARD_PATH}?v={VERSION}"
    )


async def test_normal_users_can_open_the_sidebar_dashboard(
    hass, hass_ws_client, hass_read_only_access_token
):
    await setup_entry(hass)
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json({"id": 1, "type": "get_panels"})
    response = await ws.receive_json()
    assert PANEL_PATH in response["result"]


async def test_unload_and_reload_do_not_duplicate_routes_or_modules(hass, hass_client):
    entry = await setup_entry(hass)
    url = f"{CARD_PATH}?v={VERSION}"
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert url not in hass.data[DATA_EXTRA_MODULE_URL].urls
    assert PANEL_PATH not in hass.data[DATA_PANELS]
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert list(hass.data[DATA_EXTRA_MODULE_URL].urls).count(url) == 1
    assert [
        panel.config_panel_domain for panel in hass.data[DATA_PANELS].values()
    ].count(DOMAIN) == 1
    assert (await (await hass_client()).get(url)).status == 200


async def test_missing_card_prevents_incomplete_installation(hass, bundled_card):
    bundled_card.unlink()
    entry = await setup_entry(hass)
    assert entry.state is ConfigEntryState.SETUP_RETRY
    assert "project" not in hass.data[DOMAIN]
    assert f"{CARD_PATH}?v={VERSION}" not in hass.data[DATA_EXTRA_MODULE_URL].urls
    assert PANEL_PATH not in hass.data[DATA_PANELS]


async def test_card_loads_for_yaml_dashboards_without_editing_resources(hass):
    assert await async_setup_component(hass, "lovelace", {"lovelace": {"mode": "yaml"}})
    await setup_entry(hass)
    assert f"{CARD_PATH}?v={VERSION}" in hass.data[DATA_EXTRA_MODULE_URL].urls
    assert hass.data["lovelace"].resource_mode == "yaml"
    assert hass.data["lovelace"].resources.async_items() == []
    assert PANEL_PATH in hass.data[DATA_PANELS]


async def test_existing_dashboards_are_preserved_during_setup_and_unload(hass):
    assert await async_setup_component(hass, "frontend", {})
    async_register_built_in_panel(
        hass, "lovelace", "My floor plan", frontend_url_path=PANEL_PATH
    )
    existing = hass.data[DATA_PANELS][PANEL_PATH]
    entry = await setup_entry(hass)
    assert hass.data[DATA_PANELS][PANEL_PATH] is existing
    assert hass.data[DATA_PANELS][f"{PANEL_PATH}-2"].config_panel_domain == DOMAIN
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert hass.data[DATA_PANELS][PANEL_PATH] is existing
    assert f"{PANEL_PATH}-2" not in hass.data[DATA_PANELS]
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert hass.data[DATA_PANELS][PANEL_PATH] is existing
    assert f"{PANEL_PATH}-2" in hass.data[DATA_PANELS]


async def test_unload_keeps_a_panel_replaced_by_another_integration(hass):
    entry = await setup_entry(hass)
    async_register_built_in_panel(
        hass, "lovelace", frontend_url_path=PANEL_PATH, update=True
    )
    replacement = hass.data[DATA_PANELS][PANEL_PATH]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert hass.data[DATA_PANELS][PANEL_PATH] is replacement


async def test_removing_integration_removes_its_dashboard(hass):
    entry = await setup_entry(hass)
    assert (await hass.config_entries.async_remove(entry.entry_id))[
        "require_restart"
    ] is False
    assert PANEL_PATH not in hass.data[DATA_PANELS]
    assert f"{CARD_PATH}?v={VERSION}" not in hass.data[DATA_EXTRA_MODULE_URL].urls
