"""Constants for the Heizlast HA integration."""

DOMAIN = "heizlast_ha"
CONF_DASHBOARD_FINGERPRINT = "dashboard_fingerprint"
CONF_DASHBOARD_INITIAL_INSTALL = "dashboard_initial_install"
STORAGE_KEY = f"{DOMAIN}.project"
STORAGE_VERSION = 1
IMAGE_PATH = f"/api/{DOMAIN}/images/"
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 24_000_000
