"""Poll outdoor temperature for the fixed dashboard using Home Assistant's location."""

import asyncio
import logging
import math
from datetime import datetime, timedelta

from aiohttp import ClientError
from homeassistant.components.sensor import (
    RestoreSensor,
    SensorDeviceClass,
    SensorStateClass,
)
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval

from . import HeizlastConfigEntry

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
UPDATE_INTERVAL = timedelta(minutes=30)
REQUEST_TIMEOUT = 10
_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HeizlastConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the outdoor sensor even when the first weather request fails."""
    async_add_entities([OutdoorTemperatureSensor(entry)], update_before_add=True)


class OutdoorTemperatureSensor(RestoreSensor):
    """Keep the latest valid temperature and retry on a fixed 30-minute interval."""

    _attr_has_entity_name = True
    _attr_translation_key = "outdoor_temperature"
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_suggested_display_precision = 1
    _attr_should_poll = False
    _attr_attribution = "Weather data by Open-Meteo.com"

    def __init__(self, entry: HeizlastConfigEntry) -> None:
        """Use a stable identity without exposing location in entity metadata."""
        self._attr_unique_id = f"{entry.entry_id}_outdoor_temperature"
        self._attr_available = False
        self._attr_native_value = None
        self._update_lock = asyncio.Lock()
        self._active = False
        self._poll_task: asyncio.Task | None = None
        self._request_failed = False

    @property
    def capability_attributes(self) -> dict:
        """Keep the fixed dashboard role identifiable even before the first sample."""
        return {
            **(super().capability_attributes or {}),
            "heizlast_ha_role": "outdoor_temperature",
        }

    async def async_added_to_hass(self) -> None:
        """Restore the last sample and start polling only while the sensor exists."""
        await super().async_added_to_hass()
        if self.native_value is None and (
            last := await self.async_get_last_sensor_data()
        ):
            if (
                last.native_unit_of_measurement == UnitOfTemperature.CELSIUS
                and _valid_temperature(last.native_value)
            ):
                self._attr_native_value = last.native_value
                self._attr_available = True
        self._active = True
        self.async_on_remove(
            async_track_time_interval(
                self.hass,
                self._async_poll,
                UPDATE_INTERVAL,
                name="Heizlast HA outdoor temperature",
                cancel_on_shutdown=True,
            )
        )

    async def async_will_remove_from_hass(self) -> None:
        """Cancel an in-flight request before Home Assistant removes this entity."""
        self._active = False
        if self._poll_task is not None:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        await super().async_will_remove_from_hass()

    async def _async_poll(self, now: datetime) -> None:
        """Refresh on the fixed schedule, including after failed requests."""
        if not self._active:
            return
        self._poll_task = asyncio.current_task()
        try:
            await self.async_update()
            if self._active:
                self.async_write_ha_state()
        finally:
            self._poll_task = None

    async def async_update(self) -> None:
        """Read only temperature from the response, retaining successful samples."""
        async with self._update_lock:
            try:
                async with asyncio.timeout(REQUEST_TIMEOUT):
                    async with async_get_clientsession(self.hass).get(
                        OPEN_METEO_URL,
                        params={
                            "latitude": self.hass.config.latitude,
                            "longitude": self.hass.config.longitude,
                            "current": "temperature_2m",
                            "temperature_unit": "celsius",
                            "forecast_days": 1,
                        },
                    ) as response:
                        response.raise_for_status()
                        data = await response.json()
                value = data["current"]["temperature_2m"]
                if data["current_units"][
                    "temperature_2m"
                ] != UnitOfTemperature.CELSIUS or not _valid_temperature(value):
                    raise ValueError
            except ClientError, TimeoutError, KeyError, TypeError, ValueError:
                # Exceptions can contain the request URL, including private coordinates.
                if not self._request_failed:
                    _LOGGER.warning(
                        "Outdoor temperature refresh failed; retrying in 30 minutes"
                    )
                self._request_failed = True
                return
            if self._request_failed:
                _LOGGER.info("Outdoor temperature refresh recovered")
            self._request_failed = False
            self._attr_native_value = float(value)
            self._attr_available = True


def _valid_temperature(value: object) -> bool:
    """Accept finite numeric samples; missing values and booleans are not readings."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False
