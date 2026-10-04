"""Serve and load the dashboard module shipped inside the HACS integration."""

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url, remove_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.loader import async_get_integration

from .const import DOMAIN

CARD_PATH = f"/{DOMAIN}/heizlast-ha-card.js"
CARD_FILE = Path(__file__).parent / "www" / "heizlast-ha-card.js"


async def async_register_card(hass: HomeAssistant) -> str:
    """Register the asset once and load the versioned module in both UI modes."""
    if not await hass.async_add_executor_job(CARD_FILE.is_file):
        raise ConfigEntryNotReady(
            "Die Dashboard-Karte fehlt. Heizlast HA über HACS erneut herunterladen "
            "oder für eine lokale Entwicklung zuerst das Frontend bauen."
        )
    if not hass.data[DOMAIN].get("card_path_registered"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_PATH, str(CARD_FILE), False)]
        )
        hass.data[DOMAIN]["card_path_registered"] = True
    integration = await async_get_integration(hass, DOMAIN)
    url = f"{CARD_PATH}?v={integration.version}"
    add_extra_js_url(hass, url)
    return url


def unregister_card(hass: HomeAssistant) -> None:
    """Stop automatically loading the module when the config entry is unloaded."""
    if url := hass.data[DOMAIN].pop("card_url", None):
        remove_extra_js_url(hass, url)
