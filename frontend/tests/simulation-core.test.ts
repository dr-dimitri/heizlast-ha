// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planningData } from "../src/planning-types";
import { heatLossW, solarGainsFromFacadesW } from "../src/thermal-model";
import {
  SIMULATION_RANGES, defaultSimulationParameters, defaultSimulationScenario, simulateBuilding,
  type SimulationParameters, type SimulationPlanningData, type SimulationScenario, type SimulationSite,
} from "../src/simulation-core";

const lossZone = { load: 1000, temperature: 20 };
const factors = { glazing_fraction: 0.7, g_value: 0.5, shading_factor: 0.9,
  sun_protection_factor: 1, incidence_factor: 0.9 };
const windowZone = { solar_windows: [{ orientation: "S" as const, area_m2: 4 }] };

describe("shared thermal model", () => {
  it("calibrates losses to the design load and scales the actual difference", () => {
    expect(heatLossW(lossZone, 20, -10, -10)).toBe(1000);
    expect(heatLossW(lossZone, 10, -5, -10)).toBe(500);
    expect(heatLossW(lossZone, 20, -25, -10)).toBe(1500);
    expect(heatLossW(lossZone, 20, 25, -10)).toBe(0);
  });

  it("keeps missing and physically invalid numeric temperatures unknown", () => {
    expect(heatLossW(lossZone, undefined, -10, -10)).toBeNull();
    expect(heatLossW(lossZone, 20, null, -10)).toBeNull();
    expect(heatLossW(lossZone, 20, -10)).toBeNull();
    expect(heatLossW(lossZone, -274, -10, -10)).toBeNull();
    expect(heatLossW(lossZone, 20, -274, -10)).toBeNull();
    expect(heatLossW(lossZone, 20, -10, 20)).toBeNull();
  });

  it("uses only the room's window facades and all five correction factors", () => {
    // Whole-window gain: 4 m² × 300 W/m² × 0.2835 = 340.2 W.
    expect(solarGainsFromFacadesW(windowZone, { S: 300 }, factors)).toBeCloseTo(340.2, 10);
    expect(solarGainsFromFacadesW(windowZone, { N: 300 }, factors)).toBeNull();
    expect(solarGainsFromFacadesW(windowZone, { S: 0 }, factors)).toBe(0);
    expect(solarGainsFromFacadesW(windowZone, { S: 300 }, { ...factors, g_value: 0 })).toBe(0);
  });

  it("distinguishes rooms without windows from missing radiation or factors", () => {
    expect(solarGainsFromFacadesW({ solar_windows: [] }, undefined, factors)).toBe(0);
    expect(solarGainsFromFacadesW(windowZone, undefined, factors)).toBeNull();
    expect(solarGainsFromFacadesW({ solar_windows: [] }, undefined)).toBeNull();
  });

  it("rejects invalid planning values and numerical overflow", () => {
    expect(heatLossW({ ...lossZone, load: -1 }, 20, -10, -10)).toBeNull();
    expect(heatLossW({ ...lossZone, load: Number.MAX_VALUE }, 1e308, -10, -10)).toBeNull();
    expect(solarGainsFromFacadesW(windowZone, { S: -1 }, factors)).toBeNull();
    expect(solarGainsFromFacadesW(windowZone, { S: Infinity }, factors)).toBeNull();
    expect(solarGainsFromFacadesW(windowZone, { S: 300 }, { ...factors, incidence_factor: 2 })).toBeNull();
    expect(solarGainsFromFacadesW(windowZone, { S: Number.MAX_VALUE }, factors)).toBeNull();
  });

  it("does not mutate shared planning input or supplied facade readings", () => {
    const zone = Object.freeze({ ...lossZone, solar_windows: Object.freeze([Object.freeze({ orientation: "S" as const, area_m2: 4 })]) });
    const facade = Object.freeze({ S: 300 });
    const frozenFactors = Object.freeze({ ...factors });
    expect(heatLossW(zone, 20, -10, -10)).toBe(1000);
    expect(solarGainsFromFacadesW(zone, facade, frozenFactors)).toBeCloseTo(340.2, 10);
    expect(zone.load).toBe(1000);
    expect(facade.S).toBe(300);
  });
});

