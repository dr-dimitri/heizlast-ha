"""Exercise scheduled weather requests and the real Home Assistant sensor lifecycle."""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from aiohttp import ClientError
from homeassistant import loader
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import callback
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed_exact,
    async_test_home_assistant,
)
from pytest_homeassistant_custom_component.test_util.aiohttp import (
    AiohttpClientMockResponse,
)
from yarl import URL

from custom_components.heizlast_ha.const import DOMAIN
from custom_components.heizlast_ha.sensor import OPEN_METEO_URL

pytestmark = pytest.mark.usefixtures("enable_custom_integrations", "bundled_card")
FACADE_ATTRIBUTES = {
    f"facade_{direction}_w_m2" for direction in ("north", "east", "south", "west")
}


@pytest.fixture
def modeled_sun(monkeypatch):
    """Control solar geometry independently from the synthetic irradiance fields."""
    from custom_components.heizlast_ha import sensor

    azimuth = Mock(return_value=180.0)
    elevation = Mock(return_value=60.0)
    monkeypatch.setattr(sensor.sun, "azimuth", azimuth)
    monkeypatch.setattr(sensor.sun, "elevation", elevation)
    return azimuth, elevation


@pytest.fixture
def observed_expirations(monkeypatch):
    """Observe real HA expiry callbacks without replacing their scheduling behavior."""
    from custom_components.heizlast_ha.sensor import WeatherPoller

    original = WeatherPoller._async_expire_facades
    calls = []

    @callback
    def record_expiry(self, now):
        calls.append(now)
        original(self, now)

    monkeypatch.setattr(WeatherPoller, "_async_expire_facades", record_expiry)
    return calls


def sample(value):
    """Return synthetic test weather without storing any actual site location."""
    return {
        "current": {"temperature_2m": value},
        "current_units": {"temperature_2m": "°C"},
    }


def solar_sample(value=8.0, ghi=500.0, dni=600.0, dhi=100.0, *, time=946684800):
    """Add synthetic irradiance and a known UTC model-validity timestamp."""
    return {
        "current": {
            "temperature_2m": value,
            "shortwave_radiation": ghi,
            "direct_normal_irradiance": dni,
            "diffuse_radiation": dhi,
            "time": time,
            "interval": 900,
        },
        "current_units": {
            "temperature_2m": "°C",
            "shortwave_radiation": "W/m²",
            "direct_normal_irradiance": "W/m²",
            "diffuse_radiation": "W/m²",
        },
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


def weather_state(hass, role):
    """Locate one shared-weather entity using its stable dashboard role."""
    states = [
        state
        for state in hass.states.async_all("sensor")
        if state.attributes.get("heizlast_ha_role") == role
    ]
    assert len(states) == 1
    return states[0]


def outdoor_state(hass):
    """Locate the same role attribute that is consumed by the dashboard."""
    return weather_state(hass, "outdoor_temperature")


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
    assert set(query["current"].split(",")) == {
        "temperature_2m",
        "shortwave_radiation",
        "direct_normal_irradiance",
        "diffuse_radiation",
    }
    assert query["timeformat"] == "unixtime"
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


async def test_one_request_updates_four_sensors_and_retains_temperature_identity(
    hass, mock_outdoor_temperature_http, freezer
):
    """All metrics share one timer, one HTTP response and its model-validity time."""
    from homeassistant.helpers import entity_registry as er

    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(), solar_sample(9, 400, 500, 50)])
    entry = await setup_entry(hass)
    assert client.call_count == 1
    registry = er.async_get(hass)
    temperature = outdoor_state(hass)
    assert registry.async_get(temperature.entity_id).unique_id == (
        f"{entry.entry_id}_outdoor_temperature"
    )
    assert temperature.attributes["valid_time"] == "2000-01-01T00:00:00+00:00"
    assert "averaging_interval_seconds" not in temperature.attributes
    for role, value in [
        ("solar_radiation", "500.0"),
        ("direct_normal_irradiance", "600.0"),
        ("diffuse_radiation", "100.0"),
    ]:
        state = weather_state(hass, role)
        assert state.state == value
        assert state.attributes["unit_of_measurement"] == "W/m²"
        assert state.attributes["device_class"] == "irradiance"
        assert state.attributes["state_class"] == "measurement"
        assert state.attributes["valid_time"] == "2000-01-01T00:00:00+00:00"
        assert state.attributes["averaging_interval_seconds"] == 900
        assert not {"latitude", "longitude", "location", "timezone", "elevation"} & (
            state.attributes.keys()
        )
    await advance(hass, freezer, timedelta(minutes=29, seconds=59))
    assert client.call_count == 1
    await advance(hass, freezer, timedelta(seconds=1))
    assert client.call_count == 2
    assert outdoor_state(hass).state == "9.0"
    assert weather_state(hass, "solar_radiation").state == "400.0"
    assert weather_state(hass, "direct_normal_irradiance").state == "500.0"
    assert weather_state(hass, "diffuse_radiation").state == "50.0"


