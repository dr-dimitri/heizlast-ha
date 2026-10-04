"""Exercise dashboard update notices through Home Assistant's repairs manager."""

from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.components.repairs import repairs_flow_manager
from homeassistant.config_entries import SOURCE_USER
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.translation import async_get_translations
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.heizlast_ha.const import (
    CONF_DASHBOARD_FINGERPRINT,
    CONF_DASHBOARD_INITIAL_INSTALL,
    DOMAIN,
)
from custom_components.heizlast_ha.repairs import (
    ISSUE_PREFIX,
    async_check_dashboard_update,
)

pytestmark = pytest.mark.usefixtures("enable_custom_integrations", "bundled_card")


def dashboard_issues(hass):
    return [
        issue
        for (domain, issue_id), issue in ir.async_get(hass).issues.items()
        if domain == DOMAIN and issue_id.startswith(ISSUE_PREFIX)
    ]


async def setup_entry(hass, data=None):
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data=data or {})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def open_repair(hass):
    [issue] = dashboard_issues(hass)
    manager = repairs_flow_manager(hass)
    assert manager is not None
    result = await manager.async_init(DOMAIN, data={"issue_id": issue.issue_id})
    assert result["type"] == "form"
    assert result["step_id"] == "confirm"
    return manager, result


async def test_first_install_baselines_dashboard_without_notice(hass):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    created = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert created["type"] == "create_entry"
    await hass.async_block_till_done()
    entry = created["result"]
    assert CONF_DASHBOARD_INITIAL_INSTALL not in entry.data
    assert entry.data[CONF_DASHBOARD_FINGERPRINT] == (
        hass.data[DOMAIN]["dashboard"].fingerprint
    )
    assert dashboard_issues(hass) == []


async def test_existing_installation_gets_one_time_notice_and_can_confirm(hass):
    entry = await setup_entry(hass, {"existing_setting": "preserved"})
    project = entry.runtime_data.snapshot()
    [issue] = dashboard_issues(hass)
    assert issue.is_fixable
    assert issue.severity is ir.IssueSeverity.WARNING
    assert issue.translation_key == "dashboard_reload"
    manager, result = await open_repair(hass)
    assert result["description_placeholders"] == issue.translation_placeholders
    assert CONF_DASHBOARD_FINGERPRINT not in entry.data
    result = await manager.async_configure(result["flow_id"], {})
    assert result["type"] == "create_entry"
    assert dashboard_issues(hass) == []
    assert entry.data["existing_setting"] == "preserved"
    assert entry.runtime_data.snapshot() == project
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert dashboard_issues(hass) == []


async def test_changed_bundle_remains_pending_until_confirmation(hass, bundled_card):
    previous = sha256(b"previous dashboard").hexdigest()
    entry = await setup_entry(hass, {CONF_DASHBOARD_FINGERPRINT: previous})
    [issue] = dashboard_issues(hass)
    current = sha256(bundled_card.read_bytes()).hexdigest()
    assert issue.issue_id == f"{ISSUE_PREFIX}{current}"
    assert entry.data[CONF_DASHBOARD_FINGERPRINT] == previous
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert dashboard_issues(hass)[0].issue_id == issue.issue_id
    assert entry.data[CONF_DASHBOARD_FINGERPRINT] == previous
    manager, result = await open_repair(hass)
    await manager.async_configure(result["flow_id"], {})
    assert entry.data[CONF_DASHBOARD_FINGERPRINT] == current
    assert dashboard_issues(hass) == []


async def test_backend_version_change_with_same_dashboard_does_not_notify(
    hass, bundled_card
):
    current = sha256(bundled_card.read_bytes()).hexdigest()
    entry = await setup_entry(hass, {CONF_DASHBOARD_FINGERPRINT: current})
    with patch(
        "custom_components.heizlast_ha.frontend.async_get_integration",
        AsyncMock(return_value=SimpleNamespace(version="99.0.0")),
    ):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
    assert hass.data[DOMAIN]["dashboard"].version == "99.0.0"
    assert entry.data[CONF_DASHBOARD_FINGERPRINT] == current
    assert dashboard_issues(hass) == []


async def test_a_new_bundle_replaces_an_ignored_notice(hass, bundled_card):
    entry = await setup_entry(hass)
    [previous] = dashboard_issues(hass)
    ir.async_ignore_issue(hass, DOMAIN, previous.issue_id, True)
    async_check_dashboard_update(hass, entry, hass.data[DOMAIN]["dashboard"])
    assert dashboard_issues(hass)[0].dismissed_version is not None
    bundled_card.write_text("export const updatedDashboard = true;\n")
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    [current] = dashboard_issues(hass)
    assert current.issue_id != previous.issue_id
    assert current.dismissed_version is None


async def test_old_repair_cannot_acknowledge_a_newer_bundle(hass, bundled_card):
    entry = await setup_entry(hass)
    manager, result = await open_repair(hass)
    bundled_card.write_text("export const newerDashboard = true;\n")
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    [current] = dashboard_issues(hass)
    result = await manager.async_configure(result["flow_id"], {})
    assert result["type"] == "abort"
    assert result["reason"] == "dashboard_changed"
    assert CONF_DASHBOARD_FINGERPRINT not in entry.data
    assert dashboard_issues(hass)[0].issue_id == current.issue_id


async def test_unloaded_integration_cannot_be_confirmed(hass):
    entry = await setup_entry(hass)
    manager, result = await open_repair(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert dashboard_issues(hass) == []
    assert "dashboard" not in hass.data[DOMAIN]
    result = await manager.async_configure(result["flow_id"], {})
    assert result["type"] == "abort"
    assert result["reason"] == "dashboard_unavailable"
    assert CONF_DASHBOARD_FINGERPRINT not in entry.data


async def test_cleanup_preserves_other_integration_issues(hass):
    ir.async_create_issue(
        hass,
        DOMAIN,
        "other_problem",
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="other_problem",
    )
    entry = await setup_entry(hass)
    assert await hass.config_entries.async_remove(entry.entry_id)
    assert dashboard_issues(hass) == []
    assert ir.async_get(hass).async_get_issue(DOMAIN, "other_problem") is not None


@pytest.mark.parametrize("language", ["de", "en"])
async def test_repair_instructions_are_available_in_home_assistant(hass, language):
    await setup_entry(hass)
    translations = await async_get_translations(hass, language, "issues", {DOMAIN})
    prefix = f"component.{DOMAIN}.issues.dashboard_reload"
    assert "{version}" in translations[f"{prefix}.title"]
    instructions = translations[f"{prefix}.fix_flow.step.confirm.description"]
    assert "F5" in instructions
    assert "{version}" in instructions
    assert translations[f"{prefix}.fix_flow.abort.dashboard_changed"]
    assert translations[f"{prefix}.fix_flow.abort.dashboard_unavailable"]