const sourceData = (): SimulationPlanningData => ({
  zones: [
    { id: 1, name: "Nordzimmer", floor: "EG", area: 20, load: 1000, temperature: 20,
      solar_windows: [{ orientation: "N", area_m2: 4 }] },
    { id: 2, name: "Südzimmer", floor: "OG", area: 20, load: 1000, temperature: 20,
      solar_windows: [{ orientation: "S", area_m2: 4 }] },
    { id: 3, name: "Innenraum", floor: "OG", area: 10, load: 500, temperature: 20, solar_windows: [] },
  ],
  building: { design_outdoor_temperature_c: -10 },
  solar_assumptions: { ...factors },
  underfloor_heating: { design_supply_temperature_c: 35, design_return_temperature_c: 28 },
});
const runSimulation = (
  scenarioChanges: Partial<SimulationScenario> = {}, parameterChanges: Partial<SimulationParameters> = {},
  data = sourceData(), site: SimulationSite = { latitudeDeg: 45 },
) => simulateBuilding(data, { ...defaultSimulationScenario(data), ...scenarioChanges },
  // Explicit manual reference for the independent emission-curve tests.
  { ...defaultSimulationParameters(data), referenceHeatFluxWPerM2: 50, referenceIndoorTemperatureC: 20, ...parameterChanges }, site);

describe("assumed heating calibration", () => {
  const scenario = { ...defaultSimulationScenario(planningData), supplyTemperatureC: 35,
    indoorTemperatureC: 22, outdoorTemperatureC: -9, weather: "cloudy" as const };
  const parameters = () => ({ ...defaultSimulationParameters(planningData), cloudyDiffuseWPerM2: 0 });
  const site = { latitudeDeg: 45 };

  it("covers all actual zones at 35 °C supply, 22 °C inside and −9 °C outside without solar", () => {
    const before = JSON.stringify(planningData), assumptions = parameters();
    const result = simulateBuilding(planningData, scenario, assumptions, site);
    expect(result.valid).toBe(true);
    expect(result.totals!.solarGainsW).toBe(0);
    expect(result.zones).toHaveLength(planningData.zones.length);
    expect(assumptions.referenceHeatFluxWPerM2).toBe(55);
    expect(assumptions.referenceIndoorTemperatureC).toBe(22);
    for (const zone of result.zones) {
      expect(zone.heatingPowerW).toBeGreaterThanOrEqual(zone.heatDemandW);
      expect(zone.peakDeficitW).toBe(0);
      expect(zone.returnTemperatureC).toBeCloseTo(planningData.underfloor_heating.design_return_temperature_c);
      expect(zone.floorSurfaceTemperatureC).toBeLessThanOrEqual(assumptions.maxFloorSurfaceTemperatureC);
    }
    expect(JSON.stringify(planningData)).toBe(before);
  });

  it("derives the initial reference from the most demanding zone, independent of order and total area", () => {
    const data = sourceData();
    data.zones[0].load = 1200;
    const before = JSON.stringify(data), initial = defaultSimulationParameters(data);
    expect(initial.referenceHeatFluxWPerM2).toBe(78);
    expect(JSON.stringify(data)).toBe(before);
    data.zones = [...data.zones].reverse().concat({ ...data.zones[0], id: 4, area: 100, load: 0 });
    expect(defaultSimulationParameters(data).referenceHeatFluxWPerM2).toBe(initial.referenceHeatFluxWPerM2);
  });

  it("keeps deficits visible for colder weather, lower supply, less active area or manual assumptions", () => {
    const assumptions = parameters();
    const colder = simulateBuilding(planningData, { ...scenario, outdoorTemperatureC: -12 }, assumptions, site);
    const lowerSupply = simulateBuilding(planningData, { ...scenario, supplyTemperatureC: 34 }, assumptions, site);
    const lessFloor = simulateBuilding(planningData, scenario, { ...assumptions, activeFloorFraction: 0.7 }, site);
    const manual = simulateBuilding(planningData, scenario,
      { ...assumptions, referenceHeatFluxWPerM2: 50, referenceIndoorTemperatureC: 20 }, site);
    const surfaceLimited = simulateBuilding(planningData, scenario,
      { ...assumptions, maxFloorSurfaceTemperatureC: 25 }, site);
    for (const result of [colder, lowerSupply, lessFloor, manual, surfaceLimited]) {
      expect(result.valid).toBe(true);
      expect(result.zones.some((zone) => zone.peakDeficitW > 0)).toBe(true);
    }
    expect(colder.totals!.heatingPowerW).toBe(simulateBuilding(planningData, scenario, assumptions, site).totals!.heatingPowerW);
    expect(manual.zones.filter((zone) => zone.peakDeficitW > 0)).toHaveLength(8);
    expect(assumptions).toEqual(parameters());
  });

  it("does not fabricate a usable calibration for impossible data or water temperatures", () => {
    for (const area of [0, -1, NaN]) {
      const data = sourceData(); data.zones[0].area = area;
      expect(simulateBuilding(data, scenario, defaultSimulationParameters(data), site).valid).toBe(false);
    }
    const data = sourceData(); data.zones[0].load *= 10;
    expect(simulateBuilding(data, scenario, defaultSimulationParameters(data), site).valid).toBe(false);
    data.zones[0].load /= 10;
    data.underfloor_heating = { design_supply_temperature_c: 25, design_return_temperature_c: 23 };
    expect(simulateBuilding(data, scenario, defaultSimulationParameters(data), site).errors).toContain("referenceHeatFluxWPerM2");
  });
});

