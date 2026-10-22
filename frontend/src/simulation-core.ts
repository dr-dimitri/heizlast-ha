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
  circuitFlowLPerMin: number;
  additionalConnectionLengthM: number;
  connectionHeatingWidthM: number;
}

/** Confirmed installation data; connection lengths and flows remain scenario assumptions. */
export interface HeatingInstallation {
  pipe_outer_diameter_mm: number;
  pipe_wall_thickness_mm: number;
  manifolds: ReadonlyArray<{ floor: "EG" | "OG"; zone_id: number; connection_zone_id: number }>;
  circuits: ReadonlyArray<{ zone_id: number; length_m: number }>;
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
    installation?: HeatingInstallation;
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
  roomPipeLengthM: number;
  connectionPipeLengthM: number;
  pipeWaterVolumeL: number;
}

export interface CircuitSimulationResult {
  zoneId: number;
  roomPipeLengthM: number;
  connectionPipeLengthM: number;
  totalPipeLengthM: number;
  waterVolumeL: number;
  flowLPerMin: number;
  returnTemperatureC: number;
  roomHeatingPowerW: number;
  connectionHeatingPowerW: number;
  heatingPowerW: number;
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
  circuits: CircuitSimulationResult[];
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
  circuitFlowLPerMin: [0, 5], additionalConnectionLengthM: [0, 30], connectionHeatingWidthM: [0, 0.5],
} as const satisfies Record<SimulationNumberField, readonly [number, number]>;

