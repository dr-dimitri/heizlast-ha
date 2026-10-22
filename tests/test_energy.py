"""Check stored generator selections and the private, read-only PV cache bridge."""

from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
from homeassistant.core import SupportsResponse
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.file import WriteError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.heizlast_ha.api import get_project
from custom_components.heizlast_ha.const import DOMAIN
from custom_components.heizlast_ha.planning import (
    ProjectError,
    validate_energy_settings,
)
from custom_components.heizlast_ha.project import Project

pytestmark = pytest.mark.usefixtures("enable_custom_integrations", "bundled_card")


@pytest.fixture
def hass_storage():
    """Require durable on-disk writes instead of the test storage substitute."""
    return {}


@pytest.fixture
def hass_config_dir(tmp_path):
    """Isolate the durable integration state."""
    return str(tmp_path)


@pytest.fixture
async def entry(hass):
    item = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={})
    item.add_to_hass(hass)
    assert await hass.config_entries.async_setup(item.entry_id)
    await hass.async_block_till_done()
    return item


@pytest.fixture
def sources(hass):
    """Register neutral, renamed identities without loading external integrations."""
    registry = er.async_get(hass)
    pv = MockConfigEntry(domain="pv_forecast")
    sax = MockConfigEntry(domain="sax_power")
    pv.add_to_hass(hass)
    sax.add_to_hass(hass)
    result = {}
    for role, config, suffix, suggested in [
        ("pv_forecast", pv, "total_today", "renamed_pv"),
        ("electricity_price", sax, "economics_current_import_price", "renamed_import"),
        ("feed_in_tariff", sax, "economics_feed_in_price", "renamed_export"),
    ]:
        result[role] = registry.async_get_or_create(
            "sensor",
            config.domain,
            f"{config.entry_id}_{suffix}",
            config_entry=config,
            suggested_object_id=suggested,
        )
    return result


def settings(sources=None):
    """Use only explicitly selected sources; no prices or forecasts are invented."""
    return {
        "heat_generator": "bosch_aw5800_5",
        **{
            f"{role}_entity_id": sources[role].entity_id if sources else None
            for role in ("pv_forecast", "electricity_price", "feed_in_tariff")
        },
    }


async def send(ws, identifier, command, **payload):
    await ws.send_json({"id": identifier, "type": f"{DOMAIN}/{command}", **payload})
    response = await ws.receive_json()
    assert response["id"] == identifier
    return response


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        {},
        {**settings(), "heat_generator": "other"},
        {**settings(), "heat_generator": True},
        {**settings(), "extra": "value"},
        {**settings(), "pv_forecast_entity_id": "switch.pv"},
        {**settings(), "pv_forecast_entity_id": True},
        {**settings(), "electricity_price_entity_id": "sensor.unknown"},
    ],
)
def test_energy_settings_reject_invalid_or_unsupported_selections(value):
    with pytest.raises(ProjectError):
        validate_energy_settings(value, {}, lambda *_: False)


