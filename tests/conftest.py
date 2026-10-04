"""Provide a packaged dashboard asset for Home Assistant test instances."""

import pytest


@pytest.fixture
def bundled_card(tmp_path, monkeypatch):
    """Source checkout tests use a minimal module; release tests check real assets."""
    from custom_components.heizlast_ha import frontend

    asset = tmp_path / "card.js"
    asset.write_text("export const packagedCard = true;\n")
    monkeypatch.setattr(frontend, "CARD_FILE", asset)
    return asset
