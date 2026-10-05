"""Configuration flow for the fixed residential dashboard."""

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import CONF_DASHBOARD_INITIAL_INSTALL, DOMAIN


class HeizlastConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create one integration entry without collecting unnecessary credentials."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for setup confirmation and prevent duplicate instances."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(
                title="Heizlast HA", data={CONF_DASHBOARD_INITIAL_INSTALL: True}
            )
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))