async def test_energy_settings_persist_and_preserve_room_gas_and_legacy_data(
    hass, entry, sources, hass_ws_client, hass_read_only_access_token
):
    project = get_project(hass)
    project.data["legacy"] = {"retained": True}
    ws = await hass_ws_client(hass)
    configured = settings(sources)
    saved = await send(ws, 1, "save_energy_settings", revision=0, settings=configured)
    assert saved["result"]["energy_settings"] == configured
    assert saved["result"]["revision"] == 1
    assert "legacy" not in saved["result"]
    readonly = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert (await send(readonly, 1, "get_project"))["result"] == saved["result"]
    rejected = await send(
        readonly, 2, "save_energy_settings", revision=1, settings=settings()
    )
    assert rejected["error"]["code"] == "unauthorized"
    await send(ws, 2, "save_gas_price", revision=1, gas_price_ct_per_kwh=12)
    await send(
        ws, 3, "save_planning_bindings", revision=2, bindings={}, temperatures={"5": 22}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    project = get_project(hass)
    assert project.snapshot()["energy_settings"] == configured
    assert project.snapshot()["gas_price_ct_per_kwh"] == 12
    assert project.snapshot()["planning_temperatures"] == {"5": 22}
    assert project.data["legacy"] == {"retained": True}
    # Removed historical sources remain readable and unchanged when switching model.
    er.async_get(hass).async_remove(sources["pv_forecast"].entity_id)
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == project.snapshot()
    switched = {**configured, "heat_generator": "gas"}
    changed = await send(ws, 4, "save_energy_settings", revision=3, settings=switched)
    assert changed["result"]["energy_settings"] == switched
    cleared = await send(ws, 5, "save_energy_settings", revision=4, settings=settings())
    assert cleared["result"]["energy_settings"] == settings()
    assert cleared["result"]["gas_price_ct_per_kwh"] == 12


async def test_energy_settings_conflicts_source_identity_and_storage_errors(
    hass, entry, sources, hass_ws_client
):
    ws = await hass_ws_client(hass)
    before = get_project(hass).snapshot()
    for identifier, revision, selection, code in [
        (1, 1, settings(), "conflict"),
        (
            2,
            0,
            {**settings(sources), "feed_in_tariff_entity_id": "sensor.not_a_sax_price"},
            "invalid_project",
        ),
        (
            3,
            0,
            {
                **settings(sources),
                "electricity_price_entity_id": sources["feed_in_tariff"].entity_id,
            },
            "invalid_project",
        ),
    ]:
        result = await send(
            ws,
            identifier,
            "save_energy_settings",
            revision=revision,
            settings=selection,
        )
        assert result["error"]["code"] == code
        assert get_project(hass).snapshot() == before
    with patch.object(
        Store, "_write_prepared_data", side_effect=WriteError("full disk")
    ):
        result = await send(
            ws, 4, "save_energy_settings", revision=0, settings=settings()
        )
    assert result["error"]["code"] == "storage_error"
    assert get_project(hass).snapshot() == before
    fresh = Project(hass)
    await fresh.async_load()
    assert fresh.snapshot() == before


async def test_corrupt_energy_settings_rejected_without_rewrite(hass, entry):
    project = get_project(hass)
    await project.store.async_save({**project.snapshot(), "energy_settings": {}})
    path = Path(project.store.path)
    before = path.read_bytes()
    with pytest.raises(ProjectError):
        await Project(hass).async_load()
    assert path.read_bytes() == before


async def test_energy_sources_include_only_readable_supported_registry_identities(
    hass,
    entry,
    sources,
    hass_ws_client,
    hass_read_only_access_token,
    hass_read_only_user,
):
    registry = er.async_get(hass)
    registry.async_get_or_create("sensor", "other", "unrelated")
    disabled = registry.async_get_or_create(
        "sensor",
        "pv_forecast",
        f"{sources['pv_forecast'].config_entry_id}_total_tomorrow",
        config_entry=hass.config_entries.async_get_entry(
            sources["pv_forecast"].config_entry_id
        ),
        suggested_object_id="disabled_pv",
        disabled_by=er.RegistryEntryDisabler.USER,
    )
    ws = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    response = await send(ws, 1, "get_energy_sources")
    assert response["result"] == {
        role: [{"entity_id": item.entity_id, "config_entry_id": item.config_entry_id}]
        for role, item in sources.items()
    }
    assert disabled.entity_id not in str(response)
    hass_read_only_user.mock_policy(
        {"entities": {"entity_ids": {sources["pv_forecast"].entity_id: {"read": True}}}}
    )
    restricted = await send(ws, 2, "get_energy_sources")
    assert restricted["result"]["pv_forecast"] == response["result"]["pv_forecast"]
    assert restricted["result"]["electricity_price"] == []
    assert restricted["result"]["feed_in_tariff"] == []


def forecast_response(start, hours=24):
    """Generate synthetic service data only for the local mock boundary."""
    return {
        "schema_version": 1,
        "private_field": "must not leave bridge",
        "window": {
            "status": "available",
            "fetched_at": dt_util.utcnow().isoformat(),
            "intervals": [
                {
                    "start": (start + timedelta(hours=index)).isoformat(),
                    "end": (start + timedelta(hours=index + 1)).isoformat(),
                    "energy_kwh": 0 if index < 6 else 1.5,
                    "private_field": "filtered",
                }
                for index in range(hours)
            ],
        },
    }


@pytest.mark.parametrize("hours", [23, 24, 25])
async def test_energy_forecast_uses_readonly_cache_context_and_sanitizes_response(
    hass,
    entry,
    sources,
    hass_ws_client,
    hass_read_only_access_token,
    hass_read_only_user,
    hours,
):
    start = dt_util.utcnow().replace(minute=0, second=0, microsecond=0)
    response = forecast_response(start, hours)
    calls = []

    async def serve(call):
        calls.append(call)
        return response

    hass.services.async_register(
        "pv_forecast", "get_forecast", serve, supports_response=SupportsResponse.ONLY
    )
    ws = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    payload = {
        "pv_forecast_entity_id": sources["pv_forecast"].entity_id,
        "start": start.isoformat(),
        "end": (start + timedelta(hours=hours)).isoformat(),
    }
    result = (await send(ws, 1, "get_energy_forecast", **payload))["result"]
    assert result["status"] == "available"
    assert result["reason"] is None
    assert len(result["intervals"]) == hours
    assert result["intervals"][0]["energy_kwh"] == 0
    assert set(result["intervals"][0]) == {"start", "end", "energy_kwh"}
    assert "private_field" not in str(result)
    assert dt_util.parse_datetime(result["expires_at"]) == dt_util.parse_datetime(
        result["fetched_at"]
    ) + timedelta(hours=1)
    assert len(calls) == 1
    assert calls[0].data == {
        "config_entry_id": sources["pv_forecast"].config_entry_id,
        "window": {
            "start": payload["start"],
            "end": payload["end"],
            "step_minutes": 60,
        },
    }
    assert calls[0].context.user_id == hass_read_only_user.id
    assert "energy_settings" not in get_project(hass).snapshot()


@pytest.mark.parametrize(
    "fault",
    ["old", "future", "gap", "nan", "bool", "negative", "unavailable", "schema"],
)
async def test_energy_forecast_never_turns_gaps_or_stale_data_into_zero(
    hass, entry, sources, hass_ws_client, fault
):
    start = dt_util.utcnow().replace(minute=0, second=0, microsecond=0)
    response = forecast_response(start, 1)
    if fault in {"old", "future"}:
        delta = timedelta(hours=-2 if fault == "old" else 1)
        response["window"]["fetched_at"] = (dt_util.utcnow() + delta).isoformat()
    elif fault == "gap":
        response["window"]["intervals"] = []
    elif fault in {"nan", "bool", "negative"}:
        response["window"]["intervals"][0]["energy_kwh"] = {
            "nan": float("nan"),
            "bool": True,
            "negative": -1,
        }[fault]
    elif fault == "unavailable":
        response["window"].update(status="unavailable", reason="outside_forecast")
    else:
        response["schema_version"] = 99
    before = deepcopy(response)

    async def serve(call):
        return response

    hass.services.async_register(
        "pv_forecast", "get_forecast", serve, supports_response=SupportsResponse.ONLY
    )
    ws = await hass_ws_client(hass)
    result = await send(
        ws,
        1,
        "get_energy_forecast",
        pv_forecast_entity_id=sources["pv_forecast"].entity_id,
        start=start.isoformat(),
        end=(start + timedelta(hours=1)).isoformat(),
    )
    assert result["result"]["status"] == "unavailable"
    assert result["result"]["intervals"] == []
    assert result["result"]["fetched_at"] is None
    assert str(response) == str(before)


async def test_energy_forecast_rejects_bad_windows_and_missing_service(
    hass, entry, sources, hass_ws_client
):
    ws = await hass_ws_client(hass)
    start = dt_util.utcnow().replace(minute=0, second=0, microsecond=0)
    for identifier, duration in enumerate([-1, 0, 0.5, 27], 1):
        result = await send(
            ws,
            identifier,
            "get_energy_forecast",
            pv_forecast_entity_id=sources["pv_forecast"].entity_id,
            start=start.isoformat(),
            end=(start + timedelta(hours=duration)).isoformat(),
        )
        assert result["error"]["code"] == "invalid_project"
    missing = await send(
        ws,
        5,
        "get_energy_forecast",
        pv_forecast_entity_id=sources["pv_forecast"].entity_id,
        start=start.isoformat(),
        end=(start + timedelta(hours=1)).isoformat(),
    )
    assert missing["error"]["code"] == "source_unavailable"
    invalid = await send(
        ws,
        6,
        "get_energy_forecast",
        pv_forecast_entity_id="sensor.other",
        start=start.isoformat(),
        end=(start + timedelta(hours=1)).isoformat(),
    )
    assert invalid["error"]["code"] == "invalid_project"
    naive = await send(
        ws,
        7,
        "get_energy_forecast",
        pv_forecast_entity_id=sources["pv_forecast"].entity_id,
        start="2026-01-01T00:00:00",
        end="2026-01-01T01:00:00",
    )
    assert naive["error"]["code"] == "invalid_project"
    malformed = await send(
        ws,
        8,
        "get_energy_forecast",
        pv_forecast_entity_id=sources["pv_forecast"].entity_id,
        start="2026-99-01T00:00:00+00:00",
        end="2026-99-01T01:00:00+00:00",
    )
    assert malformed["error"]["code"] == "invalid_project"


async def test_energy_forecast_checks_entity_permission_before_reading_service(
    hass,
    entry,
    sources,
    hass_ws_client,
    hass_read_only_access_token,
    hass_read_only_user,
):
    calls = []

    async def serve(call):
        calls.append(call)
        return {}

    hass.services.async_register(
        "pv_forecast", "get_forecast", serve, supports_response=SupportsResponse.ONLY
    )
    hass_read_only_user.mock_policy({"entities": {"all": {"read": False}}})
    ws = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = await send(
        ws,
        1,
        "get_energy_forecast",
        pv_forecast_entity_id=sources["pv_forecast"].entity_id,
        start="2026-01-01T00:00:00Z",
        end="2026-01-02T00:00:00Z",
    )
    assert result["error"]["code"] == "unauthorized"
    assert calls == []


async def test_energy_forecast_service_permission_failure_is_safely_reported(
    hass, entry, sources, hass_ws_client
):
    async def serve(call):
        raise Unauthorized(context=call.context, entity_id="sensor.private_upstream")

    hass.services.async_register(
        "pv_forecast", "get_forecast", serve, supports_response=SupportsResponse.ONLY
    )
    ws = await hass_ws_client(hass)
    result = await send(
        ws,
        1,
        "get_energy_forecast",
        pv_forecast_entity_id=sources["pv_forecast"].entity_id,
        start="2026-01-01T00:00:00Z",
        end="2026-01-02T00:00:00Z",
    )
    assert result["error"]["code"] == "source_unavailable"
    assert result["error"]["message"] == "PV-Prognose nicht verfügbar."
    assert "private_upstream" not in str(result)
