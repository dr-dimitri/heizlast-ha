"""Heizlast HA: a persistent floor plan and temperature dashboard prototype."""

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .api import async_register_api
from .const import DOMAIN
from .frontend import async_register_card, unregister_card
from .project import Project
from .validation import ProjectError

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
type HeizlastConfigEntry = ConfigEntry[Project]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register shared authenticated endpoints once for the integration."""
    hass.data[DOMAIN] = {}
    async_register_api(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: HeizlastConfigEntry) -> bool:
    """Load persistent project data before allowing dashboard access."""
    if hass.data[DOMAIN].get("project") is not None:
        raise ConfigEntryNotReady("Heizlast HA supports only one project instance")
    project = Project(hass)
    try:
        await project.async_load()
    except (OSError, ProjectError) as err:
        raise ConfigEntryNotReady(str(err)) from err
    hass.data[DOMAIN]["card_url"] = await async_register_card(hass)
    entry.runtime_data = project
    hass.data[DOMAIN]["project"] = project
    return True


async def async_unload_entry(hass: HomeAssistant, entry: HeizlastConfigEntry) -> bool:
    """Finish pending mutations before removing this entry from the APIs."""
    await entry.runtime_data.async_shutdown()
    unregister_card(hass)
    hass.data[DOMAIN].pop("project", None)
    return True
