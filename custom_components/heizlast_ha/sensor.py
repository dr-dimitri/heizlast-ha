"""Fetch outdoor temperature and solar radiation together from Open-Meteo."""

import asyncio
import logging
import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from aiohttp import ClientError
from astral import Observer, sun
from homeassistant.components.sensor import (
    RestoreSensor,
    SensorDeviceClass,
    SensorStateClass,
)
from homeassistant.const import UnitOfIrradiance, UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import (
    async_track_point_in_utc_time,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util

from . import HeizlastConfigEntry

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
UPDATE_INTERVAL = timedelta(minutes=30)
REQUEST_TIMEOUT = 10
MAX_SOLAR_AGE = timedelta(minutes=60)
MAX_SOLAR_FUTURE = timedelta(minutes=5)
MAX_SOLAR_INTERVAL_SECONDS = 3600
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class WeatherMetric:
    """Map an API field to a stable dashboard role and Home Assistant unit."""

    field: str
    role: str
    device_class: SensorDeviceClass
    unit: str


METRICS = (
    WeatherMetric(
        "temperature_2m",
        "outdoor_temperature",
        SensorDeviceClass.TEMPERATURE,
        UnitOfTemperature.CELSIUS,
    ),
    WeatherMetric(
        "shortwave_radiation",
        "solar_radiation",
        SensorDeviceClass.IRRADIANCE,
        UnitOfIrradiance.WATTS_PER_SQUARE_METER,
    ),
    WeatherMetric(
        "direct_normal_irradiance",
        "direct_normal_irradiance",
        SensorDeviceClass.IRRADIANCE,
        UnitOfIrradiance.WATTS_PER_SQUARE_METER,
    ),
    WeatherMetric(
        "diffuse_radiation",
        "diffuse_radiation",
        SensorDeviceClass.IRRADIANCE,
        UnitOfIrradiance.WATTS_PER_SQUARE_METER,
    ),
)


@dataclass(frozen=True)
class WeatherReading:
    """Retain the validity metadata with each independently accepted sample."""

    value: float
    valid_time: str | None = None
    interval: int | None = None


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HeizlastConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Make one initial request and add all sensors even if weather is unavailable."""
    weather = WeatherPoller(hass)
    await weather.async_refresh()
    async_add_entities(
        [OutdoorWeatherSensor(entry, weather, metric) for metric in METRICS]
    )


class WeatherPoller:
    """Share one fixed 30-minute request across the enabled weather sensors."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Keep only requested readings, without any location response metadata."""
        self.hass = hass
        self.readings: dict[str, WeatherReading] = {}
        self.facade_irradiance: dict[str, float] = {}
        self._listeners: set[Callable[[], None]] = set()
        self._cancel_interval: Callable[[], None] | None = None
        self._cancel_facade_expiry: Callable[[], None] | None = None
        self._facade_expires_at: datetime | None = None
        self._update_lock = asyncio.Lock()
        self._poll_task: asyncio.Task | None = None
        self._request_failed = False

    @callback
    def async_subscribe(self, listener: Callable[[], None]) -> None:
        """Start the shared timer when the first weather entity is added."""
        self._listeners.add(listener)
        if self._cancel_interval is None:
            self._cancel_interval = async_track_time_interval(
                self.hass,
                self._async_poll,
                UPDATE_INTERVAL,
                name="Heizlast HA weather",
                cancel_on_shutdown=True,
            )
            self._async_schedule_facade_expiry()

    @callback
    def _async_cancel_facade_expiry(self) -> None:
        """Cancel the former sample's expiry before replacing or clearing its model."""
        if self._cancel_facade_expiry is not None:
            self._cancel_facade_expiry()
            self._cancel_facade_expiry = None

    @callback
    def _async_schedule_facade_expiry(self) -> None:
        """Expire the current model precisely when its API sample becomes too old."""
        self._async_cancel_facade_expiry()
        if not self._listeners or self._facade_expires_at is None:
            return
        if self._facade_expires_at <= dt_util.utcnow():
            self._async_expire_facades(dt_util.utcnow())
            return
        self._cancel_facade_expiry = async_track_point_in_utc_time(
            self.hass, self._async_expire_facades, self._facade_expires_at
        )

    @callback
    def _async_expire_facades(self, now: datetime) -> None:
        """Remove only derived solar corrections, publishing without another request."""
        self._cancel_facade_expiry = None
        self._facade_expires_at = None
        self.facade_irradiance = {}
        for listener in tuple(self._listeners):
            listener()

    async def async_unsubscribe(self, listener: Callable[[], None]) -> None:
        """Cancel the timer and in-flight request after the last entity is removed."""
        self._listeners.discard(listener)
        if self._listeners:
            return
        self._async_cancel_facade_expiry()
        if self._cancel_interval is not None:
            self._cancel_interval()
            self._cancel_interval = None
        if self._poll_task is not None:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass

    async def _async_poll(self, now: datetime) -> None:
        """Fetch once at every interval, including after failed requests."""
        if not self._listeners:
            return
        self._poll_task = asyncio.current_task()
        try:
            await self.async_refresh()
            for listener in tuple(self._listeners):
                listener()
        finally:
            self._poll_task = None

    async def async_refresh(self) -> None:
        """Accept valid fields independently and keep every last successful reading."""
        async with self._update_lock:
            try:
                async with asyncio.timeout(REQUEST_TIMEOUT):
                    async with async_get_clientsession(self.hass).get(
                        OPEN_METEO_URL,
                        params={
                            "latitude": self.hass.config.latitude,
                            "longitude": self.hass.config.longitude,
                            "current": ",".join(metric.field for metric in METRICS),
                            "temperature_unit": "celsius",
                            "timeformat": "unixtime",
                            "forecast_days": 1,
                        },
                    ) as response:
                        response.raise_for_status()
                        data = await response.json()
                current = data["current"]
                units = data["current_units"]
                if not isinstance(current, dict) or not isinstance(units, dict):
                    raise ValueError
                valid_time = _valid_time(current.get("time"))
                interval = _valid_interval(current.get("interval"))
                accepted = {
                    metric.role: WeatherReading(float(value), valid_time, interval)
                    for metric in METRICS
                    if units.get(metric.field) == metric.unit
                    and _valid_value(
                        value := current.get(metric.field),
                        solar=metric.device_class is SensorDeviceClass.IRRADIANCE,
                    )
                }
                if not accepted:
                    raise ValueError
            except ClientError, TimeoutError, KeyError, TypeError, ValueError:
                self._async_cancel_facade_expiry()
                self._facade_expires_at = None
                self.facade_irradiance = {}
                # Exceptions can include the request URL and private coordinates.
                if not self._request_failed:
                    _LOGGER.warning("Weather refresh failed; retrying in 30 minutes")
                self._request_failed = True
                return
            if self._request_failed:
                _LOGGER.info("Weather refresh recovered")
            self._request_failed = False
            self._async_cancel_facade_expiry()
            self._facade_expires_at = None
            self.readings.update(accepted)
            self.facade_irradiance = _facade_irradiance(self.hass, accepted)
            if self.facade_irradiance and valid_time is not None:
                sample_time = dt_util.parse_datetime(valid_time)
                if sample_time is not None:
                    self._facade_expires_at = sample_time + MAX_SOLAR_AGE
            self._async_schedule_facade_expiry()


class OutdoorWeatherSensor(RestoreSensor):
    """Expose one shared weather metric and restore its last valid sample."""

    _attr_has_entity_name = True
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1
    _attr_should_poll = False
    _attr_attribution = "Weather data by Open-Meteo.com"

    def __init__(
        self, entry: HeizlastConfigEntry, weather: WeatherPoller, metric: WeatherMetric
    ) -> None:
        """Preserve the outdoor-temperature identity and use neutral solar roles."""
        self._weather = weather
        self._metric = metric
        self._attr_unique_id = f"{entry.entry_id}_{metric.role}"
        self._attr_translation_key = metric.role
        self._attr_device_class = metric.device_class
        self._attr_native_unit_of_measurement = metric.unit
        self._attr_available = False
        self._attr_native_value = None
        self._attr_extra_state_attributes = {}
        self._active = False

    @property
    def capability_attributes(self) -> dict:
        """Keep the stable dashboard role identifiable even before the first sample."""
        return {
            **(super().capability_attributes or {}),
            "heizlast_ha_role": self._metric.role,
        }

    async def async_added_to_hass(self) -> None:
        """Restore independently, then subscribe without making another request."""
        await super().async_added_to_hass()
        if self._metric.role not in self._weather.readings and (
            last := await self.async_get_last_sensor_data()
        ):
            if last.native_unit_of_measurement == self._metric.unit and _valid_value(
                last.native_value,
                solar=self.device_class is SensorDeviceClass.IRRADIANCE,
            ):
                state = await self.async_get_last_state()
                attrs = state.attributes if state else {}
                self._weather.readings[self._metric.role] = WeatherReading(
                    float(last.native_value),
                    _valid_time(attrs.get("valid_time")),
                    _valid_interval(attrs.get("averaging_interval_seconds")),
                )
        self._active = True
        self._weather.async_subscribe(self._async_weather_updated)
        self._async_weather_updated(write_state=False)

    async def async_will_remove_from_hass(self) -> None:
        """Unsubscribe before saving the native value and validity metadata."""
        self._active = False
        await self._weather.async_unsubscribe(self._async_weather_updated)
        await super().async_will_remove_from_hass()

    @callback
    def _async_weather_updated(self, write_state: bool = True) -> None:
        """Publish the cached value; missing fields retain their previous metadata."""
        if not self._active:
            return
        if reading := self._weather.readings.get(self._metric.role):
            self._attr_native_value = reading.value
            self._attr_available = True
            self._attr_extra_state_attributes = {}
            if reading.valid_time is not None:
                self._attr_extra_state_attributes["valid_time"] = reading.valid_time
            if (
                self.device_class is SensorDeviceClass.IRRADIANCE
                and reading.interval is not None
            ):
                self._attr_extra_state_attributes["averaging_interval_seconds"] = (
                    reading.interval
                )
            if self._metric.role == "solar_radiation":
                self._attr_extra_state_attributes.update(
                    self._weather.facade_irradiance
                )
        if write_state:
            self.async_write_ha_state()


def _facade_irradiance(
    hass: HomeAssistant, accepted: dict[str, WeatherReading]
) -> dict[str, float]:
    """Approximate vertical irradiance from one fresh, coherent model response."""
    roles = ("solar_radiation", "direct_normal_irradiance", "diffuse_radiation")
    if any(role not in accepted for role in roles):
        return {}
    ghi, dni, dhi = (accepted[role] for role in roles)
    if (
        ghi.valid_time is None
        or ghi.interval is None
        or not 0 < ghi.interval <= MAX_SOLAR_INTERVAL_SECONDS
        or any(
            reading.valid_time != ghi.valid_time or reading.interval != ghi.interval
            for reading in (dni, dhi)
        )
    ):
        return {}
    valid_time = dt_util.parse_datetime(ghi.valid_time)
    if valid_time is None:
        return {}
    age = dt_util.utcnow() - valid_time
    if age >= MAX_SOLAR_AGE or age < -MAX_SOLAR_FUTURE:
        return {}
    midpoint = valid_time - timedelta(seconds=ghi.interval / 2)
    try:
        observer = Observer(hass.config.latitude, hass.config.longitude)
        azimuth = sun.azimuth(observer, midpoint)
        elevation = sun.elevation(observer, midpoint, with_refraction=False)
        if not _valid_value(azimuth, solar=False) or not _valid_value(
            elevation, solar=False
        ):
            return {}
        # A vertical plane sees half the isotropic sky and 20% reflected ground.
        diffuse_and_reflected = 0.5 * dhi.value + 0.1 * ghi.value
        horizontal_projection = (
            math.cos(math.radians(elevation)) if elevation > 0 else 0
        )
        facades = {
            f"facade_{name}_w_m2": diffuse_and_reflected
            + dni.value
            * max(
                0,
                horizontal_projection * math.cos(math.radians(azimuth - orientation)),
            )
            for name, orientation in (
                ("north", 0),
                ("east", 90),
                ("south", 180),
                ("west", 270),
            )
        }
        return (
            facades
            if all(_valid_value(value, solar=True) for value in facades.values())
            else {}
        )
    except OverflowError, TypeError, ValueError:
        return {}


def _valid_value(value: object, *, solar: bool) -> bool:
    """Accept finite numbers, and require nonnegative irradiance including zero."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value) and (not solar or value >= 0)
    except OverflowError:
        return False


def _valid_time(value: object) -> str | None:
    """Normalize model validity time to UTC without retaining other API metadata."""
    if isinstance(value, str):
        try:
            parsed = dt_util.parse_datetime(value)
        except ValueError:
            return None
        if parsed is None:
            return None
        return (
            parsed.replace(tzinfo=UTC).isoformat()
            if parsed.tzinfo is None
            else (parsed.astimezone(UTC).isoformat())
        )
    if not _valid_value(value, solar=True):
        return None
    try:
        return datetime.fromtimestamp(value, UTC).isoformat()
    except OverflowError, OSError, ValueError:
        return None


def _valid_interval(value: object) -> int | None:
    """Keep the API's averaging duration only when it is a positive integer."""
    return (
        value
        if isinstance(value, int) and not isinstance(value, bool) and value > 0
        else None
    )
