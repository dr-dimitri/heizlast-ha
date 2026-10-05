/** Structural planning inputs shared by live readings and simulation. */
export interface HeatLossZone {
  load: number;
  temperature: number;
}

export type FacadeOrientation = "N" | "E" | "S" | "W";
export type FacadeIrradiance = Readonly<Partial<Record<FacadeOrientation, number>>>;

export interface SolarZone {
  solar_windows: ReadonlyArray<{ orientation: FacadeOrientation; area_m2: number }>;
}

export interface SolarFactors {
  glazing_fraction: number;
  g_value: number;
  shading_factor: number;
  sun_protection_factor: number;
  incidence_factor: number;
}

/** Scale documented design losses by the current indoor/outdoor difference. */
export function heatLossW(
  zone: HeatLossZone,
  insideC: number | null | undefined,
  outsideC: number | null | undefined,
  designOutdoorC?: number,
): number | null {
  if (typeof insideC !== "number" || typeof outsideC !== "number" ||
      typeof designOutdoorC !== "number" || !Number.isFinite(insideC) ||
      !Number.isFinite(outsideC) || insideC < -273.15 || outsideC < -273.15 ||
      !Number.isFinite(designOutdoorC) || !Number.isFinite(zone.temperature) ||
      !Number.isFinite(zone.load) || zone.load < 0) return null;
  const designDelta = zone.temperature - designOutdoorC;
  if (!Number.isFinite(designDelta) || designDelta <= 0) return null;
  const load = zone.load * (Math.max(0, insideC - outsideC) / designDelta);
  return Number.isFinite(load) ? load : null;
}

/** Apply window areas and the documented frame, glazing and shading factors. */
export function solarGainsFromFacadesW(
  zone: SolarZone,
  facades?: FacadeIrradiance,
  assumptions?: SolarFactors,
): number | null {
  if (!assumptions) return null;
  const factors = [assumptions.glazing_fraction, assumptions.g_value, assumptions.shading_factor,
    assumptions.sun_protection_factor, assumptions.incidence_factor];
  if (factors.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return null;
  if (zone.solar_windows.length === 0) return 0;
  if (!facades) return null;
  let gains = 0;
  for (const window of zone.solar_windows) {
    const irradiance = facades[window.orientation];
    if (typeof irradiance !== "number" || !Number.isFinite(irradiance) || irradiance < 0 ||
        !Number.isFinite(window.area_m2) || window.area_m2 < 0) return null;
    gains += window.area_m2 * irradiance;
  }
  const result = gains * factors.reduce((product, value) => product * value, 1);
  return Number.isFinite(result) ? result : null;
}
