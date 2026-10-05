// @vitest-environment node
import { describe, expect, it } from "vitest";
import { heatLossW, solarGainsFromFacadesW } from "../src/thermal-model";
import {
  SIMULATION_RANGES, defaultSimulationParameters, defaultSimulationScenario, simulateBuilding,
  type SimulationParameters, type SimulationPlanningData, type SimulationScenario,
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
  data = sourceData(),
) => simulateBuilding(data, { ...defaultSimulationScenario(data), ...scenarioChanges },
  { ...defaultSimulationParameters(data), ...parameterChanges });

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
    expect(defaultSimulationScenario(data)).toEqual({ supplyTemperatureC: 35, indoorTemperatureC: 22, outdoorTemperatureC: 5, weather: "sunny" });
    expect(defaultSimulationParameters(data).returnDropK).toBe(7);
    expect(defaultSimulationParameters(data).referenceHeatFluxWPerM2).toBe(50);
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
    expect(cloudy.facadeIrradiance).toEqual({ N: 90, E: 90, S: 90, W: 90 });
    expect(cloudy.zones[0].solarGainsW).toBe(cloudy.zones[1].solarGainsW);
    expect(sunny.zones[2].solarGainsW).toBe(0);
  });

  it("rotates direct gains with sun azimuth and suppresses the direct component at the horizon", () => {
    const east = runSimulation({}, { sunAzimuthDeg: 90, sunnyDiffuseWPerM2: 0, groundReflectance: 0 });
    expect(east.facadeIrradiance!.E).toBeCloseTo(700 * Math.cos(Math.PI / 4), 10);
    expect(east.facadeIrradiance!.W).toBe(0);
    const horizon = runSimulation({}, { sunElevationDeg: 0 });
    expect(horizon.facadeIrradiance).toEqual({ N: 60, E: 60, S: 60, W: 60 });
  });

  it("caps demand at zero and calculates balance and totals from the room results", () => {
    const result = runSimulation({ outdoorTemperatureC: 20 });
    const south = result.zones[1];
    expect(south.solarGainsW).toBeGreaterThan(south.heatLossW);
    expect(south.heatDemandW).toBe(0);
    expect(south.balanceW).toBe(south.heatingPowerW);
    for (const field of Object.keys(result.totals!) as Array<keyof NonNullable<typeof result.totals>>) {
      expect(result.totals![field]).toBeCloseTo(result.zones.reduce((sum, zone) => sum + zone[field], 0), 10);
    }
    expect(result.totals!.balanceW).toBeCloseTo(result.totals!.heatingPowerW - result.totals!.heatDemandW, 10);
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
    const data = sourceData(), scenario = defaultSimulationScenario(data), parameters = defaultSimulationParameters(data);
    for (const [field, [min, max]] of Object.entries(SIMULATION_RANGES)) {
      for (const invalid of [min - 1, max + 1, NaN, Infinity, -Infinity]) {
        const result = field in scenario
          ? simulateBuilding(data, { ...scenario, [field]: invalid }, parameters)
          : simulateBuilding(data, scenario, { ...parameters, [field]: invalid });
        expect(result.valid, field).toBe(false);
        expect(result.errors, field).toContain(field);
        expect(result.zones, field).toEqual([]);
        expect(result.totals, field).toBeNull();
        expect(result.facadeIrradiance, field).toBeNull();
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
    const initial = simulateBuilding(data, scenario, parameters);
    data.zones[0].load *= 2;
    data.zones[1].solar_windows = [{ orientation: "S", area_m2: 8 }];
    data.underfloor_heating.design_supply_temperature_c = 40;
    const changed = simulateBuilding(data, scenario, parameters);
    expect(changed.zones[0].heatLossW).toBeCloseTo(initial.zones[0].heatLossW * 2, 10);
    expect(changed.zones[1].solarGainsW).toBeCloseTo(initial.zones[1].solarGainsW * 2, 10);
    expect(changed.totals!.heatingPowerW).toBeLessThan(initial.totals!.heatingPowerW);
  });

  it("keeps input data and assumptions unchanged and returns independent result objects", () => {
    const data = sourceData(), scenario = defaultSimulationScenario(data), parameters = defaultSimulationParameters(data);
    const before = JSON.stringify({ data, scenario, parameters });
    const result = simulateBuilding(data, scenario, parameters);
    expect(JSON.stringify({ data, scenario, parameters })).toBe(before);
    result.zones[0].heatingPowerW = 0;
    result.facadeIrradiance!.S = 0;
    const again = simulateBuilding(data, scenario, parameters);
    expect(again.zones[0].heatingPowerW).toBeGreaterThan(0);
    expect(again.facadeIrradiance!.S).toBeGreaterThan(0);
  });
});