@pytest.mark.parametrize("invalid", [None, True, -1, "unavailable", float("inf")])
async def test_invalid_solar_values_do_not_discard_valid_temperature(
    hass, mock_outdoor_temperature_http, freezer, invalid
):
    client = mock_outdoor_temperature_http
    mock_responses(
        client,
        [solar_sample(), solar_sample(12, invalid, invalid, invalid, time=946686600)],
    )
    await setup_entry(hass)
    await advance(hass, freezer, timedelta(minutes=30))
    assert outdoor_state(hass).state == "12.0"
    assert outdoor_state(hass).attributes["valid_time"] == "2000-01-01T00:30:00+00:00"
    for role, value in [
        ("solar_radiation", "500.0"),
        ("direct_normal_irradiance", "600.0"),
        ("diffuse_radiation", "100.0"),
    ]:
        state = weather_state(hass, role)
        assert state.state == value
        assert state.attributes["valid_time"] == "2000-01-01T00:00:00+00:00"


async def test_missing_fields_and_wrong_units_do_not_discard_other_metrics(
    hass, mock_outdoor_temperature_http, freezer
):
    client = mock_outdoor_temperature_http
    partial = solar_sample(value=None, ghi=0, dhi=10, time=946686600)
    partial["current"].pop("direct_normal_irradiance")
    partial["current_units"]["diffuse_radiation"] = "W"
    mock_responses(client, [solar_sample(), partial])
    await setup_entry(hass)
    await advance(hass, freezer, timedelta(minutes=30))
    assert client.call_count == 2
    assert outdoor_state(hass).state == "8.0"
    assert weather_state(hass, "solar_radiation").state == "0.0"
    assert weather_state(hass, "solar_radiation").attributes["valid_time"] == (
        "2000-01-01T00:30:00+00:00"
    )
    assert weather_state(hass, "direct_normal_irradiance").state == "600.0"
    assert weather_state(hass, "diffuse_radiation").state == "100.0"


async def test_solar_values_unknown_until_success_and_initial_failure_retries_once(
    hass, mock_outdoor_temperature_http, freezer
):
    client = mock_outdoor_temperature_http
    mock_responses(client, [TimeoutError(), solar_sample(3, 0, 0, 0)])
    await setup_entry(hass)
    for role in [
        "outdoor_temperature",
        "solar_radiation",
        "direct_normal_irradiance",
        "diffuse_radiation",
    ]:
        assert weather_state(hass, role).state == STATE_UNAVAILABLE
    await advance(hass, freezer, timedelta(minutes=30))
    assert client.call_count == 2
    for role in ["solar_radiation", "direct_normal_irradiance", "diffuse_radiation"]:
        assert weather_state(hass, role).state == "0.0"


