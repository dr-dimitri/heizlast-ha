// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planningData } from "../src/planning-types";
import { buildingDesignHeatLossZones, heatLossW, solarGainsFromFacadesW } from "../src/thermal-model";
import { estimateHeatPumpDay } from "../src/heat-pump";
import { estimateGasUse, simulateHeatingDay, simulateBuilding, defaultSimulationParameters, defaultSimulationScenario, type HourlyWeather } from "../src/simulation-core";

const temperatures = () => Object.fromEntries(planningData.zones.map((zone) => [zone.id, 22]));
const weather = (outdoorTemperatureC = 0, solar = 0): HourlyWeather[] => Array.from({ length: 24 }, (_, hour) => ({
  time: new Date(Date.UTC(2026, 0, 1, hour)).toISOString(), outdoorTemperatureC,
  globalIrradianceWPerM2: solar, facadeIrradiance: { N: solar / 4, E: solar / 2, S: solar, W: solar / 2 },
}));

describe("weather-driven hourly heating curve", () => {
  it("matches the documented building design load separately from conservative room sizing", () => {
    const rooms = Object.fromEntries(planningData.zones.map((zone) => [zone.id, zone.temperature]));
    const result = simulateHeatingDay(planningData, weather(planningData.building.design_outdoor_temperature_c).slice(0, 1), rooms);
    const hour = result.hours[0];
    expect(hour.heatDemandW).toBeCloseTo(planningData.building.heat_load_w, 8);
    expect(hour.roomHeatDemandW).toBeCloseTo(planningData.zones.reduce((sum, zone) => sum + zone.load, 0), 8);
    expect(hour.roomHeatDemandW).toBeGreaterThan(hour.heatDemandW!);
    expect(hour.zones.reduce((sum, zone) => sum + zone.heatDemandW, 0)).toBe(hour.roomHeatDemandW);
    expect(result.heatEnergyKWh).toBeCloseTo(planningData.building.heat_load_w / 1000, 10);
    expect(estimateGasUse(result.heatEnergyKWh, 10).gasEnergyKWh).toBeCloseTo(planningData.building.heat_load_w / 950, 10);
  });

  it("uses half ventilation per room, including different indoor temperatures, rather than a global room-load factor", () => {
    const source = [{ temperature: 20, transmission: 700, ventilation: 300 },
      { temperature: 24, transmission: 100, ventilation: 900 }];
    const allocated = buildingDesignHeatLossZones(source, 1400)!;
    expect(allocated.map((zone) => zone.temperature)).toEqual([20, 24]);
    expect(allocated[0].load).toBeCloseTo(850, 10);
    expect(allocated[1].load).toBeCloseTo(550, 10);
    const rooms = temperatures(); rooms[1] = 18; rooms[7] = 24;
    const before = JSON.stringify([planningData, rooms]);
    const hour = simulateHeatingDay(planningData, weather(6.9).slice(0, 1), rooms).hours[0];
    const raw = planningData.zones.reduce((sum, zone) => sum + zone.transmission + zone.ventilation / 2, 0);
    const expected = planningData.zones.reduce((sum, zone) => sum
      + ((zone.transmission + zone.ventilation / 2) / raw) * planningData.building.heat_load_w
      * (rooms[zone.id] - 6.9) / (zone.temperature - planningData.building.design_outdoor_temperature_c), 0);
    expect(hour.heatDemandW).toBeCloseTo(expected, 8);
    const globalRoomScaling = hour.roomHeatDemandW! * planningData.building.heat_load_w
      / planningData.zones.reduce((sum, zone) => sum + zone.load, 0);
    expect(hour.heatDemandW).not.toBeCloseTo(globalRoomScaling, 2);
    expect(JSON.stringify([planningData, rooms])).toBe(before);
    const mild = simulateHeatingDay(planningData, weather(6.9).slice(0, 1), temperatures()).hours[0];
    expect(mild.heatDemandW).toBeCloseTo(2625.619375495821, 8);
    expect(mild.roomHeatDemandW).toBeGreaterThan(3200);
  });

  it("subtracts full solar gains from each building contribution before clamping without transferring surplus", () => {
    const rooms = temperatures(), inputs = weather(6.9, 500).slice(0, 2);
    inputs[1] = { ...weather(6.9)[0], time: inputs[1].time };
    const hour = simulateHeatingDay(planningData, inputs, rooms).hours[0];
    const raw = planningData.zones.reduce((sum, zone) => sum + zone.transmission + zone.ventilation / 2, 0);
    const contributions = planningData.zones.map((zone) => {
      const loss = (zone.transmission + zone.ventilation / 2) / raw * planningData.building.heat_load_w
        * (22 - 6.9) / (zone.temperature - planningData.building.design_outdoor_temperature_c);
      const solar = solarGainsFromFacadesW(zone, inputs[0].facadeIrradiance, planningData.solar_assumptions)!;
      return { loss, solar };
    });
    expect(contributions.some(({ loss, solar }) => solar > loss)).toBe(true);
    const expected = contributions.reduce((sum, { loss, solar }) => sum + Math.max(0, loss - solar), 0);
    expect(hour.heatDemandW).toBeCloseTo(expected, 8);
    const pooled = Math.max(0, contributions.reduce((sum, { loss, solar }) => sum + loss - solar, 0));
    expect(hour.heatDemandW).toBeGreaterThan(pooled);
    const result = simulateHeatingDay(planningData, inputs, rooms);
    const dark = simulateHeatingDay(planningData, [inputs[1]], rooms).hours[0];
    expect(result.hours[1].heatDemandW).toBe(dark.heatDemandW);
    expect(result.heatEnergyKWh).toBeCloseTo((expected + dark.heatDemandW!) / 1000, 10);
    expect(hour.heatDemandW).toBeLessThan(hour.roomHeatDemandW!);
  });

  it("keeps building energy unknown for missing or invalid components without hiding valid room calculations", () => {
    for (const field of ["transmission", "ventilation"] as const) {
      for (const value of [undefined, null, -1, NaN, Infinity]) {
        const data = structuredClone(planningData);
        Object.assign(data.zones[0], { [field]: value });
        const result = simulateHeatingDay(data, weather(6.9).slice(0, 1), temperatures());
        expect(result.hours[0].heatDemandW).toBeNull();
        expect(result.heatEnergyKWh).toBeNull();
        expect(result.hours[0].roomHeatDemandW).toBeGreaterThan(0);
        expect(result.hours[0].status).toBe("covered");
        expect(result.hours[0].zones).toHaveLength(planningData.zones.length);
        expect(estimateGasUse(result.heatEnergyKWh, 10).gasEnergyKWh).toBeNull();
        expect(estimateHeatPumpDay(result).electricityKWh).toBeNull();
      }
    }
    for (const value of [undefined, null, -1, NaN, Infinity]) {
      const data = structuredClone(planningData);
      Object.assign(data.building, { heat_load_w: value });
      expect(simulateHeatingDay(data, weather(6.9).slice(0, 1), temperatures()).heatEnergyKWh).toBeNull();
    }
    expect(buildingDesignHeatLossZones([{ temperature: 22, transmission: 0, ventilation: 0 }], 1)).toBeNull();
    expect(buildingDesignHeatLossZones([{ temperature: 22, transmission: Number.MAX_VALUE, ventilation: Number.MAX_VALUE }], 1)).toBeNull();
    expect(buildingDesignHeatLossZones([], 0)).toBeNull();
    const huge = structuredClone(planningData);
    huge.building.heat_load_w = Number.MAX_VALUE;
    // Avoid an irrelevant supply inversion in this numerical accumulation stress case.
    huge.zones.forEach((zone) => zone.load = 0);
    const extremeHours = Array.from({ length: 1100 }, (_, index) => ({ ...weather(planningData.building.design_outdoor_temperature_c)[0],
      time: new Date(Date.UTC(2026, 0, 1, index)).toISOString() }));
    const extreme = simulateHeatingDay(huge, extremeHours, temperatures());
    expect(extreme.hours[0].heatDemandW).toBeGreaterThan(0);
    expect(extreme.heatEnergyKWh).toBeNull();
  });

  it("keeps known zero building energy valid independently from positive conservative room demand", () => {
    const data = structuredClone(planningData);
    data.building.heat_load_w = 0;
    const result = simulateHeatingDay(data, weather(6.9).slice(0, 1), temperatures());
    expect(result.hours[0].heatDemandW).toBe(0);
    expect(result.hours[0].roomHeatDemandW).toBeGreaterThan(0);
    expect(result.heatEnergyKWh).toBe(0);
    expect(estimateGasUse(result.heatEnergyKWh, 10)).toEqual({ gasEnergyKWh: 0, costEuro: 0 });
    expect(estimateHeatPumpDay(result).electricityKWh).toBe(0);
    expect(buildingDesignHeatLossZones([{ temperature: 22, transmission: 0, ventilation: 0 }], 0)).toEqual([{ temperature: 22, load: 0 }]);
    const rooms = temperatures(); rooms[8] = 6.9;
    const sunny = [{ ...weather(6.9, 500)[0], facadeIrradiance: { N: 500, E: 500, S: 500, W: 500 } }];
    const solarCovered = simulateHeatingDay(planningData, sunny, rooms);
    expect(solarCovered.hours[0].heatDemandW).toBe(0);
    expect(solarCovered.hours[0].roomHeatDemandW).toBeGreaterThan(0);
    expect(estimateHeatPumpDay(solarCovered).electricityKWh).toBe(0);
  });

  it("uses building demand for heat-pump electricity while retaining room-based supply requirements", () => {
    const day = simulateHeatingDay(planningData, weather(6.9).slice(0, 2), temperatures());
    const pump = estimateHeatPumpDay(day);
    expect(day.hours[0].zones.every((zone) => zone.heatingPowerW + 1e-6 >= zone.heatDemandW)).toBe(true);
    expect(pump.hours[0].electricityKWh).toBeCloseTo(day.hours[0].heatDemandW! / pump.hours[0].cop! / 1000, 10);
    expect(pump.electricityKWh).toBeCloseTo(day.heatEnergyKWh! / pump.hours[0].cop!, 10);
    expect(pump.electricityKWh).toBeLessThan(day.hours.reduce((sum, hour) => sum + hour.roomHeatDemandW!, 0) / pump.hours[0].cop! / 1000);
  });

  it("converts useful heat to gross gas energy and work-price costs without rounding or replacing gaps", () => {
    expect(estimateGasUse(95, 12.5)).toEqual({ gasEnergyKWh: 100, costEuro: 12.5 });
    expect(estimateGasUse(0, 12.5)).toEqual({ gasEnergyKWh: 0, costEuro: 0 });
    expect(estimateGasUse(95, 0)).toEqual({ gasEnergyKWh: 100, costEuro: 0 });
    expect(estimateGasUse(95, null)).toEqual({ gasEnergyKWh: 100, costEuro: null });
    for (const invalid of [null, NaN, Infinity, -1]) expect(estimateGasUse(invalid, 12.5)).toEqual({ gasEnergyKWh: null, costEuro: null });
    for (const invalid of [NaN, Infinity, -1]) expect(estimateGasUse(95, invalid)).toEqual({ gasEnergyKWh: 100, costEuro: null });
    expect(estimateGasUse(Number.MAX_VALUE, 10)).toEqual({ gasEnergyKWh: null, costEuro: null });
    expect(estimateGasUse(95, Number.MAX_VALUE).costEuro).toBeCloseTo(Number.MAX_VALUE);
    expect(estimateGasUse(950, Number.MAX_VALUE).costEuro).toBeNull();
  });
  it("uses the live heat-loss and solar functions every hour and conserves energy with different room temperatures", () => {
    const inputs = weather(3, 100), rooms = temperatures(); rooms[7] = 24; rooms[6] = 20;
    inputs[12].outdoorTemperatureC = 10;
    const before = JSON.stringify([planningData, inputs, rooms]);
    const result = simulateHeatingDay(planningData, inputs, rooms);
    expect(result.hours).toHaveLength(24);
    expect(result.heatEnergyKWh).toBeCloseTo(result.hours.reduce((sum, hour) => sum + hour.heatDemandW!, 0) / 1000, 10);
    for (const [index, hour] of result.hours.entries()) {
      expect(hour.status).toBe("covered");
      expect(hour.requiredSupplyTemperatureC).toBeGreaterThan(22);
      for (const zone of hour.zones) {
        const source = planningData.zones.find((item) => item.id === zone.id)!;
        const loss = heatLossW(source, rooms[zone.id], inputs[index].outdoorTemperatureC, planningData.building.design_outdoor_temperature_c)!;
        const solar = solarGainsFromFacadesW(source, inputs[index].facadeIrradiance, planningData.solar_assumptions)!;
        expect(zone.heatDemandW).toBeCloseTo(Math.max(0, loss - solar), 8);
        expect(zone.heatingPowerW + 1e-6).toBeGreaterThanOrEqual(zone.heatDemandW);
        expect(zone.floorSurfaceTemperatureC).toBeLessThanOrEqual(29 + 1e-8);
      }
      expect(hour.circuits.reduce((sum, circuit) => sum + circuit.heatingPowerW, 0)).toBeCloseTo(hour.zones.reduce((sum, zone) => sum + zone.heatingPowerW, 0), 8);
      for (const circuit of hour.circuits) expect(circuit.heatingPowerW).toBeCloseTo(circuit.flowLPerMin * 60 * 1.163 * (hour.requiredSupplyTemperatureC! - circuit.returnTemperatureC), 8);
    }
    expect(result.hours[12].requiredSupplyTemperatureC).toBeLessThan(result.hours[0].requiredSupplyTemperatureC!);
    expect(JSON.stringify([planningData, inputs, rooms])).toBe(before);
  });

  it("responds to cold and sunlight without compensating night demand with midday surplus", () => {
    const inputs = weather(-9); inputs[12] = { ...inputs[12], globalIrradianceWPerM2: 1000, facadeIrradiance: { N: 1000, E: 1000, S: 1000, W: 1000 } };
    const result = simulateHeatingDay(planningData, inputs, temperatures());
    expect(result.hours[0].requiredSupplyTemperatureC).toBeGreaterThan(result.hours[12].requiredSupplyTemperatureC!);
    expect(result.hours[12].zones.some((zone) => zone.solarSurplusW > 0)).toBe(true);
    expect(result.hours[0].heatDemandW).toBe(result.hours[23].heatDemandW);
    expect(result.hours[0].heatDemandW).toBeGreaterThan(result.hours[12].heatDemandW!);
  });

  it("does not hide an unreachable room behind building capacity or claim 60 °C is sufficient", () => {
    const result = simulateHeatingDay(planningData, weather(-60).slice(0, 1), temperatures()).hours[0];
    expect(result.status).toBe("unreachable");
    expect(result.requiredSupplyTemperatureC).toBeNull();
    expect(result.heatDemandW).toBeGreaterThan(0);
    expect(result.zones.some((zone) => zone.peakDeficitW > 0)).toBe(true);
    expect(result.zones.every((zone) => zone.floorSurfaceTemperatureC <= 29 + 1e-8)).toBe(true);
  });

  it("shows heating off independently from missing weather and missing room temperatures", () => {
    const inputs = weather(30), rooms = temperatures();
    const off = simulateHeatingDay(planningData, inputs.slice(0, 1), rooms).hours[0];
    expect(off.status).toBe("off"); expect(off.heatDemandW).toBe(0); expect(off.requiredSupplyTemperatureC).toBeNull();
    expect(off.zones.every((zone) => zone.heatingPowerW === 0)).toBe(true);
    delete inputs[4].facadeIrradiance;
    const result = simulateHeatingDay(planningData, inputs, rooms);
    expect(result.hours[4].status).toBe("missing_weather"); expect(result.hours[4].heatDemandW).toBeNull();
    expect(result.hours[5].heatDemandW).toBe(0); expect(result.heatEnergyKWh).toBeNull();
    delete rooms[7];
    const missing = simulateHeatingDay(planningData, weather().slice(0, 1), rooms);
    expect(missing.missingZoneIds).toEqual([7]); expect(missing.hours[0].status).toBe("missing_temperature");
  });

  it("retains DST hours and rejects broken time sequences and invalid weather numbers", () => {
    for (const count of [23, 25]) {
      const inputs = Array.from({ length: count }, (_, index) => ({ ...weather(30)[0], time: new Date(Date.UTC(2026, 9, 25, index)).toISOString() }));
      expect(simulateHeatingDay(planningData, inputs, temperatures()).hours).toHaveLength(count);
    }
    const inputs = weather(); inputs[1].time = inputs[0].time;
    expect(simulateHeatingDay(planningData, inputs, temperatures()).hours.every((hour) => hour.status === "missing_weather")).toBe(true);
    for (const value of [NaN, Infinity, -1]) {
      const inputs = weather().slice(0, 1); inputs[0].globalIrradianceWPerM2 = value;
      expect(simulateHeatingDay(planningData, inputs, temperatures()).hours[0].status).toBe("missing_weather");
    }
  });
  it("finds the minimum rounded supply that still covers every room using the original emission model", () => {
    const hour = simulateHeatingDay(planningData, weather(-9).slice(0, 1), temperatures()).hours[0];
    const parameters = { ...defaultSimulationParameters(planningData), cloudyDiffuseWPerM2: 0 };
    const scenario = { ...defaultSimulationScenario(planningData), weather: "cloudy" as const, outdoorTemperatureC: -9 };
    const at = simulateBuilding(planningData, { ...scenario, supplyTemperatureC: hour.requiredSupplyTemperatureC! }, parameters, { latitudeDeg: 45 });
    const below = simulateBuilding(planningData, { ...scenario, supplyTemperatureC: hour.requiredSupplyTemperatureC! - 0.1 }, parameters, { latitudeDeg: 45 });
    expect(at.zones.every((zone) => zone.peakDeficitW < 1e-6)).toBe(true);
    expect(below.zones.some((zone) => zone.peakDeficitW > 0.01)).toBe(true);
    const rooms = temperatures(); rooms[7] = 28;
    const limited = simulateHeatingDay(planningData, weather().slice(0, 1), rooms).hours[0];
    expect(limited.status).toBe("unreachable");
    expect(limited.zones.reduce((sum, zone) => sum + zone.balanceW, 0)).toBeGreaterThan(0);
    expect(limited.zones.find((zone) => zone.id === 7)!.peakDeficitW).toBeGreaterThan(0);
  });

});
