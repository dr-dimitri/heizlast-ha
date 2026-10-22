"""Hourly weather uses the shared poller and authenticated read-only API."""

from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from zoneinfo import ZoneInfo

import pytest
from homeassistant.util import dt as dt_util

from custom_components.heizlast_ha.const import DOMAIN
from custom_components.heizlast_ha.sensor import WeatherPoller, _hourly_weather
from tests.test_weather import advance, mock_responses, setup_entry, solar_sample

pytestmark = pytest.mark.usefixtures("enable_custom_integrations", "bundled_card")


def hourly_sample(start, count=193):
    """Synthetic UTC hourly values, including the following midnight endpoint."""
    sample = solar_sample(time=int(start.timestamp()))
    sample["hourly_units"] = {**sample["current_units"], "time": "unixtime"}
    sample["hourly"] = {
        "time": [int(start.timestamp()) + 3600 * index for index in range(count)],
        "temperature_2m": [float(index % 24) for index in range(count)],
        "shortwave_radiation": [200.0] * count,
        "direct_normal_irradiance": [300.0] * count,
        "diffuse_radiation": [50.0] * count,
    }
    return sample


def test_aligns_radiation_end_with_same_hour_temperature_and_solar_midpoint(
    hass, monkeypatch
):
    from custom_components.heizlast_ha import sensor

    start = datetime(2026, 1, 1, tzinfo=UTC)
    azimuth, elevation = Mock(return_value=180), Mock(return_value=45)
    monkeypatch.setattr(sensor.sun, "azimuth", azimuth)
    monkeypatch.setattr(sensor.sun, "elevation", elevation)
    data = hourly_sample(start, 3)
    data["hourly"]["shortwave_radiation"] = [0, 200, 400]
    result = _hourly_weather(hass, data)
    first = result[int(start.timestamp())]
    assert first["outdoorTemperatureC"] == 0.5
    assert first["globalIrradianceWPerM2"] == 200
    assert first["facadeIrradiance"]["N"] == 45
    assert first["facadeIrradiance"]["S"] > first["facadeIrradiance"]["N"]
    assert azimuth.call_args_list[0].args[1] == start + timedelta(minutes=30)
    assert "latitude" not in str(result)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda data: data["hourly_units"].update(temperature_2m="°F"),
        lambda data: data["hourly_units"].update(time="iso8601"),
        lambda data: data["hourly"].update(time=[True, 3601, 7201]),
        lambda data: data["hourly"].update(time=[0, 3600, 3600]),
        lambda data: data["hourly"].update(time=[0, 3600, 10800]),
        lambda data: data["hourly"].update(diffuse_radiation=[]),
    ],
)
def test_rejects_ambiguous_units_lengths_and_time_axis(hass, mutation):
    data = hourly_sample(datetime(2026, 1, 1, tzinfo=UTC), 3)
    mutation(data)
    assert _hourly_weather(hass, data) == {}


def test_missing_solar_is_a_gap_and_zero_is_valid(hass):
    start = datetime(2026, 1, 1, tzinfo=UTC)
    data = hourly_sample(start, 4)
    for field in (
        "shortwave_radiation",
        "direct_normal_irradiance",
        "diffuse_radiation",
    ):
        data["hourly"][field] = [0, 0, None, 0]
    result = _hourly_weather(hass, data)
    assert int(start.timestamp()) in result
    assert int(start.timestamp()) + 3600 not in result
    assert int(start.timestamp()) + 7200 in result
    assert result[int(start.timestamp())]["facadeIrradiance"] == dict.fromkeys(
        "NESW", 0
    )


@pytest.mark.parametrize(
    ("date", "count"), [("2026-03-29", 23), ("2026-10-25", 25), ("2026-01-01", 24)]
)
def test_complete_local_day_including_dst(hass, freezer, date, count):
    hass.config.time_zone = "Europe/Berlin"
    freezer.move_to(f"{date} 12:00:00+00:00")
    poller = WeatherPoller(hass)
    day = poller.forecast_snapshot()["days"][0]
    assert day["date"] == date
    assert len(day["hours"]) == count
    times = [datetime.fromisoformat(hour["time"]) for hour in day["hours"]]
    assert times[0].astimezone(ZoneInfo("Europe/Berlin")).hour == 0
    assert all(
        b - a == timedelta(hours=1) for a, b in zip(times, times[1:], strict=False)
    )
    assert all(set(hour) == {"time"} for hour in day["hours"])


