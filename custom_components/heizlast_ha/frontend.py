"""Serve and load the dashboard module shipped inside the HACS integration."""

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

from homeassistant.components.frontend import (
    DATA_PANELS,
    add_extra_js_url,
    async_panel_exists,
    async_remove_panel,
    remove_extra_js_url,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.loader import async_get_integration

from .const import DOMAIN

CARD_PATH = f"/{DOMAIN}/heizlast-ha-card.js"
CARD_FILE = Path(__file__).parent / "www" / "heizlast-ha-card.js"
PANEL_PATH = "heizlast-ha"


@dataclass(frozen=True)
class DashboardModule:
    """Identify the actual shipped dashboard, independently of backend changes."""

    url: str
    version: str
    fingerprint: str


def _card_fingerprint() -> str:
    """Read and fingerprint the bundle outside Home Assistant's event loop."""
    return sha256(CARD_FILE.read_bytes()).hexdigest()


async def async_register_card(hass: HomeAssistant) -> DashboardModule:
    """Serve the card and expose its dashboard without manual Lovelace setup."""
    try:
        fingerprint = await hass.async_add_executor_job(_card_fingerprint)
    except OSError as err:
        raise ConfigEntryNotReady(
            "Die Dashboard-Karte fehlt. Heizlast HA über HACS erneut herunterladen "
            "oder für eine lokale Entwicklung zuerst das Frontend bauen."
        ) from err
    if not hass.data[DOMAIN].get("card_path_registered"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_PATH, str(CARD_FILE), False)]
        )
        hass.data[DOMAIN]["card_path_registered"] = True
    integration = await async_get_integration(hass, DOMAIN)
    assert integration.version is not None
    url = f"{CARD_PATH}?v={integration.version}"
    # A user may already have a dashboard at this URL. Preserve it and choose
    # the next free path rather than replacing their panel or configuration.
    panel_path = PANEL_PATH
    suffix = 2
    while async_panel_exists(hass, panel_path):
        panel_path = f"{PANEL_PATH}-{suffix}"
        suffix += 1
    await async_register_panel(
        hass,
        frontend_url_path=panel_path,
        webcomponent_name="heizlast-ha-panel",
        sidebar_title="Heizlast HA",
        sidebar_icon="mdi:floor-plan",
        module_url=url,
        config_panel_domain=DOMAIN,
    )
    hass.data[DOMAIN]["panel"] = hass.data[DATA_PANELS][panel_path]
    add_extra_js_url(hass, url)
    return DashboardModule(url, integration.version, fingerprint)


def unregister_card(hass: HomeAssistant) -> None:
    """Remove this entry's panel and module while keeping saved project data."""
    if panel := hass.data[DOMAIN].pop("panel", None):
        if hass.data[DATA_PANELS].get(panel.frontend_url_path) is panel:
            async_remove_panel(hass, panel.frontend_url_path)
    if url := hass.data[DOMAIN].pop("card_url", None):
        remove_extra_js_url(hass, url)
