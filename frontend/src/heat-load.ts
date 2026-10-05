import type { HeatZone, SolarAssumptions } from "./planning-types";
import { irradianceWPerM2, temperatureCelsius, type HassState } from "./types";

/** Approximate the current losses with the documented design temperature difference. */
export function estimatedHeatLoadW(
  zone: Pick<HeatZone, "load" | "temperature">,
  room?: HassState,
  outside?: HassState,
  designOutdoorC?: number,
): number | null {
  const insideC = temperatureCelsius(room), outsideC = temperatureCelsius(outside);
  if (insideC === null || outsideC === null || typeof designOutdoorC !== "number" ||
      !Number.isFinite(designOutdoorC) || !Number.isFinite(zone.temperature) ||
      !Number.isFinite(zone.load) || zone.load < 0) return null;
  const designDelta = zone.temperature - designOutdoorC;
  if (!Number.isFinite(designDelta) || designDelta <= 0) return null;
  const load = zone.load * (Math.max(0, insideC - outsideC) / designDelta);
  return Number.isFinite(load) ? load : null;
}

/** Use whole-window areas with the documented frame, glazing and shading factors. */
export function solarGainsW(
  zone: Pick<HeatZone, "solar_windows">,
  state?: HassState,
  assumptions?: SolarAssumptions,
): number | null {
  if (!assumptions) return null;
  const factors = [assumptions.glazing_fraction, assumptions.g_value, assumptions.shading_factor,
    assumptions.sun_protection_factor, assumptions.incidence_factor];
  if (factors.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return null;
  if (zone.solar_windows.length === 0) return 0;
  if (irradianceWPerM2(state) === null) return null;
  const irradiances = {
    N: state!.attributes.facade_north_w_m2, E: state!.attributes.facade_east_w_m2,
    S: state!.attributes.facade_south_w_m2, W: state!.attributes.facade_west_w_m2,
  };
  let gains = 0;
  for (const window of zone.solar_windows) {
    const irradiance = irradiances[window.orientation];
    if (typeof irradiance !== "number" || !Number.isFinite(irradiance) || irradiance < 0 ||
        !Number.isFinite(window.area_m2) || window.area_m2 < 0) return null;
    gains += window.area_m2 * irradiance;
  }
  const result = gains * factors.reduce((product, value) => product * value, 1);
  return Number.isFinite(result) ? result : null;
}