describe("isolated floor-heating simulation", () => {
  it("imports and runs without DOM or Home Assistant", () => {
    expect(typeof document).toBe("undefined");
    const result = runSimulation();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.zones).toHaveLength(3);
  });

  it("derives supply and return-drop defaults from source data while keeping assumptions adjustable", () => {
    const data = sourceData();
    expect(defaultSimulationScenario(data)).toEqual({ supplyTemperatureC: 35, indoorTemperatureC: 22, outdoorTemperatureC: 5, weather: "sunny", month: 1 });
    expect(defaultSimulationParameters(data).returnDropK).toBe(7);
    expect(defaultSimulationParameters(data).referenceHeatFluxWPerM2).toBe(65);
    expect(defaultSimulationParameters(data).referenceIndoorTemperatureC).toBe(22);
    data.underfloor_heating = { design_supply_temperature_c: 40, design_return_temperature_c: 30 };
    expect(defaultSimulationScenario(data).supplyTemperatureC).toBe(40);
    expect(defaultSimulationParameters(data).returnDropK).toBe(10);
  });

  it("produces the chosen reference flux at the documented supply/return and reference room temperature", () => {
    const result = runSimulation({ indoorTemperatureC: 20 }, { maxFloorSurfaceTemperatureC: 35 });
    const room = result.zones[0];
    expect(room.activeFloorAreaM2).toBe(16);
    expect(room.heatingPowerW).toBeCloseTo(16 * 50, 10);
    expect(room.floorSurfaceTemperatureC).toBeCloseTo(20 + Math.pow(50 / 8.92, 1 / 1.1), 10);
  });

  it("increases power with supply temperature and decreases it with the indoor target", () => {
    const lowSupply = runSimulation({ supplyTemperatureC: 30 });
    const highSupply = runSimulation({ supplyTemperatureC: 35 });
    const warmerInside = runSimulation({ supplyTemperatureC: 35, indoorTemperatureC: 24 });
    expect(highSupply.totals!.heatingPowerW).toBeGreaterThan(lowSupply.totals!.heatingPowerW);
    expect(warmerInside.totals!.heatingPowerW).toBeLessThan(highSupply.totals!.heatingPowerW);
    expect(warmerInside.totals!.heatLossW).toBeGreaterThan(highSupply.totals!.heatLossW);
  });

  it("couples a low supply temperature to a small output with return above the room temperature", () => {
    const low = runSimulation({ supplyTemperatureC: 25, indoorTemperatureC: 22 });
    const zone = low.zones[0];
    expect(low.valid).toBe(true);
    expect(zone.heatFluxWPerM2).toBeGreaterThan(0);
    expect(zone.heatFluxWPerM2).toBeLessThan(50 * 3 / 7);
    expect(zone.returnTemperatureC).toBeGreaterThan(22);
    expect(zone.returnTemperatureC).toBeLessThan(25);
    expect(zone.returnTemperatureC).toBeCloseTo(25 - 7 * zone.heatFluxWPerM2 / 50, 10);
    for (const supplyTemperatureC of [0, 20, 22]) {
      const unheated = runSimulation({ supplyTemperatureC });
      expect(unheated.totals!.heatingPowerW).toBe(0);
      expect(unheated.zones[0].returnTemperatureC).toBe(supplyTemperatureC);
    }
  });

  it("solves the logarithmic mean emission equation at the coupled return temperature", () => {
    const result = runSimulation({ supplyTemperatureC: 30 });
    const zone = result.zones[0], a = 30 - 22, b = zone.returnTemperatureC - 22;
    const meanDelta = (a - b) / Math.log(a / b);
    const referenceMeanDelta = (15 - 8) / Math.log(15 / 8);
    expect(zone.heatFluxWPerM2).toBeCloseTo(50 * Math.pow(meanDelta / referenceMeanDelta, 1.1), 10);
  });

  it("handles the zero-drop limit and preserves the adjustable reference point", () => {
    const equalWater = runSimulation({ supplyTemperatureC: 30 }, { returnDropK: 0 });
    expect(equalWater.zones[0].returnTemperatureC).toBe(30);
    expect(equalWater.zones[0].heatFluxWPerM2).toBeCloseTo(50 * Math.pow((30 - 22) / (35 - 20), 1.1), 10);
    const changedDrop = runSimulation({ indoorTemperatureC: 20 }, { returnDropK: 10, maxFloorSurfaceTemperatureC: 35 });
    expect(changedDrop.zones[0].heatFluxWPerM2).toBeCloseTo(50, 10);
    expect(changedDrop.zones[0].returnTemperatureC).toBeCloseTo(25, 10);
  });

  it("rejects a reference calibration whose floor would be hotter than its heating water", () => {
    const result = runSimulation({ supplyTemperatureC: 25, indoorTemperatureC: 22 }, {
      referenceHeatFluxWPerM2: 200, referenceIndoorTemperatureC: 30,
      returnDropK: 4, maxFloorSurfaceTemperatureC: 35,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("referenceHeatFluxWPerM2");
    expect(result.zones).toEqual([]);
    expect(result.totals).toBeNull();
  });

  it("accepts a physically possible high reference output and preserves its calibration", () => {
    const parameters = { referenceHeatFluxWPerM2: 200, referenceIndoorTemperatureC: 10,
      returnDropK: 4, maxFloorSurfaceTemperatureC: 35 };
    const reference = runSimulation({ supplyTemperatureC: 35, indoorTemperatureC: 10 }, parameters);
    expect(reference.valid).toBe(true);
    expect(reference.zones[0].heatFluxWPerM2).toBeCloseTo(200, 10);
    expect(reference.zones[0].returnTemperatureC).toBeCloseTo(31, 10);
    const operating = runSimulation({ supplyTemperatureC: 25, indoorTemperatureC: 22 }, parameters);
    const zone = operating.zones[0], a = 25 - 22, b = zone.returnTemperatureC - 22;
    const waterTemperature = 22 + (a - b) / Math.log(a / b);
    expect(operating.valid).toBe(true);
    expect(zone.floorSurfaceTemperatureC).toBeLessThanOrEqual(waterTemperature + 1e-10);
    expect(waterTemperature).toBeLessThanOrEqual(25);
  });

  it("limits shallow-exponent curves at low supply by the actual heating-water temperature", () => {
    for (const supplyTemperatureC of [22.01, 22.1, 22.5, 23, 25]) {
      const result = runSimulation({ supplyTemperatureC }, { emissionExponent: 0.5, maxFloorSurfaceTemperatureC: 35 });
      const zone = result.zones[0], a = supplyTemperatureC - 22, b = zone.returnTemperatureC - 22;
      const waterTemperature = 22 + (a - b) / Math.log(a / b);
      expect(result.valid).toBe(true);
      expect(zone.heatFluxWPerM2).toBeGreaterThan(0);
      expect(zone.returnTemperatureC).toBeGreaterThan(22);
      expect(zone.floorSurfaceTemperatureC).toBeLessThanOrEqual(waterTemperature + 1e-10);
      expect(waterTemperature).toBeLessThanOrEqual(supplyTemperatureC);
    }
  });

  it("allows a reference exactly on the heating-water surface bound despite harmless rounding", () => {
    const referenceDelta = (15 - 8) / Math.log(15 / 8);
    const referenceHeatFluxWPerM2 = 8.92 * Math.pow(referenceDelta, 1.1);
    expect(runSimulation({}, { referenceHeatFluxWPerM2 }).valid).toBe(true);
    expect(runSimulation({}, { referenceHeatFluxWPerM2: referenceHeatFluxWPerM2 * (1 + 1e-12) }).valid).toBe(true);
    expect(runSimulation({}, { referenceHeatFluxWPerM2: referenceHeatFluxWPerM2 * (1 + 1e-7) }).errors).toContain("referenceHeatFluxWPerM2");
  });

  it("uses outside temperature for losses, without changing the modeled floor emission", () => {
    const cold = runSimulation({ outdoorTemperatureC: -10 });
    const mild = runSimulation({ outdoorTemperatureC: 5 });
    expect(cold.totals!.heatLossW).toBeGreaterThan(mild.totals!.heatLossW);
    expect(cold.totals!.heatingPowerW).toBe(mild.totals!.heatingPowerW);
    expect(cold.totals!.balanceW).toBeLessThan(mild.totals!.balanceW);
    expect(runSimulation({ outdoorTemperatureC: 30 }).totals!.heatLossW).toBe(0);
  });

  it("distinguishes direct south-facing sun from north windows and diffuse cloudy weather", () => {
    const sunny = runSimulation();
    const cloudy = runSimulation({ weather: "cloudy" });
    expect(sunny.facadeIrradiance!.S).toBeGreaterThan(sunny.facadeIrradiance!.N);
    expect(sunny.zones[1].solarGainsW).toBeGreaterThan(sunny.zones[0].solarGainsW);
    expect(sunny.zones[1].solarGainsW).toBeGreaterThan(cloudy.zones[1].solarGainsW);
    expect(cloudy.facadeIrradiance!.N).toBeGreaterThan(0);
    expect(cloudy.facadeIrradiance!.N).toBe(cloudy.facadeIrradiance!.S);
    expect(cloudy.facadeIrradiance!.E).toBe(cloudy.facadeIrradiance!.W);
    expect(cloudy.zones[0].solarGainsW).toBe(cloudy.zones[1].solarGainsW);
    expect(sunny.zones[2].solarGainsW).toBe(0);
  });

  it("integrates both morning east and afternoon west sun without a permanent noon direction", () => {
    const daily = runSimulation({}, { sunnyDiffuseWPerM2: 0, groundReflectance: 0 });
    expect(daily.facadeIrradiance!.E).toBeGreaterThan(0);
    expect(daily.facadeIrradiance!.E).toBeCloseTo(daily.facadeIrradiance!.W, 10);
    expect(daily.facadeIrradiance!.N).toBe(0);
    expect(daily.facadeIrradiance!.S).toBeGreaterThan(daily.facadeIrradiance!.E);
  });

  it("caps each interval's demand and keeps the night demand when daytime solar exceeds losses", () => {
    const result = runSimulation({ outdoorTemperatureC: 20 });
    const south = result.zones[1];
    expect(south.peakSolarGainsW).toBeGreaterThan(south.heatLossW);
    expect(south.heatDemandW).toBeGreaterThan(0);
    expect(south.heatDemandW).toBeLessThan(south.heatLossW);
    expect(south.solarSurplusW).toBeGreaterThan(0);
    expect(south.balanceW).toBe(south.heatingPowerW - south.heatDemandW);
    const meanFields = ["heatLossW", "solarGainsW", "heatDemandW", "heatingPowerW", "balanceW", "solarSurplusW"] as const;
    for (const field of meanFields) {
      expect(result.totals![field]).toBeCloseTo(result.zones.reduce((sum, zone) => sum + zone[field], 0), 10);
    }
    expect(result.totals!.balanceW).toBeCloseTo(result.totals!.heatingPowerW - result.totals!.heatDemandW, 10);
    expect(result.totals!.peakHeatDemandW).toBe(result.totals!.heatLossW);
    expect(result.totals!.peakDeficitW).toBe(Math.max(0, result.totals!.peakHeatDemandW - result.totals!.heatingPowerW));
  });

  it("caps floor emission using the surface-temperature limit", () => {
    const result = runSimulation({ supplyTemperatureC: 60 }, { maxFloorSurfaceTemperatureC: 29 });
    const maxFlux = 8.92 * Math.pow(29 - 22, 1.1);
    expect(result.zones[0].heatingPowerW).toBeCloseTo(16 * maxFlux, 10);
    expect(result.zones[0].floorSurfaceTemperatureC).toBeCloseTo(29, 10);
    expect(runSimulation({ supplyTemperatureC: 0 }).totals!.heatingPowerW).toBe(0);
    expect(runSimulation({}, { activeFloorFraction: 0 }).totals!.heatingPowerW).toBe(0);
    const noSurfaceHeadroom = runSimulation({}, { maxFloorSurfaceTemperatureC: 15 });
    expect(noSurfaceHeadroom.totals!.heatingPowerW).toBe(0);
    expect(noSurfaceHeadroom.zones[0].floorSurfaceTemperatureC).toBe(22);
  });

  it("allows adjustment of the emission reference, exponent and active floor fraction", () => {
    const baseline = runSimulation({ supplyTemperatureC: 30 });
    const halfFloor = runSimulation({ supplyTemperatureC: 30 }, { activeFloorFraction: 0.4 });
    expect(halfFloor.totals!.heatingPowerW).toBeCloseTo(baseline.totals!.heatingPowerW / 2, 10);
    const doubleReference = runSimulation({ supplyTemperatureC: 30 }, { referenceHeatFluxWPerM2: 100, maxFloorSurfaceTemperatureC: 35 });
    expect(doubleReference.totals!.heatingPowerW).toBeCloseTo(baseline.totals!.heatingPowerW * 2, 10);
    const differentExponent = runSimulation({ supplyTemperatureC: 30 }, { emissionExponent: 2 });
    expect(differentExponent.totals!.heatingPowerW).not.toBeCloseTo(baseline.totals!.heatingPowerW, 5);
  });

  it("rejects every out-of-range and nonfinite scenario or parameter field without partial results", () => {
    const data = sourceData(), scenario = defaultSimulationScenario(data), parameters = defaultSimulationParameters(data), site = { latitudeDeg: 45 };
    for (const [field, [min, max]] of Object.entries(SIMULATION_RANGES)) {
      for (const invalid of [min - 1, max + 1, NaN, Infinity, -Infinity]) {
        const result = field in scenario
          ? simulateBuilding(data, { ...scenario, [field]: invalid }, parameters, site)
          : field === "latitudeDeg" ? simulateBuilding(data, scenario, parameters, { latitudeDeg: invalid })
          : simulateBuilding(data, scenario, { ...parameters, [field]: invalid }, site);
        expect(result.valid, field).toBe(false);
        expect(result.errors, field).toContain(field);
        expect(result.zones, field).toEqual([]);
        expect(result.totals, field).toBeNull();
        expect(result.facadeIrradiance, field).toBeNull();
        expect(result.solarProfile, field).toBeNull();
      }
    }
    expect(runSimulation({ weather: "rainy" as SimulationScenario["weather"] }).errors).toContain("weather");
  });

  it("rejects an invalid reference difference and invalid planning data", () => {
    const data = sourceData();
    data.underfloor_heating = { design_supply_temperature_c: 25, design_return_temperature_c: 20 };
    expect(runSimulation({}, { referenceIndoorTemperatureC: 25 }, data).errors).toContain("referenceIndoorTemperatureC");
    data.zones[0].area = -1;
    data.zones[1].solar_windows = [{ orientation: "S", area_m2: NaN }];
    data.solar_assumptions.g_value = 1.1;
    const result = runSimulation({}, {}, data);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("data.zones[0].area");
    expect(result.errors).toContain("data.zones[1].solar_windows[0]");
    expect(result.errors).toContain("data.solar_assumptions.g_value");
  });

  it("rejects finite source values that overflow room output or aggregate totals", () => {
    const data = sourceData();
    data.zones[0].area = Number.MAX_VALUE;
    expect(runSimulation({}, {}, data).valid).toBe(false);
    const sumOverflow = sourceData();
    sumOverflow.zones.forEach((zone) => { zone.load = Number.MAX_VALUE; zone.solar_windows = []; });
    const result = runSimulation({ indoorTemperatureC: 20, outdoorTemperatureC: -10 }, {}, sumOverflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("calculation");
    expect(result.totals).toBeNull();
  });

  it("uses source changes immediately and does not keep a copied planning dataset", () => {
    const data = sourceData(), scenario = defaultSimulationScenario(data), parameters = defaultSimulationParameters(data);
    const initial = simulateBuilding(data, scenario, parameters, { latitudeDeg: 45 });
    data.zones[0].load *= 2;
    data.zones[1].solar_windows = [{ orientation: "S", area_m2: 8 }];
    data.underfloor_heating.design_supply_temperature_c = 40;
    const changed = simulateBuilding(data, scenario, parameters, { latitudeDeg: 45 });
    expect(changed.zones[0].heatLossW).toBeCloseTo(initial.zones[0].heatLossW * 2, 10);
    expect(changed.zones[1].solarGainsW).toBeCloseTo(initial.zones[1].solarGainsW * 2, 10);
    expect(changed.totals!.heatingPowerW).toBeLessThan(initial.totals!.heatingPowerW);
  });

  it("keeps input data and assumptions unchanged and returns independent result objects", () => {
    const data = sourceData(), scenario = defaultSimulationScenario(data), parameters = defaultSimulationParameters(data), site = { latitudeDeg: 45 };
    const before = JSON.stringify({ data, scenario, parameters, site });
    const result = simulateBuilding(data, scenario, parameters, site);
    expect(JSON.stringify({ data, scenario, parameters, site })).toBe(before);
    result.zones[0].heatingPowerW = 0;
    result.facadeIrradiance!.S = 0;
    const again = simulateBuilding(data, scenario, parameters, site);
    expect(again.zones[0].heatingPowerW).toBeGreaterThan(0);
    expect(again.facadeIrradiance!.S).toBeGreaterThan(0);
  });
});

describe("monthly solar-day model", () => {
  it("uses the whole representative day with approximately astronomical winter and summer daylight", () => {
    const winter = runSimulation({ month: 1 }), summer = runSimulation({ month: 6 });
    expect(winter.solarProfile).toEqual({ representativeDay: 15, steps: 96, daylightHours: 9 });
    expect(summer.solarProfile!.daylightHours).toBeCloseTo(15.5, 1);
    const equatorWinter = runSimulation({ month: 1 }, {}, sourceData(), { latitudeDeg: 0 });
    const equatorSummer = runSimulation({ month: 6 }, {}, sourceData(), { latitudeDeg: 0 });
    expect(equatorWinter.solarProfile!.daylightHours).toBe(12);
    expect(equatorSummer.solarProfile!.daylightHours).toBe(12);
    expect(winter.zones[1].peakSolarGainsW).toBeGreaterThan(winter.zones[1].solarGainsW);
    expect(summer.zones[1].heatDemandW).not.toBe(winter.zones[1].heatDemandW);
    expect(summer.totals!.heatingPowerW).toBe(winter.totals!.heatingPowerW);
  });

  it("reverses seasons and winter-facing sunlight between northern and southern hemispheres", () => {
    const northWinter = runSimulation({ month: 1 }, {}, sourceData(), { latitudeDeg: 45 });
    const northSummer = runSimulation({ month: 6 }, {}, sourceData(), { latitudeDeg: 45 });
    const southSummer = runSimulation({ month: 1 }, {}, sourceData(), { latitudeDeg: -45 });
    const southWinter = runSimulation({ month: 6 }, {}, sourceData(), { latitudeDeg: -45 });
    expect(northWinter.solarProfile!.daylightHours).toBeLessThan(northSummer.solarProfile!.daylightHours);
    expect(southWinter.solarProfile!.daylightHours).toBeLessThan(southSummer.solarProfile!.daylightHours);
    expect(northWinter.facadeIrradiance!.S).toBeGreaterThan(northWinter.facadeIrradiance!.N);
    expect(southWinter.facadeIrradiance!.N).toBeGreaterThan(southWinter.facadeIrradiance!.S);
  });

  it("makes polar night entirely dark and polar day finite for both hemispheres", () => {
    for (const latitudeDeg of [-90, 90]) {
      const winterMonth = latitudeDeg > 0 ? 12 : 6, summerMonth = latitudeDeg > 0 ? 6 : 12;
      const night = runSimulation({ month: winterMonth }, {}, sourceData(), { latitudeDeg });
      const day = runSimulation({ month: summerMonth }, {}, sourceData(), { latitudeDeg });
      expect(night.valid).toBe(true);
      expect(night.solarProfile!.daylightHours).toBe(0);
      expect(night.facadeIrradiance).toEqual({ N: 0, E: 0, S: 0, W: 0 });
      expect(night.totals!.solarGainsW).toBe(0);
      expect(night.totals!.solarSurplusW).toBe(0);
      expect(night.totals!.heatDemandW).toBeCloseTo(night.totals!.heatLossW, 10);
      expect(day.valid).toBe(true);
      expect(day.solarProfile!.daylightHours).toBe(24);
      for (const value of Object.values(day.facadeIrradiance!)) expect(Number.isFinite(value) && value > 0).toBe(true);
    }
  });

  it("balances average losses, raw gains, unmet demand and unused midday excess without overnight storage", () => {
    const result = runSimulation({ outdoorTemperatureC: 20 });
    const nightFraction = 1 - result.solarProfile!.daylightHours / 24;
    for (const room of result.zones) {
      expect(room.heatLossW + room.solarSurplusW).toBeCloseTo(room.heatDemandW + room.solarGainsW, 10);
      expect(room.heatDemandW).toBeGreaterThanOrEqual(room.heatLossW * nightFraction - 1e-10);
      expect(room.peakHeatDemandW).toBe(room.heatLossW);
      expect(room.peakDeficitW).toBe(Math.max(0, room.heatLossW - room.heatingPowerW));
    }
    const totals = result.totals!;
    expect(totals.heatLossW + totals.solarSurplusW).toBeCloseTo(totals.heatDemandW + totals.solarGainsW, 10);
    expect(result.zones[1].heatDemandW).toBeGreaterThan(Math.max(0, result.zones[1].heatLossW - result.zones[1].solarGainsW));
  });

  it("reports a night deficit even when the average balance is positive", () => {
    const data = sourceData();
    data.zones = [{ ...data.zones[1], solar_windows: [{ orientation: "S", area_m2: 40 }] }];
    const result = runSimulation({ supplyTemperatureC: 28, outdoorTemperatureC: 10 }, {}, data);
    const zone = result.zones[0];
    expect(zone.balanceW).toBeGreaterThan(0);
    expect(zone.peakDeficitW).toBeGreaterThan(0);
    expect(result.totals!.peakDeficitW).toBe(zone.peakDeficitW);
    expect(zone.solarSurplusW).toBeGreaterThan(0);
  });

  it("finds simultaneous building solar peaks rather than adding peaks reached by different facades", () => {
    const data = sourceData();
    data.zones = [
      { ...data.zones[0], solar_windows: [{ orientation: "E", area_m2: 4 }] },
      { ...data.zones[1], solar_windows: [{ orientation: "W", area_m2: 4 }] },
    ];
    const result = runSimulation({ month: 6 }, {}, data);
    const separatePeaks = result.zones.reduce((sum, room) => sum + room.peakSolarGainsW, 0);
    expect(result.totals!.peakSolarGainsW).toBeLessThan(separatePeaks);
    expect(result.totals!.peakSolarGainsW).toBeGreaterThanOrEqual(Math.max(...result.zones.map((room) => room.peakSolarGainsW)));
  });

  it("retains only diffuse cloudy gains and honors adjustable reference intensities", () => {
    const cloudy = runSimulation({ weather: "cloudy" });
    expect(cloudy.facadeIrradiance!.N).toBe(cloudy.facadeIrradiance!.E);
    expect(cloudy.facadeIrradiance!.S).toBe(cloudy.facadeIrradiance!.W);
    const doubled = runSimulation({ weather: "cloudy" }, { cloudyDiffuseWPerM2: 300 });
    expect(doubled.totals!.solarGainsW).toBeCloseTo(cloudy.totals!.solarGainsW * 2, 10);
    const dark = runSimulation({}, { sunnyDirectNormalWPerM2: 0, sunnyDiffuseWPerM2: 0 });
    expect(dark.totals!.solarGainsW).toBe(0);
    expect(dark.totals!.heatDemandW).toBeCloseTo(dark.totals!.heatLossW, 10);
  });

  it("requires an explicit valid site and an integer month instead of inventing a location", () => {
    for (const month of [0, 13, 1.5, NaN, Infinity]) {
      const result = runSimulation({ month });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("month");
    }
    const data = sourceData(), scenario = defaultSimulationScenario(data), parameters = defaultSimulationParameters(data);
    for (const site of [undefined, {}, { latitudeDeg: NaN }, { latitudeDeg: "45" }, { latitudeDeg: 91 }]) {
      const result = simulateBuilding(data, scenario, parameters, site as SimulationSite);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("latitudeDeg");
      expect(result.solarProfile).toBeNull();
    }
    for (let month = 1; month <= 12; month++) expect(runSimulation({ month }).valid).toBe(true);
  });

  it("keeps runtime latitude out of planning input and result metadata", () => {
    const data = sourceData(), before = JSON.stringify(data);
    const result = runSimulation({}, {}, data, { latitudeDeg: 45 });
    expect(JSON.stringify(data)).toBe(before);
    expect(result.solarProfile).not.toHaveProperty("latitudeDeg");
    expect(data).not.toHaveProperty("latitudeDeg");
  });
});
