import {
  heatLossW, solarGainsFromFacadesW,
  type FacadeOrientation, type HeatLossZone, type SolarFactors, type SolarZone,
} from "./thermal-model";

export interface SimulationScenario {
  supplyTemperatureC: number;
  indoorTemperatureC: number;
  outdoorTemperatureC: number;
  weather: "sunny" | "cloudy";
  month: number;
}

export interface SimulationSite {
  latitudeDeg: number;
}

export interface SimulationParameters {
  returnDropK: number;
  activeFloorFraction: number;
  referenceHeatFluxWPerM2: number;
  referenceIndoorTemperatureC: number;
  emissionExponent: number;
  maxFloorSurfaceTemperatureC: number;
  sunnyDirectNormalWPerM2: number;
  sunnyDiffuseWPerM2: number;
  cloudyDiffuseWPerM2: number;
  groundReflectance: number;
}

export interface SimulationZone extends HeatLossZone, SolarZone {
  id: number;
  name: string;
  floor: "EG" | "OG";
  area: number;
}

/** Accept the original planning objects structurally, without loading a data file. */
export interface SimulationPlanningData {
  zones: ReadonlyArray<SimulationZone>;
  building: { design_outdoor_temperature_c: number };
  solar_assumptions: SolarFactors;
  underfloor_heating: {
    design_supply_temperature_c: number;
    design_return_temperature_c: number;
  };
}

export interface ZoneSimulationResult {
  id: number;
  heatLossW: number;
  solarGainsW: number;
  heatDemandW: number;
  heatingPowerW: number;
  balanceW: number;
  activeFloorAreaM2: number;
  floorSurfaceTemperatureC: number;
  returnTemperatureC: number;
  heatFluxWPerM2: number;
  solarSurplusW: number;
  peakHeatDemandW: number;
  peakDeficitW: number;
  peakSolarGainsW: number;
}

export interface SimulationTotals {
  heatLossW: number;
  solarGainsW: number;
  heatDemandW: number;
  heatingPowerW: number;
  balanceW: number;
  solarSurplusW: number;
  peakHeatDemandW: number;
  peakDeficitW: number;
  peakSolarGainsW: number;
}

export interface SimulationSolarProfile {
  representativeDay: 15;
  daylightHours: number;
  steps: 96;
}

export interface SimulationResult {
  valid: boolean;
  errors: string[];
  zones: ZoneSimulationResult[];
  totals: SimulationTotals | null;
  facadeIrradiance: Record<FacadeOrientation, number> | null;
  solarProfile: SimulationSolarProfile | null;
}

type ScenarioNumberField = Exclude<keyof SimulationScenario, "weather">;
type SimulationNumberField = ScenarioNumberField | keyof SimulationParameters | keyof SimulationSite;

export const SIMULATION_RANGES = {
  supplyTemperatureC: [0, 60], indoorTemperatureC: [5, 30], outdoorTemperatureC: [-40, 45],
  month: [1, 12], latitudeDeg: [-90, 90],
  returnDropK: [0, 20], activeFloorFraction: [0, 1], referenceHeatFluxWPerM2: [1, 200],
  referenceIndoorTemperatureC: [5, 30], emissionExponent: [0.5, 2],
  maxFloorSurfaceTemperatureC: [15, 35], sunnyDirectNormalWPerM2: [0, 1400],
  sunnyDiffuseWPerM2: [0, 1000], cloudyDiffuseWPerM2: [0, 1000],
  groundReflectance: [0, 1],
} as const satisfies Record<SimulationNumberField, readonly [number, number]>;

