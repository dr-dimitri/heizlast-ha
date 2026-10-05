import type { HeatZone, SolarAssumptions } from "./planning-types";
import { heatLossW, solarGainsFromFacadesW } from "./thermal-model";
import { irradianceWPerM2, temperatureCelsius, type HassState } from "./types";

/** Approximate the current losses with the documented design temperature difference. */
export function estimatedHeatLoadW(
  zone: Pick<HeatZone, "load" | "temperature">,
  room?: HassState,
  outside?: HassState,
  designOutdoorC?: number,
): number | null {
  return heatLossW(zone, temperatureCelsius(room), temperatureCelsius(outside), designOutdoorC);
}

/** Use whole-window areas with the documented frame, glazing and shading factors. */
export function solarGainsW(
  zone: Pick<HeatZone, "solar_windows">,
  state?: HassState,
  assumptions?: SolarAssumptions,
): number | null {
  const facades = state && irradianceWPerM2(state) !== null ? {
    N: state.attributes.facade_north_w_m2, E: state.attributes.facade_east_w_m2,
    S: state.attributes.facade_south_w_m2, W: state.attributes.facade_west_w_m2,
  } : undefined;
  return solarGainsFromFacadesW(zone, facades, assumptions);
}
