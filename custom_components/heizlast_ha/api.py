"""Authenticated websocket commands and image delivery for the dashboard card."""

from typing import Any

import voluptuous as vol
from aiohttp import web
from homeassistant.components import websocket_api
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, IMAGE_PATH
from .images import check_image_file
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
        vol.Required("type"): f"{DOMAIN}/upload_image",
        vol.Required("name"): str,
        vol.Required("data"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_upload_image(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Persist a verified PNG or JPEG; writes require administrator access."""
    try:
        metadata = await get_project(hass).async_upload(msg["name"], msg["data"])
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], metadata)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_project",
        vol.Required("revision"): int,
        vol.Required("plan"): vol.Any(dict, None),
        vol.Required("bindings"): dict,
        vol.Optional("confirmed_removed_room_ids", default=list): [str],
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
        )
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


class FloorplanImageView(HomeAssistantView):
    """Serve private floor plans using HA authentication or a signed path."""

    url = f"{IMAGE_PATH}{{image_id}}"
    name = f"api:{DOMAIN}:image"
    requires_auth = True

    async def get(self, request: web.Request, image_id: str) -> web.FileResponse:
        """Serve only images whose verified metadata belongs to the loaded project."""
        hass = request.app[KEY_HASS]
        try:
            project = get_project(hass)
            metadata = next(
                (
                    item
                    for item in project.snapshot()["images"]
                    if item["background"] == f"{IMAGE_PATH}{image_id}"
                ),
                None,
            )
            if metadata is None:
                raise web.HTTPNotFound
            path = await hass.async_add_executor_job(
                check_image_file, project.image_dir, metadata
            )
        except ProjectError as err:
            raise web.HTTPNotFound from err
        if path is None:
            raise web.HTTPNotFound
        return web.FileResponse(
            path,
            headers={
                "Content-Type": metadata["mime"],
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )


@callback
def async_register_api(hass: HomeAssistant) -> None:
    """Register once; handlers look up the active project on every request."""
    websocket_api.async_register_command(hass, ws_get_project)
    websocket_api.async_register_command(hass, ws_upload_image)
    websocket_api.async_register_command(hass, ws_save_project)
    hass.http.register_view(FloorplanImageView())