async def test_failed_requests_keep_all_values_and_validity_times_then_recover(
    hass, mock_outdoor_temperature_http, freezer
):
    client = mock_outdoor_temperature_http
    mock_responses(
        client,
        [solar_sample(), TimeoutError(), ClientError(), solar_sample(9, 0, 0, 0)],
    )
    await setup_entry(hass)
    original = {
        role: weather_state(hass, role)
        for role in [
            "outdoor_temperature",
            "solar_radiation",
            "direct_normal_irradiance",
            "diffuse_radiation",
        ]
    }
    for _ in range(2):
        await advance(hass, freezer, timedelta(minutes=30))
        for role, state in original.items():
            assert weather_state(hass, role).state == state.state
            assert weather_state(hass, role).attributes == state.attributes
    assert client.call_count == 3
    await advance(hass, freezer, timedelta(minutes=30))
    assert client.call_count == 4
    assert weather_state(hass, "solar_radiation").state == "0.0"
    assert outdoor_state(hass).state == "9.0"


async def test_reload_restores_all_native_values_and_solar_validity_metadata(
    hass, mock_outdoor_temperature_http, freezer
):
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(), TimeoutError(), solar_sample(9, 0, 0, 0)])
    entry = await setup_entry(hass)
    original = {
        role: weather_state(hass, role)
        for role in [
            "outdoor_temperature",
            "solar_radiation",
            "direct_normal_irradiance",
            "diffuse_radiation",
        ]
    }
    assert await hass.config_entries.async_unload(entry.entry_id)
    await advance(hass, freezer, timedelta(hours=1))
    assert client.call_count == 1
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert client.call_count == 2
    for role, state in original.items():
        assert weather_state(hass, role).entity_id == state.entity_id
        assert weather_state(hass, role).state == state.state
        assert weather_state(hass, role).attributes == state.attributes
    await advance(hass, freezer, timedelta(minutes=30))
    assert client.call_count == 3
    assert weather_state(hass, "diffuse_radiation").state == "0.0"


async def test_restart_restores_native_solar_values_and_original_valid_time(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun
):
    """Load saved restore-state data in a fresh Home Assistant instance."""
    from homeassistant.helpers import restore_state

    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(), TimeoutError()])
    entry = await setup_entry(hass)
    original = {
        role: weather_state(hass, role)
        for role in [
            "outdoor_temperature",
            "solar_radiation",
            "direct_normal_irradiance",
            "diffuse_radiation",
        ]
    }
    assert FACADE_ATTRIBUTES.issubset(original["solar_radiation"].attributes)
    await restore_state.async_get(hass).async_dump_states()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_stop(force=True)
    async with async_test_home_assistant(
        config_dir=hass.config.config_dir
    ) as restarted:
        restarted.data.pop(loader.DATA_CUSTOM_COMPONENTS)
        await restore_state.async_get(restarted).async_load()
        replacement = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={})
        replacement.add_to_hass(restarted)
        assert await restarted.config_entries.async_setup(replacement.entry_id)
        await restarted.async_block_till_done()
        assert client.call_count == 2
        try:
            for role, state in original.items():
                assert weather_state(restarted, role).state == state.state
                assert weather_state(restarted, role).attributes == {
                    key: value
                    for key, value in state.attributes.items()
                    if key not in FACADE_ATTRIBUTES
                }
        finally:
            assert await restarted.config_entries.async_unload(replacement.entry_id)
            await restarted.async_stop(force=True)


@pytest.mark.parametrize("invalid", [None, "private location", True, -1, 1e100])
async def test_invalid_validity_metadata_is_omitted_without_exposing_other_data(
    hass, mock_outdoor_temperature_http, invalid
):
    client = mock_outdoor_temperature_http
    payload = solar_sample(time=invalid)
    payload["current"]["interval"] = invalid
    payload["latitude"] = 0.0
    payload["longitude"] = 0.0
    mock_responses(client, [payload])
    await setup_entry(hass)
    state = weather_state(hass, "solar_radiation")
    assert state.state == "500.0"
    assert "valid_time" not in state.attributes
    assert "averaging_interval_seconds" not in state.attributes
    assert "latitude" not in state.attributes
    assert "longitude" not in state.attributes


