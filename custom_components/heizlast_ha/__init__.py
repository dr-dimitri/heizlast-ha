"""Heizlast HA: the fixed residential floor plan and temperature dashboard."""

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .api import async_register_api
from .const import DOMAIN
from .frontend import async_register_card, unregister_card
from .planning import ProjectError
from .project import Project
from .repairs import async_check_dashboard_update, async_clear_dashboard_issues

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PLATFORMS = [Platform.SENSOR]
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
    dashboard = await async_register_card(hass)
    hass.data[DOMAIN]["card_url"] = dashboard.url
    hass.data[DOMAIN]["dashboard"] = dashboard
    entry.runtime_data = project
    hass.data[DOMAIN]["project"] = project
    async_check_dashboard_update(hass, entry, dashboard)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: HeizlastConfigEntry) -> bool:
    """Finish pending mutations before removing this entry from the APIs."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    await entry.runtime_data.async_shutdown()
    unregister_card(hass)
    hass.data[DOMAIN].pop("dashboard", None)
    async_clear_dashboard_issues(hass)
    hass.data[DOMAIN].pop("project", None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: HeizlastConfigEntry) -> None:
    """Remove pending notices even when deleting an unloaded entry."""
    async_clear_dashboard_issues(hass)
