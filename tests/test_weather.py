"""Exercise scheduled weather requests and the real Home Assistant sensor lifecycle."""

import asyncio
from datetime import timedelta

import pytest
from aiohttp import ClientError
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed_exact,
)
from pytest_homeassistant_custom_component.test_util.aiohttp import (
    AiohttpClientMockResponse,
)
from yarl import URL

from custom_components.heizlast_ha.const import DOMAIN
from custom_components.heizlast_ha.sensor import OPEN_METEO_URL

pytestmark = pytest.mark.usefixtures("enable_custom_integrations", "bundled_card")


def sample(value):
    """Return synthetic test weather without storing any actual site location."""
    return {
        "current": {"temperature_2m": value},
        "current_units": {"temperature_2m": "°C"},
    }


def mock_responses(client, responses):
    """Serve sequential weather responses through Home Assistant's HTTP mock."""
    client.clear_requests()
    remaining = iter(responses)

    async def next_response(method, url, data):
        result = next(remaining)
        if isinstance(result, Exception):
            raise result
        return AiohttpClientMockResponse("get", URL(OPEN_METEO_URL), json=result)

    client.get(OPEN_METEO_URL, side_effect=next_response)


async def setup_entry(hass):
    """Load the integration and all of its real sensor platform callbacks."""
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry


def outdoor_state(hass):
    """Locate the same role attribute that is consumed by the dashboard."""
    states = [
        state
        for state in hass.states.async_all("sensor")
        if state.attributes.get("heizlast_ha_role") == "outdoor_temperature"
    ]
    assert len(states) == 1
    return states[0]


async def advance(hass, freezer, delta):
    """Advance precisely, including background tasks created by interval timers."""
    freezer.tick(delta)
    async_fire_time_changed_exact(hass)
    await hass.async_block_till_done(wait_background_tasks=True)


async def test_request_uses_home_assistant_location_without_exposing_it(
    hass, mock_outdoor_temperature_http, freezer
):
    """The next request also reads changed HA coordinates rather than a stored copy."""
    hass.config.latitude = 0.0
    hass.config.longitude = 0.0
    client = mock_outdoor_temperature_http
    mock_responses(client, [sample(8.5), sample(9.5)])
    await setup_entry(hass)
    state = outdoor_state(hass)
    assert state.state == "8.5"
    assert state.attributes["device_class"] == "temperature"
    assert state.attributes["state_class"] == "measurement"
    assert state.attributes["unit_of_measurement"] == "°C"
    assert "Open-Meteo" in state.attributes["attribution"]
    query = client.mock_calls[0][1].query
    assert query["latitude"] == "0.0"
    assert query["longitude"] == "0.0"
    assert query["current"] == "temperature_2m"
    assert query["temperature_unit"] == "celsius"
    assert not {"latitude", "longitude", "location", "elevation", "timezone"} & (
        state.attributes.keys()
    )
    hass.config.latitude = 1.0
    hass.config.longitude = -1.0
    await advance(hass, freezer, timedelta(minutes=30))
    query = client.mock_calls[1][1].query
    assert query["latitude"] == "1.0"
    assert query["longitude"] == "-1.0"
    assert outdoor_state(hass).state == "9.5"


@pytest.mark.parametrize("error", [ClientError("private request"), TimeoutError()])
async def test_initial_failure_still_loads_and_retries_after_thirty_minutes(
    hass, mock_outdoor_temperature_http, freezer, error, caplog
):
    client = mock_outdoor_temperature_http
    mock_responses(client, [error, sample(4.5)])
    await setup_entry(hass)
    assert outdoor_state(hass).state == STATE_UNAVAILABLE
    assert client.call_count == 1
    assert "private request" not in caplog.text
    await advance(hass, freezer, timedelta(minutes=29, seconds=59))
    assert client.call_count == 1
    await advance(hass, freezer, timedelta(seconds=1))
    assert client.call_count == 2
    assert outdoor_state(hass).state == "4.5"