const SCENARIO_NUMBER_FIELDS: ScenarioNumberField[] = [
  "supplyTemperatureC", "indoorTemperatureC", "outdoorTemperatureC", "month",
];
const PARAMETER_FIELDS: Array<keyof SimulationParameters> = [
  "returnDropK", "activeFloorFraction", "referenceHeatFluxWPerM2",
  "referenceIndoorTemperatureC", "emissionExponent", "maxFloorSurfaceTemperatureC",
  "sunnyDirectNormalWPerM2", "sunnyDiffuseWPerM2", "cloudyDiffuseWPerM2",
  "groundReflectance",
];
const SOLAR_FACTOR_FIELDS: Array<keyof SolarFactors> = [
  "glazing_fraction", "g_value", "shading_factor", "sun_protection_factor", "incidence_factor",
];
const FACADES: ReadonlyArray<readonly [FacadeOrientation, number]> = [["N", 0], ["E", 90], ["S", 180], ["W", 270]];
const SURFACE_COEFFICIENT = 8.92;
const SURFACE_EXPONENT = 1.1;
const SOLAR_STEPS = 96;
const REPRESENTATIVE_DAY = 15;
const MONTH_DAY_OFFSETS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;
const REFERENCE_SINE_ELEVATION = Math.SQRT1_2;

/** Only the initial supply temperature comes from documented planning data. */
export function defaultSimulationScenario(data: SimulationPlanningData): SimulationScenario {
  return {
    supplyTemperatureC: data.underfloor_heating.design_supply_temperature_c,
    indoorTemperatureC: 22, outdoorTemperatureC: 5, weather: "sunny", month: 1,
  };
}

/** All values except the documented design return drop are adjustable assumptions. */
export function defaultSimulationParameters(data: SimulationPlanningData): SimulationParameters {
  return {
    returnDropK: data.underfloor_heating.design_supply_temperature_c - data.underfloor_heating.design_return_temperature_c,
    activeFloorFraction: 0.8, referenceHeatFluxWPerM2: 50, referenceIndoorTemperatureC: 20,
    emissionExponent: 1.1, maxFloorSurfaceTemperatureC: 29, sunnyDirectNormalWPerM2: 700,
    sunnyDiffuseWPerM2: 100, cloudyDiffuseWPerM2: 150,
    groundReflectance: 0.2,
  };
}

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const invalidResult = (errors: Iterable<string>): SimulationResult => ({
  valid: false, errors: [...new Set(errors)], zones: [], totals: null, facadeIrradiance: null, solarProfile: null,
});