async def test_iso_model_validity_time_is_normalized_to_utc(
    hass, mock_outdoor_temperature_http
):
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(time="2000-01-01T01:00:00+01:00")])
    await setup_entry(hass)
    assert weather_state(hass, "solar_radiation").attributes["valid_time"] == (
        datetime(2000, 1, 1, tzinfo=UTC).isoformat()
    )


@pytest.mark.parametrize(
    ("azimuth", "sunward"), [(0, "north"), (90, "east"), (180, "south"), (270, "west")]
)
async def test_facades_use_irradiance_components_and_correct_cardinal_geometry(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun, azimuth, sunward
):
    """A known 60° sun produces 300 W/m² direct irradiance on the facing wall."""
    freezer.move_to("2000-01-01T00:00:00+00:00")
    hass.config.latitude = 0.0
    hass.config.longitude = 0.0
    azimuth_mock, elevation_mock = modeled_sun
    azimuth_mock.return_value = azimuth
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample()])
    await setup_entry(hass)
    state = weather_state(hass, "solar_radiation")
    assert state.state == "500.0"
    # DHI/2 + albedo*GHI/2 = 50 + 50 for every vertical orientation.
    for direction in ("north", "east", "south", "west"):
        assert state.attributes[f"facade_{direction}_w_m2"] == pytest.approx(
            400 if direction == sunward else 100
        )
    assert client.call_count == 1
    assert len(hass.states.async_all("sensor")) == 4
    observer, midpoint = azimuth_mock.call_args.args
    assert observer.latitude == 0.0
    assert observer.longitude == 0.0
    assert midpoint == datetime(1999, 12, 31, 23, 52, 30, tzinfo=UTC)
    elevation_mock.assert_called_once_with(observer, midpoint, with_refraction=False)
    assert not {"latitude", "longitude", "azimuth", "elevation", "observer"} & (
        state.attributes.keys()
    )
    for role in (
        "outdoor_temperature",
        "direct_normal_irradiance",
        "diffuse_radiation",
    ):
        assert FACADE_ATTRIBUTES.isdisjoint(weather_state(hass, role).attributes)


