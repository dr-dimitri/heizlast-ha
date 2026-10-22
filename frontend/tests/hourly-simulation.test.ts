// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planningData } from "../src/planning-types";
import { heatLossW, solarGainsFromFacadesW } from "../src/thermal-model";
import { simulateHeatingDay, simulateBuilding, defaultSimulationParameters, defaultSimulationScenario, type HourlyWeather } from "../src/simulation-core";

const temperatures = () => Object.fromEntries(planningData.zones.map((zone) => [zone.id, 22]));
const weather = (outdoorTemperatureC = 0, solar = 0): HourlyWeather[] => Array.from({ length: 24 }, (_, hour) => ({
  time: new Date(Date.UTC(2026, 0, 1, hour)).toISOString(), outdoorTemperatureC,
  globalIrradianceWPerM2: solar, facadeIrradiance: { N: solar / 4, E: solar / 2, S: solar, W: solar / 2 },
}));

describe("weather-driven hourly heating curve", () => {
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