/** Validate both user assumptions and the supplied source data without changing either. */
function validationErrors(
  data: SimulationPlanningData, scenario: SimulationScenario, parameters: SimulationParameters, site: SimulationSite,
): Set<string> {
  const errors = new Set<string>();
  for (const field of SCENARIO_NUMBER_FIELDS) {
    const value = scenario?.[field], [min, max] = SIMULATION_RANGES[field];
    if (!finiteNumber(value) || value < min || value > max) errors.add(field);
  }
  if (scenario?.weather !== "sunny" && scenario?.weather !== "cloudy") errors.add("weather");
  if (!Number.isInteger(scenario?.month)) errors.add("month");
  const latitude = site?.latitudeDeg, [minLatitude, maxLatitude] = SIMULATION_RANGES.latitudeDeg;
  if (!finiteNumber(latitude) || latitude < minLatitude || latitude > maxLatitude) errors.add("latitudeDeg");
  for (const field of PARAMETER_FIELDS) {
    const value = parameters?.[field], [min, max] = SIMULATION_RANGES[field];
    if (!finiteNumber(value) || value < min || value > max) errors.add(field);
  }
  const outdoor = data?.building?.design_outdoor_temperature_c;
  if (!finiteNumber(outdoor) || outdoor < -273.15) errors.add("data.building.design_outdoor_temperature_c");
  const supply = data?.underfloor_heating?.design_supply_temperature_c;
  const returned = data?.underfloor_heating?.design_return_temperature_c;
  if (!finiteNumber(supply) || supply < -273.15) errors.add("data.underfloor_heating.design_supply_temperature_c");
  if (!finiteNumber(returned) || returned < -273.15 || (finiteNumber(supply) && returned > supply)) errors.add("data.underfloor_heating.design_return_temperature_c");
  if (finiteNumber(supply) && finiteNumber(returned) && finiteNumber(parameters?.referenceIndoorTemperatureC)) {
    const referenceDelta = logarithmicMean(
      supply - parameters.referenceIndoorTemperatureC,
      supply - parameters.returnDropK - parameters.referenceIndoorTemperatureC,
    );
    if (!Number.isFinite(referenceDelta) || referenceDelta <= 0) {
      errors.add("returnDropK");
      errors.add("referenceIndoorTemperatureC");
    } else {
      const referenceLimit = SURFACE_COEFFICIENT * Math.pow(referenceDelta, SURFACE_EXPONENT);
      if (!Number.isFinite(referenceLimit)) errors.add("data.underfloor_heating.design_supply_temperature_c");
      else if (finiteNumber(parameters?.referenceHeatFluxWPerM2)) {
        const tolerance = Math.max(1, referenceLimit, parameters.referenceHeatFluxWPerM2) * 1e-10;
        if (parameters.referenceHeatFluxWPerM2 > referenceLimit + tolerance) errors.add("referenceHeatFluxWPerM2");
      }
    }
  }
  for (const field of SOLAR_FACTOR_FIELDS) {
    const value = data?.solar_assumptions?.[field];
    if (!finiteNumber(value) || value < 0 || value > 1) errors.add(`data.solar_assumptions.${field}`);
  }
  if (!Array.isArray(data?.zones) || data.zones.length === 0) {
    errors.add("data.zones");
    return errors;
  }
  const ids = new Set<number>();
  data.zones.forEach((zone: SimulationZone, index: number) => {
    const prefix = `data.zones[${index}]`;
    if (!zone || !Number.isSafeInteger(zone.id) || zone.id < 1 || ids.has(zone.id)) errors.add(`${prefix}.id`);
    if (zone) ids.add(zone.id);
    if (typeof zone?.name !== "string" || !zone.name.trim()) errors.add(`${prefix}.name`);
    if (zone?.floor !== "EG" && zone?.floor !== "OG") errors.add(`${prefix}.floor`);
    if (!finiteNumber(zone?.area) || zone.area < 0) errors.add(`${prefix}.area`);
    if (!finiteNumber(zone?.load) || zone.load < 0) errors.add(`${prefix}.load`);
    if (!finiteNumber(zone?.temperature) || zone.temperature < -273.15 ||
        (finiteNumber(outdoor) && zone.temperature <= outdoor)) errors.add(`${prefix}.temperature`);
    if (!Array.isArray(zone?.solar_windows)) {
      errors.add(`${prefix}.solar_windows`);
      return;
    }
    zone.solar_windows.forEach((window: SolarZone["solar_windows"][number], windowIndex: number) => {
      if (!window || !FACADES.some(([orientation]) => window.orientation === orientation) ||
          !finiteNumber(window.area_m2) || window.area_m2 < 0) errors.add(`${prefix}.solar_windows[${windowIndex}]`);
    });
  });
  return errors;
}

const zeroFacades = (): Record<FacadeOrientation, number> => ({ N: 0, E: 0, S: 0, W: 0 });

/** NOAA declination approximation on the month's 15th, using a non-leap year. */
function monthDeclination(month: number): number {
  const day = MONTH_DAY_OFFSETS[month - 1] + REPRESENTATIVE_DAY;
  const gamma = 2 * Math.PI / 365 * (day - 1);
  return 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
}

/** A full solar-time day: longitude and clock offsets do not affect daily means. */
function monthlySolarSteps(
  scenario: SimulationScenario, parameters: SimulationParameters, site: SimulationSite,
): { facades: Record<FacadeOrientation, number>[]; daylightHours: number } {
  const declination = monthDeclination(scenario.month), latitude = site.latitudeDeg * Math.PI / 180;
  const sinLatitude = Math.sin(latitude), cosLatitude = Math.cos(latitude);
  const sinDeclination = Math.sin(declination), cosDeclination = Math.cos(declination);
  const facades: Record<FacadeOrientation, number>[] = [];
  let daylightHours = 0;
  for (let step = 0; step < SOLAR_STEPS; step++) {
    const hourAngle = 2 * Math.PI * ((step + 0.5) / SOLAR_STEPS - 0.5);
    const sinElevation = Math.min(1, sinLatitude * sinDeclination + cosLatitude * cosDeclination * Math.cos(hourAngle));
    if (sinElevation <= 0) {
      facades.push(zeroFacades());
      continue;
    }
    daylightHours += 24 / SOLAR_STEPS;
    // Relative Haurwitz GHI shape; the DNI/DHI split remains an adjustable assumption.
    const attenuation = Math.exp(-0.059 * (1 / sinElevation - 1 / REFERENCE_SINE_ELEVATION));
    const dni = scenario.weather === "sunny" ? parameters.sunnyDirectNormalWPerM2 * attenuation : 0;
    const referenceDhi = scenario.weather === "sunny" ? parameters.sunnyDiffuseWPerM2 : parameters.cloudyDiffuseWPerM2;
    const dhi = referenceDhi * sinElevation / REFERENCE_SINE_ELEVATION * attenuation;
    const ghi = dni * sinElevation + dhi;
    const diffuse = 0.5 * dhi + 0.5 * parameters.groundReflectance * ghi;
    const north = cosLatitude * sinDeclination - sinLatitude * cosDeclination * Math.cos(hourAngle);
    const east = -cosDeclination * Math.sin(hourAngle);
    facades.push({ N: diffuse + dni * Math.max(0, north), E: diffuse + dni * Math.max(0, east),
      S: diffuse + dni * Math.max(0, -north), W: diffuse + dni * Math.max(0, -east) });
  }
  return { facades, daylightHours };
}