@pytest.mark.parametrize("elevation", [0, -10])
async def test_sun_at_or_below_horizon_has_no_direct_facade_component(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun, elevation
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    modeled_sun[1].return_value = elevation
    mock_responses(mock_outdoor_temperature_http, [solar_sample()])
    await setup_entry(hass)
    state = weather_state(hass, "solar_radiation")
    assert [state.attributes[key] for key in sorted(FACADE_ATTRIBUTES)] == [100.0] * 4


async def test_night_with_zero_model_radiation_has_zero_facade_irradiance(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    modeled_sun[1].return_value = -20
    mock_responses(mock_outdoor_temperature_http, [solar_sample(ghi=0, dni=0, dhi=0)])
    await setup_entry(hass)
    assert [
        weather_state(hass, "solar_radiation").attributes[key]
        for key in sorted(FACADE_ATTRIBUTES)
    ] == [0.0] * 4


@pytest.mark.parametrize(
    ("time", "interval"),
    [
        (946681140, 900),  # More than one hour old.
        (946681200, 900),  # Exactly at the expiry boundary.
        (946685160, 900),  # More than five minutes in the future.
        (None, 900),
        (946684800, None),
        (946684800, 0),
        (946684800, True),
        (946684800, 7200),
    ],
)
async def test_stale_future_or_invalid_interval_omits_facades_but_keeps_raw_values(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun, time, interval
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    payload = solar_sample(time=time)
    payload["current"]["interval"] = interval
    mock_responses(mock_outdoor_temperature_http, [payload])
    await setup_entry(hass)
    state = weather_state(hass, "solar_radiation")
    assert state.state == "500.0"
    assert FACADE_ATTRIBUTES.isdisjoint(state.attributes)
    modeled_sun[0].assert_not_called()
    modeled_sun[1].assert_not_called()


@pytest.mark.parametrize("error", [ClientError(), TimeoutError()])
async def test_failed_request_removes_previous_facades_and_preserves_raw_sample(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun, error
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(), error])
    await setup_entry(hass)
    before = weather_state(hass, "solar_radiation")
    assert FACADE_ATTRIBUTES.issubset(before.attributes)
    await advance(hass, freezer, timedelta(minutes=30))
    after = weather_state(hass, "solar_radiation")
    assert client.call_count == 2
    assert after.state == before.state
    assert after.attributes["valid_time"] == before.attributes["valid_time"]
    assert FACADE_ATTRIBUTES.isdisjoint(after.attributes)


async def test_partial_response_never_combines_new_fields_with_cached_solar_components(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    partial = solar_sample(9, ghi=700, dni=None, dhi=150, time=946686600)
    mock_responses(client, [solar_sample(), partial])
    await setup_entry(hass)
    assert FACADE_ATTRIBUTES.issubset(weather_state(hass, "solar_radiation").attributes)
    await advance(hass, freezer, timedelta(minutes=30))
    assert outdoor_state(hass).state == "9.0"
    state = weather_state(hass, "solar_radiation")
    assert state.state == "700.0"
    assert state.attributes["valid_time"] == "2000-01-01T00:30:00+00:00"
    cached_dni = weather_state(hass, "direct_normal_irradiance")
    assert cached_dni.state == "600.0"
    assert cached_dni.attributes["valid_time"] == "2000-01-01T00:00:00+00:00"
    assert FACADE_ATTRIBUTES.isdisjoint(state.attributes)


async def test_reload_restores_raw_solar_value_without_restoring_old_facade_attributes(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(), ClientError()])
    entry = await setup_entry(hass)
    before = weather_state(hass, "solar_radiation")
    assert FACADE_ATTRIBUTES.issubset(before.attributes)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    after = weather_state(hass, "solar_radiation")
    assert client.call_count == 2
    assert after.state == before.state
    assert after.attributes["valid_time"] == before.attributes["valid_time"]
    assert FACADE_ATTRIBUTES.isdisjoint(after.attributes)


@pytest.mark.parametrize("inconsistent", ["time", "interval"])
async def test_facade_helper_rejects_components_with_inconsistent_validity(
    hass, freezer, modeled_sun, inconsistent
):
    from custom_components.heizlast_ha.sensor import WeatherReading, _facade_irradiance

    freezer.move_to("2000-01-01T00:00:00+00:00")
    current = "2000-01-01T00:00:00+00:00"
    readings = {
        "solar_radiation": WeatherReading(500, current, 900),
        "direct_normal_irradiance": WeatherReading(600, current, 900),
        "diffuse_radiation": WeatherReading(
            100,
            "1999-12-31T23:45:00+00:00" if inconsistent == "time" else current,
            3600 if inconsistent == "interval" else 900,
        ),
    }
    assert _facade_irradiance(hass, readings) == {}
    modeled_sun[0].assert_not_called()


async def test_old_sample_expires_at_one_hour_without_a_new_request(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun
):
    """A sample already 59 minutes old is valid for only one more minute."""
    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(time=946681260)])
    await setup_entry(hass)
    initial = weather_state(hass, "solar_radiation")
    assert FACADE_ATTRIBUTES.issubset(initial.attributes)
    await advance(hass, freezer, timedelta(seconds=59))
    assert FACADE_ATTRIBUTES.issubset(weather_state(hass, "solar_radiation").attributes)
    await advance(hass, freezer, timedelta(seconds=1))
    expired = weather_state(hass, "solar_radiation")
    assert FACADE_ATTRIBUTES.isdisjoint(expired.attributes)
    assert expired.state == initial.state == "500.0"
    assert expired.attributes["valid_time"] == initial.attributes["valid_time"]
    assert outdoor_state(hass).state == "8.0"
    assert client.call_count == 1


