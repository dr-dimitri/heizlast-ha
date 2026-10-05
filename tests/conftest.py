"""Provide a packaged dashboard asset for Home Assistant test instances."""

import pytest


@pytest.fixture(autouse=True)
def mock_outdoor_temperature_http(aioclient_mock):
    """Keep all integration tests offline with an explicitly synthetic sample."""
    aioclient_mock.get(
        "https://api.open-meteo.com/v1/forecast",
        json={
            "current": {"temperature_2m": 0.0},
            "current_units": {"temperature_2m": "°C"},
        },
    )
    return aioclient_mock


@pytest.fixture
def bundled_card(tmp_path, monkeypatch):
    """Source checkout tests use a minimal module; release tests check real assets."""
    from custom_components.heizlast_ha import frontend

    asset = tmp_path / "card.js"
    asset.write_text("export const packagedCard = true;\n")
    monkeypatch.setattr(frontend, "CARD_FILE", asset)
    return asset
