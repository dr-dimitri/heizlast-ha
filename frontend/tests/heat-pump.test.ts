// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BOSCH_AW5800_5KW, estimateHeatPumpDay, estimateHeatPumpHour, heatPumpOperatingPoint } from "../src/heat-pump";
import type { HeatingHour } from "../src/simulation-core";

function hour(overrides: Partial<HeatingHour> = {}): HeatingHour {
  return { time: "2026-01-01T00:00:00Z", status: "covered", outdoorTemperatureC: 2, globalIrradianceWPerM2: 0,
    heatDemandW: 3000, requiredSupplyTemperatureC: 35, zones: [], circuits: [], ...overrides };
}

describe("Bosch Compress 5800i AW 5 OR-S stationary model", () => {
  it("matches the manufacturer table without confusing model class, nominal COP and maximum heat output", () => {
    expect(BOSCH_AW5800_5KW.maxSupplyTemperatureC).toBe(60);
    for (const [outside, power, cop] of [[-7, 5420, 2.51], [2, 6430, 2.91], [7, 6800, 3.16]]) {
      expect(heatPumpOperatingPoint(outside, 35)).toEqual({ maxThermalPowerW: power, cop });
    }
    const w55 = heatPumpOperatingPoint(7, 55)!;
    expect(w55.cop).toBeCloseTo(2.28); expect(w55.maxThermalPowerW).toBeCloseTo(6180);
    expect(estimateHeatPumpHour(hour({ outdoorTemperatureC: -7, heatDemandW: 2510 })).electricityKWh).toBeCloseTo(1);
  });

  it("interpolates weather and changes electrical use and capacity with required supply temperature", () => {
    const middle = heatPumpOperatingPoint(-2.5, 35)!;
    expect(middle.cop).toBeCloseTo((2.51 + 2.91) / 2);
    expect(middle.maxThermalPowerW).toBeCloseTo((5420 + 6430) / 2);
    const cool = estimateHeatPumpHour(hour({ requiredSupplyTemperatureC: 30 }));
    const warm = estimateHeatPumpHour(hour({ requiredSupplyTemperatureC: 50 }));
    expect(warm.electricityKWh).toBeGreaterThan(cool.electricityKWh!);
    expect(warm.maxThermalPowerW).toBeLessThan(cool.maxThermalPowerW!);
    expect(heatPumpOperatingPoint(20, 35)).toEqual(heatPumpOperatingPoint(7, 35));
  });

  it("does not price an uncovered heat demand as cheaper partial heating", () => {
    const limited = estimateHeatPumpHour(hour({ outdoorTemperatureC: -7, heatDemandW: 6000 }));
    expect(limited.status).toBe("capacity_limited"); expect(limited.deficitW).toBeCloseTo(580);
    expect(limited.electricityKWh).toBeNull(); expect(limited.maxThermalPowerW).toBe(5420);
    const unreachable = estimateHeatPumpHour(hour({ status: "unreachable", requiredSupplyTemperatureC: null }));
    expect(unreachable.status).toBe("unreachable"); expect(unreachable.electricityKWh).toBeNull();
    for (const [outdoorTemperatureC, requiredSupplyTemperatureC] of [[-8, 35], [46, 35], [2, 61], [2, 19]]) {
      expect(estimateHeatPumpHour(hour({ outdoorTemperatureC, requiredSupplyTemperatureC })).status).toBe("outside_model");
    }
  });

  it("preserves unknown temperatures and weather while keeping known heating-off energy at zero", () => {
    for (const heatDemandW of [null, -1, NaN, Infinity]) expect(estimateHeatPumpHour(hour({ heatDemandW })).electricityKWh).toBeNull();
    for (const outdoorTemperatureC of [null, NaN, Infinity]) expect(estimateHeatPumpHour(hour({ outdoorTemperatureC })).electricityKWh).toBeNull();
    for (const status of ["missing_temperature", "missing_weather", "invalid_model"] as const) expect(estimateHeatPumpHour(hour({ status })).electricityKWh).toBeNull();
    expect(estimateHeatPumpHour(hour({ status: "off", heatDemandW: 0, requiredSupplyTemperatureC: null }))).toMatchObject({ status: "off", electricityKWh: 0, cop: null });
  });

  it("sums elapsed hours without rounding, supports DST and remains immutable", () => {
    for (const count of [23, 24, 25]) {
      const hours = Array.from({ length: count }, (_, index) => hour({ time: new Date(Date.UTC(2026, 9, 25, index)).toISOString() }));
      const before = JSON.stringify(hours), day = estimateHeatPumpDay({ hours });
      expect(day.electricityKWh).toBeCloseTo(count * 3 / 2.91, 10);
      expect(day.incompleteHours).toBe(0); expect(JSON.stringify(hours)).toBe(before);
      hours[2] = { ...hours[2], heatDemandW: null, status: "missing_weather" };
      expect(estimateHeatPumpDay({ hours }).electricityKWh).toBeNull();
      expect(estimateHeatPumpDay({ hours }).incompleteHours).toBe(1);
    }
    expect(estimateHeatPumpDay({ hours: [] }).electricityKWh).toBeNull();
    expect(estimateHeatPumpDay({ hours: [hour(), hour()] }).electricityKWh).toBeNull();
  });
});