@pytest.mark.parametrize("error", [ClientError("private request"), TimeoutError()])
async def test_failure_retains_last_value_and_retries_on_the_same_interval(
    hass, mock_outdoor_temperature_http, freezer, error
):
    client = mock_outdoor_temperature_http
    mock_responses(client, [sample(7.5), error, error, sample(6.0)])
    await setup_entry(hass)
    await advance(hass, freezer, timedelta(minutes=29, seconds=59))
    assert client.call_count == 1
    await advance(hass, freezer, timedelta(seconds=1))
    assert client.call_count == 2
    assert outdoor_state(hass).state == "7.5"
    await advance(hass, freezer, timedelta(minutes=29, seconds=59))
    assert client.call_count == 2
    await advance(hass, freezer, timedelta(seconds=1))
    assert client.call_count == 3
    assert outdoor_state(hass).state == "7.5"
    await advance(hass, freezer, timedelta(minutes=30))
    assert client.call_count == 4
    assert outdoor_state(hass).state == "6.0"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        [],
        sample(None),
        sample(True),
        sample("unavailable"),
        {"current": {"temperature_2m": 8}, "current_units": {"temperature_2m": "°F"}},
    ],
)
async def test_invalid_responses_retain_last_temperature(
    hass, mock_outdoor_temperature_http, freezer, payload
):
    client = mock_outdoor_temperature_http
    mock_responses(client, [sample(10.0), payload, sample(11.0)])
    await setup_entry(hass)
    await advance(hass, freezer, timedelta(minutes=30))
    assert outdoor_state(hass).state == "10.0"
    await advance(hass, freezer, timedelta(minutes=30))
    assert outdoor_state(hass).state == "11.0"


async def test_http_error_is_retried_without_exposing_location(
    hass, mock_outdoor_temperature_http, freezer, caplog
):
    client = mock_outdoor_temperature_http
    client.clear_requests()
    client.get(OPEN_METEO_URL, status=503)
    await setup_entry(hass)
    assert outdoor_state(hass).state == STATE_UNAVAILABLE
    assert "latitude" not in caplog.text
    assert "longitude" not in caplog.text
    assert OPEN_METEO_URL not in caplog.text
    client.clear_requests()
    client.get(OPEN_METEO_URL, json=sample(5.0))
    await advance(hass, freezer, timedelta(minutes=30))
    assert client.call_count == 1
    assert outdoor_state(hass).state == "5.0"


async def test_unload_cancels_requests_and_reload_restores_last_success(
    hass, mock_outdoor_temperature_http, freezer
):
    client = mock_outdoor_temperature_http
    mock_responses(client, [sample(12.0), ClientError(), sample(13.0)])
    entry = await setup_entry(hass)
    entity_id = outdoor_state(hass).entity_id
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    await advance(hass, freezer, timedelta(hours=1))
    assert client.call_count == 1
    assert hass.states.get(entity_id).state == STATE_UNAVAILABLE
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert client.call_count == 2
    assert outdoor_state(hass).entity_id == entity_id
    assert outdoor_state(hass).state == "12.0"
    await advance(hass, freezer, timedelta(minutes=30))
    assert client.call_count == 3
    assert outdoor_state(hass).state == "13.0"


async def test_unload_cancels_an_in_flight_request(
    hass, mock_outdoor_temperature_http, freezer
):
    client = mock_outdoor_temperature_http
    entry = await setup_entry(hass)
    client.clear_requests()
    requested = asyncio.Event()
    cancelled = asyncio.Event()

    async def pending_response(method, url, data):
        requested.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    client.get(OPEN_METEO_URL, side_effect=pending_response)
    freezer.tick(timedelta(minutes=30))
    async_fire_time_changed_exact(hass)
    await requested.wait()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert cancelled.is_set()
    await advance(hass, freezer, timedelta(minutes=30))
    assert client.call_count == 1
