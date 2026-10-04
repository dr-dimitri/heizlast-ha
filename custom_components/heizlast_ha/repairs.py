"""Ask users to reload their dashboards after the bundled card changes."""

from typing import Any

import voluptuous as vol
from homeassistant.components.repairs import RepairsFlow, RepairsFlowResult
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .const import CONF_DASHBOARD_FINGERPRINT, CONF_DASHBOARD_INITIAL_INSTALL, DOMAIN
from .frontend import DashboardModule

ISSUE_PREFIX = "dashboard_reload_"


@callback
def async_clear_dashboard_issues(
    hass: HomeAssistant, *, keep_issue_id: str | None = None
) -> None:
    """Remove only obsolete dashboard notices belonging to this integration."""
    for domain, issue_id in list(ir.async_get(hass).issues):
        if (
            domain == DOMAIN
            and issue_id.startswith(ISSUE_PREFIX)
            and issue_id != keep_issue_id
        ):
            ir.async_delete_issue(hass, domain, issue_id)


@callback
def async_check_dashboard_update(
    hass: HomeAssistant, entry: ConfigEntry, dashboard: DashboardModule
) -> None:
    """Keep the last user-confirmed bundle across restarts and HACS upgrades."""
    if entry.data.get(CONF_DASHBOARD_INITIAL_INSTALL) is True:
        data = dict(entry.data)
        data.pop(CONF_DASHBOARD_INITIAL_INSTALL)
        data[CONF_DASHBOARD_FINGERPRINT] = dashboard.fingerprint
        hass.config_entries.async_update_entry(entry, data=data)

    if entry.data.get(CONF_DASHBOARD_FINGERPRINT) == dashboard.fingerprint:
        async_clear_dashboard_issues(hass)
        return

    # Existing installations without a fingerprint need a one-time reload too.
    issue_id = f"{ISSUE_PREFIX}{dashboard.fingerprint}"
    async_clear_dashboard_issues(hass, keep_issue_id=issue_id)
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=True,
        severity=ir.IssueSeverity.WARNING,
        translation_key="dashboard_reload",
        translation_placeholders={"version": dashboard.version},
        data={"entry_id": entry.entry_id, "fingerprint": dashboard.fingerprint},
    )


class DashboardReloadRepairFlow(RepairsFlow):
    """Record an explicit reload confirmation; loading one tab is insufficient."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> RepairsFlowResult:
        """Show instructions before recording confirmation."""
        return await self.async_step_confirm()

    async def async_step_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> RepairsFlowResult:
        """Acknowledge only the dashboard version this repair was opened for."""
        entry_id = (self.data or {}).get("entry_id")
        entry = (
            self.hass.config_entries.async_get_entry(entry_id)
            if isinstance(entry_id, str)
            else None
        )
        dashboard = self.hass.data.get(DOMAIN, {}).get("dashboard")
        if (
            entry is None
            or entry.domain != DOMAIN
            or entry.state is not ConfigEntryState.LOADED
            or not isinstance(dashboard, DashboardModule)
        ):
            return self.async_abort(reason="dashboard_unavailable")
        if dashboard.fingerprint != (self.data or {}).get("fingerprint"):
            return self.async_abort(reason="dashboard_changed")
        if user_input is not None:
            self.hass.config_entries.async_update_entry(
                entry,
                data={**entry.data, CONF_DASHBOARD_FINGERPRINT: dashboard.fingerprint},
            )
            return self.async_create_entry(data={})
        return self.async_show_form(
            step_id="confirm",
            data_schema=vol.Schema({}),
            description_placeholders={"version": dashboard.version},
        )


async def async_create_fix_flow(
    hass: HomeAssistant,
    issue_id: str,
    data: dict[str, str | int | float | None] | None,
) -> RepairsFlow:
    """Expose the native Home Assistant repair flow."""
    return DashboardReloadRepairFlow()
