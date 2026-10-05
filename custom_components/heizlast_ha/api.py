"""Authenticated websocket commands for the dashboard card."""

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .project import Project
from .validation import ProjectError


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
        vol.Required("type"): f"{DOMAIN}/save_project",
        vol.Required("revision"): int,
        vol.Required("plan"): vol.Any(dict, None),
        vol.Required("bindings"): dict,
        vol.Optional("confirmed_removed_room_ids", default=list): [str],
        vol.Optional("room_operations", default=list): [dict],
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_project(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Commit a checked import, correction, or set of room sensor assignments."""
    try:
        result = await get_project(hass).async_save(
            msg["revision"],
            msg["plan"],
            msg["bindings"],
            msg["confirmed_removed_room_ids"],
            msg["room_operations"],
        )
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@callback
def async_register_api(hass: HomeAssistant) -> None:
    """Register once; handlers look up the active project on every request."""
    websocket_api.async_register_command(hass, ws_get_project)
    websocket_api.async_register_command(hass, ws_save_project)
