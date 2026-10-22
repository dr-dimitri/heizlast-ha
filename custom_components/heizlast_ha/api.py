"""Authenticated websocket commands for the dashboard card."""

import math
from datetime import UTC, datetime, timedelta
from typing import Any

import voluptuous as vol
from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .planning import ENERGY_SENSOR_ROLES, ProjectError
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
        vol.Optional("temperatures"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_planning_bindings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Commit sensor selections and fixed temperatures for calculation zones."""
    try:
        result = await get_project(hass).async_save_planning_bindings(
            msg["revision"], msg["bindings"], msg.get("temperatures")
        )
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_weather"})
@callback
def ws_get_weather(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Read the shared weather cache without extra HTTP requests or writes."""
    weather = hass.data.get(DOMAIN, {}).get("weather")
    if weather is None:
        connection.send_error(msg["id"], "not_loaded", "Wetterdaten nicht verfügbar.")
        return
    connection.send_result(msg["id"], weather.forecast_snapshot())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_gas_price",
        vol.Required("revision"): int,
        vol.Required("gas_price_ct_per_kwh"): vol.Any(None, int, float),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_gas_price(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Save the gas work price with the same project concurrency protection."""
    try:
        result = await get_project(hass).async_save_gas_price(
            msg["revision"], msg["gas_price_ct_per_kwh"]
        )
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_energy_settings",
        vol.Required("revision"): int,
        vol.Required("settings"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_energy_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Persist the generator and source sensors with shared revision protection."""
    try:
        result = await get_project(hass).async_save_energy_settings(
            msg["revision"], msg["settings"]
        )
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_energy_sources"})
@callback
def ws_get_energy_sources(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """List only supported, readable source identities, independently of names."""
    try:
        project = get_project(hass)
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    result: dict[str, list[dict[str, str]]] = {
        "pv_forecast": [],
        "electricity_price": [],
        "feed_in_tariff": [],
    }
    for entity in sorted(
        er.async_get(hass).entities.values(), key=lambda item: item.entity_id
    ):
        if (
            entity.disabled_by is not None
            or not connection.user.permissions.check_entity(
                entity.entity_id, POLICY_READ
            )
        ):
            continue
        for role in ENERGY_SENSOR_ROLES:
            if project._is_energy_sensor(role, entity.entity_id):
                result[role.removesuffix("_entity_id")].append(
                    {
                        "entity_id": entity.entity_id,
                        "config_entry_id": entity.config_entry_id,
                    }
                )
    connection.send_result(msg["id"], result)


def _energy_time(value: Any) -> datetime:
    """Accept absolute instants only; never infer the browser's timezone."""
    try:
        parsed = dt_util.parse_datetime(value) if isinstance(value, str) else None
        if parsed is not None and parsed.utcoffset() is not None:
            return parsed.astimezone(UTC)
    except ValueError, OverflowError:
        pass
    raise ProjectError("PV-Prognose: Ein Zeitwert mit UTC-Offset ist erforderlich.")


def _energy_forecast_snapshot(
    response: Any, start: datetime, end: datetime
) -> dict[str, Any]:
    """Expose only complete hourly energy and freshness, never the raw PV result."""
    unavailable = {
        "intervals": [],
        "fetched_at": None,
        "expires_at": None,
        "status": "unavailable",
        "reason": "incomplete_forecast",
    }
    if (
        not isinstance(response, dict)
        or type(response.get("schema_version")) is not int
        or response["schema_version"] != 1
    ):
        return unavailable
    window = response.get("window")
    if not isinstance(window, dict):
        return unavailable
    if window.get("status") != "available":
        reason = window.get("reason")
        return {
            **unavailable,
            "reason": reason
            if reason in {"outside_forecast", "stale_forecast", "input_fallbacks"}
            else "incomplete_forecast",
        }
    try:
        fetched = _energy_time(window.get("fetched_at"))
        if not timedelta(0) <= dt_util.utcnow() - fetched < timedelta(hours=1):
            return {**unavailable, "reason": "stale_forecast"}
        rows = window.get("intervals")
        if (
            not isinstance(rows, list)
            or len(rows) != (end - start).total_seconds() / 3600
        ):
            return unavailable
        intervals = []
        cursor = start
        for row in rows:
            if not isinstance(row, dict):
                return unavailable
            left, right = _energy_time(row.get("start")), _energy_time(row.get("end"))
            energy = row.get("energy_kwh")
            if (
                left != cursor
                or right - left != timedelta(hours=1)
                or type(energy) not in (int, float)
                or not 0 <= energy <= float("inf")
                or not math.isfinite(energy)
            ):
                return unavailable
            intervals.append(
                {
                    "start": left.isoformat(),
                    "end": right.isoformat(),
                    "energy_kwh": energy,
                }
            )
            cursor = right
        if cursor != end:
            return unavailable
    except ProjectError, OverflowError, ValueError:
        return unavailable
    return {
        "intervals": intervals,
        "fetched_at": fetched.isoformat(),
        "expires_at": (fetched + timedelta(hours=1)).isoformat(),
        "status": "available",
        "reason": None,
    }


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/get_energy_forecast",
        vol.Required("pv_forecast_entity_id"): str,
        vol.Required("start"): str,
        vol.Required("end"): str,
    }
)
@websocket_api.async_response
async def ws_get_energy_forecast(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Query the selected PV integration's read-only cache with caller permissions."""
    try:
        project = get_project(hass)
        if not project._is_energy_sensor(
            "pv_forecast_entity_id", msg["pv_forecast_entity_id"]
        ):
            raise ProjectError("PV-Prognose: Der ausgewählte Sensor ist unbekannt.")
        if not connection.user.permissions.check_entity(
            msg["pv_forecast_entity_id"], POLICY_READ
        ):
            raise ProjectError("PV-Prognose: Leserechte fehlen.", "unauthorized")
        start, end = _energy_time(msg["start"]), _energy_time(msg["end"])
        duration = (end - start).total_seconds()
        if not 0 < duration <= 26 * 3600 or duration % 3600:
            raise ProjectError("PV-Prognose: Höchstens 26 ganze Stunden abfragen.")
        entity = er.async_get(hass).async_get(msg["pv_forecast_entity_id"])
        assert entity is not None
        response = await hass.services.async_call(
            "pv_forecast",
            "get_forecast",
            {
                "config_entry_id": entity.config_entry_id,
                "window": {
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "step_minutes": 60,
                },
            },
            blocking=True,
            return_response=True,
            context=connection.context(msg),
        )
    except ProjectError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    except HomeAssistantError:
        connection.send_error(
            msg["id"], "source_unavailable", "PV-Prognose nicht verfügbar."
        )
        return
    connection.send_result(msg["id"], _energy_forecast_snapshot(response, start, end))


@callback
def async_register_api(hass: HomeAssistant) -> None:
    """Register once; handlers look up the active project on every request."""
    websocket_api.async_register_command(hass, ws_get_project)
    websocket_api.async_register_command(hass, ws_save_planning_bindings)
    websocket_api.async_register_command(hass, ws_save_gas_price)
    websocket_api.async_register_command(hass, ws_get_weather)
    websocket_api.async_register_command(hass, ws_save_energy_settings)
    websocket_api.async_register_command(hass, ws_get_energy_sources)
    websocket_api.async_register_command(hass, ws_get_energy_forecast)