async def test_new_sample_replaces_the_previous_expiry_deadline(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun, observed_expirations
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    mock_responses(
        client,
        [solar_sample(time=946683600), solar_sample(9, 400, 500, 50, time=946686600)],
    )
    await setup_entry(hass)
    await advance(hass, freezer, timedelta(minutes=30))
    updated = weather_state(hass, "solar_radiation")
    assert FACADE_ATTRIBUTES.issubset(updated.attributes)
    assert updated.attributes["valid_time"] == "2000-01-01T00:30:00+00:00"
    # The former sample would expire at minute 40; the replacement remains fresh.
    await advance(hass, freezer, timedelta(minutes=10))
    assert observed_expirations == []
    assert FACADE_ATTRIBUTES.issubset(weather_state(hass, "solar_radiation").attributes)
    assert weather_state(hass, "solar_radiation").state == "400.0"
    assert client.call_count == 2


async def test_unload_cancels_the_facade_expiry_callback(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun, observed_expirations
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(time=946681260)])
    entry = await setup_entry(hass)
    assert FACADE_ATTRIBUTES.issubset(weather_state(hass, "solar_radiation").attributes)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await advance(hass, freezer, timedelta(minutes=31))
    assert observed_expirations == []
    assert client.call_count == 1


@pytest.mark.parametrize(
    "response", [ClientError(), solar_sample(dni=None, time=946686600)]
)
async def test_failed_or_partial_refresh_cancels_the_former_expiry_timer(
    hass,
    mock_outdoor_temperature_http,
    freezer,
    modeled_sun,
    observed_expirations,
    response,
):
    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(), response])
    await setup_entry(hass)
    await advance(hass, freezer, timedelta(minutes=30))
    assert FACADE_ATTRIBUTES.isdisjoint(
        weather_state(hass, "solar_radiation").attributes
    )
    # Stop before the second polling interval while passing the cancelled deadline.
    entity = hass.data["sensor"].get_entity(
        weather_state(hass, "solar_radiation").entity_id
    )
    entity._weather._cancel_interval()
    await advance(hass, freezer, timedelta(minutes=31))
    assert observed_expirations == []
    assert client.call_count == 2


async def test_expiry_publishes_while_a_request_is_blocked_until_timeout(
    hass, mock_outdoor_temperature_http, freezer, modeled_sun
):
    """A pending request must not extend the previous sample's freshness window."""
    freezer.move_to("2000-01-01T00:00:00+00:00")
    client = mock_outdoor_temperature_http
    mock_responses(client, [solar_sample(time=946681260)])
    await setup_entry(hass)
    await advance(hass, freezer, timedelta(seconds=59))
    state = weather_state(hass, "solar_radiation")
    entity = hass.data["sensor"].get_entity(state.entity_id)
    client.clear_requests()
    requested = asyncio.Event()
    request_cancelled = asyncio.Event()

    async def pending_response(method, url, data):
        requested.set()
        try:
            await asyncio.Event().wait()
        finally:
            request_cancelled.set()

    client.get(OPEN_METEO_URL, side_effect=pending_response)
    poll = asyncio.create_task(entity._weather._async_poll(datetime.now(UTC)))
    try:
        await requested.wait()
        assert FACADE_ATTRIBUTES.issubset(
            weather_state(hass, "solar_radiation").attributes
        )
        freezer.tick(timedelta(seconds=1))
        async_fire_time_changed_exact(hass)
        await hass.async_block_till_done()
        expired = weather_state(hass, "solar_radiation")
        assert FACADE_ATTRIBUTES.isdisjoint(expired.attributes)
        assert expired.state == "500.0"
        assert outdoor_state(hass).state == "8.0"
        assert client.call_count == 1
        assert not poll.done()
        freezer.tick(timedelta(seconds=9))
        async_fire_time_changed_exact(hass)
        await poll
        assert request_cancelled.is_set()
        assert FACADE_ATTRIBUTES.isdisjoint(
            weather_state(hass, "solar_radiation").attributes
        )
        assert client.call_count == 1
    finally:
        if not poll.done():
            poll.cancel()
            with pytest.raises(asyncio.CancelledError):
                await poll