async def test_shared_refresh_cache_expiry_location_changes_and_unload(
    hass, freezer, mock_outdoor_temperature_http, hass_ws_client, hass_read_only_user
):
    hass.config.latitude = 0
    hass.config.longitude = 0
    hass.config.time_zone = "UTC"
    freezer.move_to("2026-01-01 00:00:00+00:00")
    data = hourly_sample(dt_util.utcnow())
    client = mock_outdoor_temperature_http
    mock_responses(client, [data, data, TimeoutError()])
    entry = await setup_entry(hass)
    token = hass.auth.async_create_access_token(
        await hass.auth.async_create_refresh_token(
            hass_read_only_user, client_id="https://example.test"
        )
    )
    ws = await hass_ws_client(hass, token)
    await ws.send_json({"id": 1, "type": "heizlast_ha/get_weather"})
    result = (await ws.receive_json())["result"]
    assert len(client.mock_calls) == 1
    assert (
        client.mock_calls[0][1].query["hourly"]
        == client.mock_calls[0][1].query["current"]
    )
    assert result["days"][0]["hours"][0]["outdoorTemperatureC"] == 0.5
    assert set(result) == {"timezone", "fetched_at", "days"}
    await ws.close()
    poller = hass.data[DOMAIN]["weather"]
    hass.config.longitude = 1
    assert poller.forecast_snapshot()["fetched_at"] is None
    await advance(hass, freezer, timedelta(minutes=30))
    assert poller.forecast_snapshot()["fetched_at"] is not None
    await advance(hass, freezer, timedelta(minutes=30))
    assert poller.forecast_snapshot()["fetched_at"] is None
    assert (
        "outdoorTemperatureC" not in poller.forecast_snapshot()["days"][0]["hours"][0]
    )
    assert await hass.config_entries.async_unload(entry.entry_id)
    token = hass.auth.async_create_access_token(
        await hass.auth.async_create_refresh_token(
            hass_read_only_user, client_id="https://example.test"
        )
    )
    ws = await hass_ws_client(hass, token)
    await ws.send_json({"id": 2, "type": "heizlast_ha/get_weather"})
    assert (await ws.receive_json())["error"]["code"] == "not_loaded"
    assert "weather" not in hass.data[DOMAIN]


def test_forecast_expires_without_another_network_request(hass, freezer):
    poller = WeatherPoller(hass)
    poller.fetched_at = dt_util.utcnow()
    poller._location = (hass.config.latitude, hass.config.longitude)
    assert poller.forecast_snapshot()["fetched_at"]
    freezer.tick(timedelta(minutes=60))
    assert poller.forecast_snapshot()["fetched_at"] is None


def test_fractional_offset_weights_adjacent_weather_without_filling_gaps(hass, freezer):
    hass.config.time_zone = "Asia/Kolkata"
    freezer.move_to("2026-01-01 12:00:00+00:00")
    poller = WeatherPoller(hass)
    start = datetime(2025, 12, 31, tzinfo=UTC)
    poller.hourly = _hourly_weather(hass, hourly_sample(start))
    poller.fetched_at = dt_util.utcnow()
    poller._location = (hass.config.latitude, hass.config.longitude)
    first = poller.forecast_snapshot()["days"][0]["hours"][0]
    assert first["time"] == "2025-12-31T18:30:00+00:00"
    assert first["outdoorTemperatureC"] == 19
    del poller.hourly[int(start.timestamp()) + 19 * 3600]
    assert set(poller.forecast_snapshot()["days"][0]["hours"][0]) == {"time"}


async def test_hourly_and_current_failures_are_independent(
    hass, freezer, mock_outdoor_temperature_http
):
    freezer.move_to("2026-01-01 00:00:00+00:00")
    data = hourly_sample(dt_util.utcnow())
    data["current"] = {}
    mock_responses(mock_outdoor_temperature_http, [data, solar_sample()])
    poller = WeatherPoller(hass)
    await poller.async_refresh()
    assert poller.hourly
    assert not poller.readings
    await poller.async_refresh()
    assert not poller.hourly
    assert poller.readings