/** Mean heating-medium overtemperature, including the no-drop limit. */
function logarithmicMean(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  if (a === b) return a;
  const difference = a - b, ratio = difference / b;
  const logarithm = Number.isFinite(ratio) ? Math.log1p(ratio) : Math.log(a) - Math.log(b);
  return difference / logarithm;
}

/** Couple emission and return cooling through an assumed constant specific flow. */
function floorHeatFlux(
  data: SimulationPlanningData, scenario: SimulationScenario, parameters: SimulationParameters,
): number {
  const a = scenario.supplyTemperatureC - scenario.indoorTemperatureC;
  if (a <= 0) return 0;
  const referenceSupply = data.underfloor_heating.design_supply_temperature_c;
  const referenceDelta = logarithmicMean(referenceSupply - parameters.referenceIndoorTemperatureC,
    referenceSupply - parameters.returnDropK - parameters.referenceIndoorTemperatureC);
  const surfaceCap = SURFACE_COEFFICIENT * Math.pow(Math.max(0, parameters.maxFloorSurfaceTemperatureC - scenario.indoorTemperatureC), SURFACE_EXPONENT);
  const curve = (flux: number): number => {
    const b = a - parameters.returnDropK * flux / parameters.referenceHeatFluxWPerM2;
    const waterDelta = logarithmicMean(a, b);
    const calibratedFlux = parameters.referenceHeatFluxWPerM2 * Math.pow(waterDelta / referenceDelta, parameters.emissionExponent);
    const waterLimit = SURFACE_COEFFICIENT * Math.pow(waterDelta, SURFACE_EXPONENT);
    if (!Number.isFinite(calibratedFlux) || !Number.isFinite(waterLimit)) return NaN;
    return Math.min(calibratedFlux, waterLimit);
  };
  if (parameters.returnDropK === 0) {
    const raw = curve(0);
    return Number.isFinite(raw) ? Math.min(raw, surfaceCap) : NaN;
  }
  let low = 0, high = Math.min(surfaceCap, parameters.referenceHeatFluxWPerM2 * a / parameters.returnDropK);
  const curveAtCap = curve(high);
  if (!Number.isFinite(curveAtCap)) return NaN;
  if (curveAtCap >= high) return high;
  for (let iteration = 0; iteration < 80; iteration++) {
    const midpoint = (low + high) / 2, emission = curve(midpoint);
    if (!Number.isFinite(emission)) return NaN;
    if (emission > midpoint) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

/** Daily means with unbuffered solar gains; floor emission remains a steady-state estimate. */
export function simulateBuilding(
  data: SimulationPlanningData, scenario: SimulationScenario, parameters: SimulationParameters, site: SimulationSite,
): SimulationResult {
  const errors = validationErrors(data, scenario, parameters, site);
  if (errors.size > 0) return invalidResult(errors);
  const profile = monthlySolarSteps(scenario, parameters, site), facadeIrradiance = zeroFacades();
  for (const sample of profile.facades) {
    for (const [orientation] of FACADES) facadeIrradiance[orientation] += sample[orientation] / SOLAR_STEPS;
  }
  const flux = floorHeatFlux(data, scenario, parameters);
  const returnTemperatureC = scenario.supplyTemperatureC - parameters.returnDropK * flux / parameters.referenceHeatFluxWPerM2;
  const floorSurfaceTemperatureC = scenario.indoorTemperatureC + Math.pow(flux / SURFACE_COEFFICIENT, 1 / SURFACE_EXPONENT);
  if (![...Object.values(facadeIrradiance), flux, returnTemperatureC, floorSurfaceTemperatureC].every(Number.isFinite)) return invalidResult(["calculation"]);
  const zones: ZoneSimulationResult[] = [];
  const totals: SimulationTotals = { heatLossW: 0, solarGainsW: 0, heatDemandW: 0, heatingPowerW: 0, balanceW: 0,
    solarSurplusW: 0, peakHeatDemandW: 0, peakDeficitW: 0, peakSolarGainsW: 0 };
  data.zones.forEach((zone, index) => {
    const loss = heatLossW(zone, scenario.indoorTemperatureC, scenario.outdoorTemperatureC, data.building.design_outdoor_temperature_c);
    const activeFloorAreaM2 = zone.area * parameters.activeFloorFraction;
    const heatingPowerW = activeFloorAreaM2 * flux;
    if (loss === null || !Number.isFinite(activeFloorAreaM2) || !Number.isFinite(heatingPowerW)) {
      errors.add(`data.zones[${index}]`);
      return;
    }
    const result: ZoneSimulationResult = { id: zone.id, heatLossW: loss, solarGainsW: 0,
      heatDemandW: 0, heatingPowerW, balanceW: 0, activeFloorAreaM2, floorSurfaceTemperatureC,
      returnTemperatureC, heatFluxWPerM2: flux, solarSurplusW: 0,
      peakHeatDemandW: 0, peakDeficitW: 0, peakSolarGainsW: 0 };
    zones.push(result);
    totals.heatLossW += loss;
    totals.heatingPowerW += heatingPowerW;
  });
  if (errors.size > 0) return invalidResult(errors);
  for (const sample of profile.facades) {
    let totalDemand = 0, totalSolar = 0;
    data.zones.forEach((zone, index) => {
      const result = zones[index], solar = solarGainsFromFacadesW(zone, sample, data.solar_assumptions);
      if (solar === null) {
        errors.add(`data.zones[${index}].solar_windows`);
        return;
      }
      const demand = Math.max(0, result.heatLossW - solar), surplus = Math.max(0, solar - result.heatLossW);
      result.solarGainsW += solar / SOLAR_STEPS;
      result.heatDemandW += demand / SOLAR_STEPS;
      result.solarSurplusW += surplus / SOLAR_STEPS;
      result.peakHeatDemandW = Math.max(result.peakHeatDemandW, demand);
      result.peakSolarGainsW = Math.max(result.peakSolarGainsW, solar);
      totalDemand += demand;
      totalSolar += solar;
    });
    if (!Number.isFinite(totalDemand) || !Number.isFinite(totalSolar)) errors.add("calculation");
    totals.peakHeatDemandW = Math.max(totals.peakHeatDemandW, totalDemand);
    totals.peakSolarGainsW = Math.max(totals.peakSolarGainsW, totalSolar);
  }
  for (const result of zones) {
    result.balanceW = result.heatingPowerW - result.heatDemandW;
    result.peakDeficitW = Math.max(0, result.peakHeatDemandW - result.heatingPowerW);
    totals.solarGainsW += result.solarGainsW;
    totals.heatDemandW += result.heatDemandW;
    totals.solarSurplusW += result.solarSurplusW;
    if (!Object.values(result).every(Number.isFinite)) errors.add("calculation");
  }
  totals.balanceW = totals.heatingPowerW - totals.heatDemandW;
  totals.peakDeficitW = Math.max(0, totals.peakHeatDemandW - totals.heatingPowerW);
  if (!Object.values(totals).every(Number.isFinite)) errors.add("calculation");
  if (errors.size > 0) return invalidResult(errors);
  return { valid: true, errors: [], zones, totals, facadeIrradiance,
    solarProfile: { representativeDay: REPRESENTATIVE_DAY, daylightHours: profile.daylightHours, steps: SOLAR_STEPS } };
}