const SCENARIO_NUMBER_FIELDS: ScenarioNumberField[] = [
  "supplyTemperatureC", "indoorTemperatureC", "outdoorTemperatureC", "month",
];
const PARAMETER_FIELDS: Array<keyof SimulationParameters> = [
  "returnDropK", "activeFloorFraction", "referenceHeatFluxWPerM2",
  "referenceIndoorTemperatureC", "emissionExponent", "maxFloorSurfaceTemperatureC",
  "sunnyDirectNormalWPerM2", "sunnyDiffuseWPerM2", "cloudyDiffuseWPerM2",
  "groundReflectance",
  "circuitFlowLPerMin", "additionalConnectionLengthM", "connectionHeatingWidthM",
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

/** User-specified operating assumption, not a measured or documented building value. */
export const HEATING_CALIBRATION = { indoorTemperatureC: 22, outdoorTemperatureC: -9 } as const;

/** Only the initial supply temperature comes from documented planning data. */
export function defaultSimulationScenario(data: SimulationPlanningData): SimulationScenario {
  return {
    supplyTemperatureC: data.underfloor_heating.design_supply_temperature_c,
    indoorTemperatureC: 22, outdoorTemperatureC: 5, weather: "sunny", month: 1,
  };
}

/** Calibrate the shared initial emission to cover every zone without solar gains. */
export function defaultSimulationParameters(data: SimulationPlanningData): SimulationParameters {
  const activeFloorFraction = 0.8;
  const circuitParameters = { activeFloorFraction, circuitFlowLPerMin: 1.5,
    additionalConnectionLengthM: 6, connectionHeatingWidthM: 0.15 };
  const layout = data.underfloor_heating.installation ? circuitLayout(data, circuitParameters) : undefined;
  const requiredFluxes = data.zones.map((zone) => {
    const loss = heatLossW(zone, HEATING_CALIBRATION.indoorTemperatureC,
      HEATING_CALIBRATION.outdoorTemperatureC, data.building.design_outdoor_temperature_c);
    if (loss === null || !Number.isFinite(zone.area) || zone.area < 0) return NaN;
    if (zone.area === 0) return loss === 0 ? 0 : NaN;
    const activeArea = layout?.areas.get(zone.id) ?? zone.area * activeFloorFraction;
    return activeArea > 0 ? loss / activeArea : loss === 0 ? 0 : NaN;
  });
  // Round upward to the UI's whole-W/m² step; do not hide impossible calibrations.
  const referenceHeatFluxWPerM2 = Math.ceil(Math.max(1, ...requiredFluxes));
  return {
    returnDropK: data.underfloor_heating.design_supply_temperature_c - data.underfloor_heating.design_return_temperature_c,
    referenceHeatFluxWPerM2, referenceIndoorTemperatureC: HEATING_CALIBRATION.indoorTemperatureC,
    emissionExponent: 1.1, maxFloorSurfaceTemperatureC: 29, sunnyDirectNormalWPerM2: 700,
    sunnyDiffuseWPerM2: 100, cloudyDiffuseWPerM2: 150,
    groundReflectance: 0.2,
    ...circuitParameters,
  };
}

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const invalidResult = (errors: Iterable<string>): SimulationResult => ({
  valid: false, errors: [...new Set(errors)], zones: [], totals: null, facadeIrradiance: null, solarProfile: null, circuits: [],
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
  const installation = data.underfloor_heating?.installation;
  if (installation !== undefined) {
    const prefix = "data.underfloor_heating.installation";
    if (!installation || !finiteNumber(installation.pipe_outer_diameter_mm) ||
        !finiteNumber(installation.pipe_wall_thickness_mm) || installation.pipe_wall_thickness_mm <= 0 ||
        installation.pipe_outer_diameter_mm <= 2 * installation.pipe_wall_thickness_mm ||
        installation.pipe_outer_diameter_mm > 100) errors.add(`${prefix}.pipe`);
    const floors = new Set<string>();
    if (!Array.isArray(installation?.manifolds)) errors.add(`${prefix}.manifolds`);
    else for (const manifold of installation.manifolds) {
      if (!manifold || floors.has(manifold.floor) || !data.zones.some((zone) => zone?.id === manifold.zone_id && zone.floor === manifold.floor) ||
          !data.zones.some((zone) => zone?.id === manifold.connection_zone_id && zone.floor === manifold.floor)) errors.add(`${prefix}.manifolds`);
      if (manifold) floors.add(manifold.floor);
    }
    if (!Array.isArray(installation?.circuits) || installation.circuits.length === 0) errors.add(`${prefix}.circuits`);
    else for (const circuit of installation.circuits) {
      const zone = data.zones.find((zone) => zone?.id === circuit?.zone_id);
      if (!zone || !floors.has(zone.floor) || !finiteNumber(circuit?.length_m) || circuit.length_m <= 0 || circuit.length_m > 1000) errors.add(`${prefix}.circuits`);
    }
  }
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

interface PipeSegment { zoneId: number; lengthM: number; areaM2: number; connection: boolean }
interface CircuitLayout {
  areas: Map<number, number>;
  lengths: Map<number, { room: number; connection: number }>;
  circuits: { zoneId: number; segments: PipeSegment[] }[];
}

/** Route additional supply/return lengths through the floor's declared connection zone.
 * A circuit in the manifold room stays in that room. Routes are a scenario approximation.
 */
function circuitLayout(data: SimulationPlanningData, parameters: Pick<SimulationParameters,
  "activeFloorFraction" | "additionalConnectionLengthM" | "connectionHeatingWidthM">): CircuitLayout {
  const installation = data.underfloor_heating.installation!;
  const lengths = new Map(data.zones.map((zone) => [zone.id, { room: 0, connection: 0 }]));
  const circuits = installation.circuits.map((circuit) => {
    const room = data.zones.find((zone) => zone.id === circuit.zone_id)!;
    const manifold = installation.manifolds.find((candidate) => candidate.floor === room.floor)!;
    const connectionZoneId = circuit.zone_id === manifold.zone_id ? circuit.zone_id : manifold.connection_zone_id;
    const segments = [
      { zoneId: connectionZoneId, lengthM: parameters.additionalConnectionLengthM / 2, areaM2: 0, connection: true },
      { zoneId: circuit.zone_id, lengthM: circuit.length_m, areaM2: 0, connection: false },
      { zoneId: connectionZoneId, lengthM: parameters.additionalConnectionLengthM / 2, areaM2: 0, connection: true },
    ];
    for (const segment of segments) lengths.get(segment.zoneId)![segment.connection ? "connection" : "room"] += segment.lengthM;
    return { zoneId: circuit.zone_id, segments };
  });
  const areas = new Map(data.zones.map((zone) => {
    const pipe = lengths.get(zone.id)!;
    const available = zone.area * parameters.activeFloorFraction;
    // A lead-only corridor has heated strips, rather than an invented full-area circuit.
    return [zone.id, pipe.room > 0 ? available : Math.min(available, pipe.connection * parameters.connectionHeatingWidthM)];
  }));
  for (const circuit of circuits) for (const segment of circuit.segments) {
    const pipe = lengths.get(segment.zoneId)!, length = pipe.room + pipe.connection;
    segment.areaM2 = length > 0 ? areas.get(segment.zoneId)! * (segment.lengthM / length) : 0;
  }
  return { areas, lengths, circuits };
}

/** Water approximation: density 1 kg/l, heat capacity 1.163 Wh/(kg K). */
const WATER_CAPACITY_W_PER_L_MIN_K = 1.163 * 60;

function heatPipeSegment(
  inletC: number, areaM2: number, capacityWPerK: number, referenceDelta: number,
  scenario: SimulationScenario, parameters: SimulationParameters,
): { powerW: number; outletC: number; surfaceC: number } {
  const delta = inletC - scenario.indoorTemperatureC;
  if (areaM2 <= 0 || capacityWPerK <= 0 || delta <= 0) return { powerW: 0, outletC: inletC, surfaceC: scenario.indoorTemperatureC };
  const surfaceFlux = SURFACE_COEFFICIENT * Math.pow(Math.max(0, parameters.maxFloorSurfaceTemperatureC - scenario.indoorTemperatureC), SURFACE_EXPONENT);
  let low = 0, high = Math.min(areaM2 * surfaceFlux, capacityWPerK * delta);
  for (let iteration = 0; iteration < 80; iteration++) {
    const power = (low + high) / 2;
    const waterDelta = logarithmicMean(delta, delta - power / capacityWPerK);
    const flux = Math.min(parameters.referenceHeatFluxWPerM2 * Math.pow(waterDelta / referenceDelta, parameters.emissionExponent),
      SURFACE_COEFFICIENT * Math.pow(waterDelta, SURFACE_EXPONENT));
    if (power <= areaM2 * flux) low = power;
    else high = power;
  }
  const powerW = low;
  return { powerW, outletC: inletC - powerW / capacityWPerK,
    surfaceC: scenario.indoorTemperatureC + Math.pow(powerW / areaM2 / SURFACE_COEFFICIENT, 1 / SURFACE_EXPONENT) };
}

function circuitEmission(data: SimulationPlanningData, scenario: SimulationScenario, parameters: SimulationParameters,
  roomTemperatures?: Readonly<Record<number, number>>) {
  const installation = data.underfloor_heating.installation!, layout = circuitLayout(data, parameters);
  const innerDiameterM = (installation.pipe_outer_diameter_mm - 2 * installation.pipe_wall_thickness_mm) / 1000;
  const volumeLPerM = Math.PI * Math.pow(innerDiameterM / 2, 2) * 1000;
  const referenceSupply = data.underfloor_heating.design_supply_temperature_c;
  const referenceDelta = logarithmicMean(referenceSupply - parameters.referenceIndoorTemperatureC,
    referenceSupply - parameters.returnDropK - parameters.referenceIndoorTemperatureC);
  const capacity = parameters.circuitFlowLPerMin * WATER_CAPACITY_W_PER_L_MIN_K;
  const zones = new Map(data.zones.map((zone) => {
    const pipe = layout.lengths.get(zone.id)!;
    return [zone.id, { activeFloorAreaM2: layout.areas.get(zone.id)!, heatingPowerW: 0,
      floorSurfaceTemperatureC: roomTemperatures?.[zone.id] ?? scenario.indoorTemperatureC, heatFluxWPerM2: 0,
      returnTemperatureC: scenario.supplyTemperatureC, roomPipeLengthM: pipe.room,
      connectionPipeLengthM: pipe.connection, pipeWaterVolumeL: (pipe.room + pipe.connection) * volumeLPerM }];
  }));
  const returns = new Map<number, number[]>();
  const circuits: CircuitSimulationResult[] = layout.circuits.map((circuit) => {
    let inletC = scenario.supplyTemperatureC, roomHeatingPowerW = 0, connectionHeatingPowerW = 0;
    for (const segment of circuit.segments) {
      const segmentScenario = roomTemperatures ? { ...scenario, indoorTemperatureC: roomTemperatures[segment.zoneId] } : scenario;
      const emitted = heatPipeSegment(inletC, segment.areaM2, capacity, referenceDelta, segmentScenario, parameters);
      const zone = zones.get(segment.zoneId)!;
      zone.heatingPowerW += emitted.powerW;
      zone.floorSurfaceTemperatureC = Math.max(zone.floorSurfaceTemperatureC, emitted.surfaceC);
      if (segment.connection) connectionHeatingPowerW += emitted.powerW;
      else roomHeatingPowerW += emitted.powerW;
      inletC = emitted.outletC;
    }
    for (const id of new Set(circuit.segments.filter((segment) => segment.lengthM > 0).map((segment) => segment.zoneId))) {
      const temperatures = returns.get(id) ?? [];
      temperatures.push(inletC);
      returns.set(id, temperatures);
    }
    const roomPipeLengthM = circuit.segments[1].lengthM;
    const connectionPipeLengthM = parameters.additionalConnectionLengthM;
    const totalPipeLengthM = roomPipeLengthM + connectionPipeLengthM;
    return { zoneId: circuit.zoneId, roomPipeLengthM, connectionPipeLengthM, totalPipeLengthM,
      waterVolumeL: totalPipeLengthM * volumeLPerM, flowLPerMin: parameters.circuitFlowLPerMin,
      returnTemperatureC: inletC, roomHeatingPowerW, connectionHeatingPowerW,
      heatingPowerW: roomHeatingPowerW + connectionHeatingPowerW };
  });
  for (const [id, zone] of zones) {
    zone.heatFluxWPerM2 = zone.activeFloorAreaM2 > 0 ? zone.heatingPowerW / zone.activeFloorAreaM2 : 0;
    const temperatures = returns.get(id);
    if (temperatures?.length) zone.returnTemperatureC = temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;
  }
  return { zones, circuits };
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
  const emission = data.underfloor_heating.installation ? circuitEmission(data, scenario, parameters) : undefined;
  const zones: ZoneSimulationResult[] = [];
  const totals: SimulationTotals = { heatLossW: 0, solarGainsW: 0, heatDemandW: 0, heatingPowerW: 0, balanceW: 0,
    solarSurplusW: 0, peakHeatDemandW: 0, peakDeficitW: 0, peakSolarGainsW: 0 };
  data.zones.forEach((zone, index) => {
    const loss = heatLossW(zone, scenario.indoorTemperatureC, scenario.outdoorTemperatureC, data.building.design_outdoor_temperature_c);
    const circuitZone = emission?.zones.get(zone.id);
    const activeFloorAreaM2 = circuitZone?.activeFloorAreaM2 ?? zone.area * parameters.activeFloorFraction;
    const heatingPowerW = circuitZone?.heatingPowerW ?? activeFloorAreaM2 * flux;
    if (loss === null || !Number.isFinite(activeFloorAreaM2) || !Number.isFinite(heatingPowerW)) {
      errors.add(`data.zones[${index}]`);
      return;
    }
    const result: ZoneSimulationResult = { id: zone.id, heatLossW: loss, solarGainsW: 0,
      heatDemandW: 0, heatingPowerW, balanceW: 0, activeFloorAreaM2, floorSurfaceTemperatureC,
      returnTemperatureC, heatFluxWPerM2: flux, solarSurplusW: 0,
      peakHeatDemandW: 0, peakDeficitW: 0, peakSolarGainsW: 0,
      roomPipeLengthM: 0, connectionPipeLengthM: 0, pipeWaterVolumeL: 0, ...circuitZone };
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
  const circuits = emission?.circuits ?? [];
  if (circuits.some((circuit) => !Object.values(circuit).every(Number.isFinite))) return invalidResult(["calculation"]);
  return { valid: true, errors: [], zones, totals, facadeIrradiance, circuits,
    solarProfile: { representativeDay: REPRESENTATIVE_DAY, daylightHours: profile.daylightHours, steps: SOLAR_STEPS } };
}

/** Provider-derived weather for the interval starting at time (one elapsed hour). */
export interface HourlyWeather {
  time: string;
  outdoorTemperatureC?: number;
  globalIrradianceWPerM2?: number;
  facadeIrradiance?: Record<FacadeOrientation, number>;
}
export interface WeatherDay { date: string; hours: HourlyWeather[] }
export interface WeatherForecast { timezone: string; fetched_at: string | null; days: WeatherDay[] }
export interface HeatingHour {
  time: string;
  status: "covered" | "off" | "unreachable" | "missing_weather" | "missing_temperature" | "invalid_model";
  outdoorTemperatureC: number | null;
  globalIrradianceWPerM2: number | null;
  heatDemandW: number | null;
  requiredSupplyTemperatureC: number | null;
  zones: ZoneSimulationResult[];
  circuits: CircuitSimulationResult[];
}
export interface HeatingDay { hours: HeatingHour[]; heatEnergyKWh: number | null; missingZoneIds: number[] }

/** Assumed useful heat / gross gas energy for a modern condensing boiler. */
export const CONDENSING_BOILER_EFFICIENCY = 0.95;

/** Heating only; no hot water, standing charge or auxiliary electricity. */
export function estimateGasUse(heatEnergyKWh: number | null, priceCtPerKWh: number | null) {
  const gas = heatEnergyKWh !== null && Number.isFinite(heatEnergyKWh) && heatEnergyKWh >= 0
    ? heatEnergyKWh / CONDENSING_BOILER_EFFICIENCY : null;
  const gasEnergyKWh = gas !== null && Number.isFinite(gas) ? gas : null;
  const cost = gasEnergyKWh !== null && priceCtPerKWh !== null && Number.isFinite(priceCtPerKWh) && priceCtPerKWh >= 0
    ? gasEnergyKWh * (priceCtPerKWh / 100) : null;
  return { gasEnergyKWh, costEuro: cost !== null && Number.isFinite(cost) ? cost : null };
}

/** A search boundary, not a recommendation to operate the installation at 60 °C. */
export const MAX_REQUIRED_SUPPLY_C = 60;

/** Invert the existing circuit model with fixed shared defaults, never a second building dataset.
 * Each room keeps its live temperature for the day; this is not a temperature forecast.
 */
export function simulateHeatingDay(data: SimulationPlanningData, weather: ReadonlyArray<HourlyWeather>,
  temperatures: Readonly<Record<number, number | null | undefined>>): HeatingDay {
  const missingZoneIds = data.zones.filter((zone) => !finiteNumber(temperatures[zone.id]) || temperatures[zone.id]! < -273.15).map((zone) => zone.id);
  // Validate installation before deriving defaults, which inspect its topology.
  const probe = { ...defaultSimulationScenario(data), indoorTemperatureC: 22 };
  const parameters = defaultSimulationParameters({ ...data, underfloor_heating: { ...data.underfloor_heating, installation: undefined } });
  const invalid = validationErrors(data, probe, parameters, { latitudeDeg: 0 }).size > 0 || !data.underfloor_heating.installation;
  const fixed = invalid ? parameters : defaultSimulationParameters(data);
  const roomTemperatures = temperatures as Readonly<Record<number, number>>;
  const emptyHour = (sample: HourlyWeather, status: HeatingHour["status"]): HeatingHour => ({
    time: sample.time, status, outdoorTemperatureC: finiteNumber(sample.outdoorTemperatureC) ? sample.outdoorTemperatureC : null,
    globalIrradianceWPerM2: finiteNumber(sample.globalIrradianceWPerM2) ? sample.globalIrradianceWPerM2 : null,
    heatDemandW: null, requiredSupplyTemperatureC: null, zones: [], circuits: [],
  });
  const invalidFixed = invalid || validationErrors(data, probe, fixed, { latitudeDeg: 0 }).size > 0;
  const minimumRoomTemperature = Math.min(...data.zones.map((zone) => roomTemperatures[zone.id]));
  const validTimes = weather.every((sample, index) => Number.isFinite(Date.parse(sample.time))
    && (!index || Date.parse(sample.time) - Date.parse(weather[index - 1].time) === 3600000));
  const hours = weather.map((sample): HeatingHour => {
    if (invalidFixed) return emptyHour(sample, "invalid_model");
    if (missingZoneIds.length) return emptyHour(sample, "missing_temperature");
    if (!validTimes || !finiteNumber(sample.outdoorTemperatureC) || sample.outdoorTemperatureC < -273.15
      || !finiteNumber(sample.globalIrradianceWPerM2) || sample.globalIrradianceWPerM2 < 0
      || !sample.facadeIrradiance || Object.values(sample.facadeIrradiance).some((value) => !finiteNumber(value) || value < 0)) return emptyHour(sample, "missing_weather");
    const demands = data.zones.map((zone) => {
      const loss = heatLossW(zone, temperatures[zone.id], sample.outdoorTemperatureC, data.building.design_outdoor_temperature_c);
      const solar = solarGainsFromFacadesW(zone, sample.facadeIrradiance, data.solar_assumptions);
      return loss === null || solar === null ? null : { loss, solar, demand: Math.max(0, loss - solar) };
    });
    if (demands.some((value) => value === null)) return emptyHour(sample, "missing_weather");
    const known = demands as { loss: number; solar: number; demand: number }[];
    const totalDemand = known.reduce((sum, value) => sum + value.demand, 0);
    const emission = (supplyTemperatureC: number) => circuitEmission(data, { ...probe, supplyTemperatureC }, fixed, roomTemperatures);
    const covers = (value: ReturnType<typeof emission>) => data.zones.every((zone, index) => value.zones.get(zone.id)!.heatingPowerW + 1e-7 >= known[index].demand);
    let supply = MAX_REQUIRED_SUPPLY_C;
    let model = emission(supply);
    let status: HeatingHour["status"] = "unreachable";
    if (totalDemand === 0) {
      status = "off";
      model = emission(minimumRoomTemperature);
    } else if (covers(model)) {
      let low = minimumRoomTemperature, high = MAX_REQUIRED_SUPPLY_C;
      for (let iteration = 0; iteration < 24; iteration++) {
        const middle = (low + high) / 2;
        if (covers(emission(middle))) high = middle;
        else low = middle;
      }
      // Round conservatively so the displayed temperature still covers every room.
      supply = Math.ceil(high * 10) / 10;
      model = emission(supply);
      status = "covered";
    }
    const zones = data.zones.map((zone, index): ZoneSimulationResult => {
      const value = known[index], output = model.zones.get(zone.id)!;
      return { id: zone.id, ...output, heatLossW: value.loss, solarGainsW: value.solar,
        heatDemandW: value.demand, balanceW: output.heatingPowerW - value.demand,
        solarSurplusW: Math.max(0, value.solar - value.loss), peakHeatDemandW: value.demand,
        peakSolarGainsW: value.solar, peakDeficitW: Math.max(0, value.demand - output.heatingPowerW) };
    });
    if (!Number.isFinite(totalDemand) || zones.some((zone) => !Object.values(zone).every(Number.isFinite))) return emptyHour(sample, "invalid_model");
    return { ...emptyHour(sample, status), heatDemandW: totalDemand,
      requiredSupplyTemperatureC: status === "covered" ? supply : null, zones, circuits: model.circuits };
  });
  return { hours, missingZoneIds, heatEnergyKWh: hours.length && hours.every((hour) => hour.heatDemandW !== null)
    ? hours.reduce((sum, hour) => sum + hour.heatDemandW!, 0) / 1000 : null };
}
