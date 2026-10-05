"""Authenticated websocket commands for the dashboard card."""

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .planning import ProjectError
from .project import Project


def get_project(hass: HomeAssistant) -> Project:
    """Resolve the currently loaded entry, also after unload and reload."""
    project = hass.data.get(DOMAIN, {}).get("project")
    if project is None:
        raise ProjectError(
            "Bitte die Integration Heizlast HA zuerst in Home Assistant einrichten.",
            "not_loaded",
        )
    return project


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_project"})
@callback
def ws_get_project(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return data to an authenticated Home Assistant websocket connection."""
    try:
        result = get_project(hass).snapshot()
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_planning_bindings",
        vol.Required("revision"): int,
        vol.Required("bindings"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_planning_bindings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Commit sensor selections for the bundled calculation zones."""
    try:
        result = await get_project(hass).async_save_planning_bindings(
            msg["revision"], msg["bindings"]
        )
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@callback
def async_register_api(hass: HomeAssistant) -> None:
    """Register once; handlers look up the active project on every request."""
    websocket_api.async_register_command(hass, ws_get_project)
    websocket_api.async_register_command(hass, ws_save_planning_bindings)
