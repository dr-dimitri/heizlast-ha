import { describe, expect, it } from "vitest";
import { estimatedHeatLoadW, solarGainsW } from "../src/heat-load";
import type { HassState } from "../src/types";

const zone = { load: 1000, temperature: 20 };
const temperature = (value: string, unit = "°C", deviceClass = "temperature"): HassState => ({
  entity_id: "sensor.temperature",
  state: value,
  attributes: { device_class: deviceClass, unit_of_measurement: unit },
});
const room = () => temperature("20");
const outside = () => temperature("-10");

describe("temperature-based heating-load estimate", () => {
  it("matches the documented heating load at the design temperatures", () => {
    expect(estimatedHeatLoadW(zone, room(), outside(), -10)).toBe(1000);
  });

  it("halves the load at half the temperature difference", () => {
    expect(estimatedHeatLoadW(zone, room(), temperature("5"), -10)).toBe(500);
  });

  it("uses the current room temperature rather than the design indoor temperature", () => {
    expect(estimatedHeatLoadW(zone, temperature("10"), temperature("-5"), -10)).toBe(500);
  });

  it.each(["20", "25"])("returns zero when outside temperature %s reaches or exceeds the room temperature", (value) => {
    expect(estimatedHeatLoadW(zone, room(), temperature(value), -10)).toBe(0);
  });

  it("allows loads above the design load when the temperature difference is greater", () => {
    expect(estimatedHeatLoadW(zone, room(), temperature("-25"), -10)).toBe(1500);
  });

  it.each([
    ["68", "°F", "14", "°F"],
    ["293.15", "K", "263.15", "K"],
    ["68", "°F", "263.15", "K"],
    ["293.15", "K", "-10", "°C"],
  ])("converts room %s %s and outside %s %s to the same temperature scale", (inside, insideUnit, outdoors, outdoorUnit) => {
    expect(estimatedHeatLoadW(zone, temperature(inside, insideUnit), temperature(outdoors, outdoorUnit), -10)).toBeCloseTo(1000, 10);
  });

  it("keeps a valid zero design load at zero", () => {
    expect(estimatedHeatLoadW({ ...zone, load: 0 }, room(), outside(), -10)).toBe(0);
  });

  it("returns no estimate when room, outdoor or design temperature is absent", () => {
    expect(estimatedHeatLoadW(zone, undefined, outside(), -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), undefined, -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), outside())).toBeNull();
  });

  it.each(["unknown", "unavailable", "", " ", "NaN", "Infinity", "-Infinity", "1e999", "0x20", "20 °C", "21,5", "n/a"])("returns no estimate for invalid sensor state %j on either input", (value) => {
    expect(estimatedHeatLoadW(zone, temperature(value), outside(), -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), temperature(value), -10)).toBeNull();
  });

  it.each(["", "C", "%", "W", "°C / h"])("returns no estimate for unsupported or absent temperature unit %j", (unit) => {
    expect(estimatedHeatLoadW(zone, temperature("20", unit), outside(), -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), temperature("-10", unit), -10)).toBeNull();
  });

  it("returns no estimate for changed or missing temperature device classes", () => {
    expect(estimatedHeatLoadW(zone, temperature("20", "°C", "humidity"), outside(), -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), temperature("-10", "°C", "humidity"), -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, { ...room(), attributes: { unit_of_measurement: "°C" } }, outside(), -10)).toBeNull();
  });

  it("rejects physically impossible live temperatures on either input", () => {
    expect(estimatedHeatLoadW(zone, temperature("-274"), outside(), -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), temperature("-1", "K"), -10)).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity])("returns no estimate for nonfinite planning input %s", (invalid) => {
    expect(estimatedHeatLoadW({ ...zone, load: invalid }, room(), outside(), -10)).toBeNull();
    expect(estimatedHeatLoadW({ ...zone, temperature: invalid }, room(), outside(), -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), outside(), invalid)).toBeNull();
  });

  it("rejects a negative design load and a zero or negative design temperature difference", () => {
    expect(estimatedHeatLoadW({ ...zone, load: -1 }, room(), outside(), -10)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), outside(), 20)).toBeNull();
    expect(estimatedHeatLoadW(zone, room(), outside(), 25)).toBeNull();
  });

  it("returns no estimate if finite inputs overflow the calculated result", () => {
    expect(estimatedHeatLoadW({ ...zone, load: Number.MAX_VALUE }, temperature("1e308"), outside(), -10)).toBeNull();
  });
});

const solarFactors = { glazing_fraction: 0.7, g_value: 0.5, shading_factor: 0.9, sun_protection_factor: 1, incidence_factor: 0.9 };
const solarAssumptions = { ...solarFactors, facade_areas_m2: { N: 1, E: 2, S: 3, W: 4 }, window_tilt_deg: 90 };
const solarZone = { solar_windows: [
  { orientation: "N" as const, area_m2: 1 },
  { orientation: "E" as const, area_m2: 2 },
  { orientation: "S" as const, area_m2: 3 },
  { orientation: "W" as const, area_m2: 4 },
] };
const facadeRadiation = (): HassState => ({
  entity_id: "sensor.sunlight",
  state: "500",
  attributes: {
    device_class: "irradiance", unit_of_measurement: "W/m²", heizlast_ha_role: "solar_radiation",
    facade_north_w_m2: 100, facade_east_w_m2: 200, facade_south_w_m2: 300, facade_west_w_m2: 400,
  },
});

describe("solar-gain estimate with documented facade windows and EnEV assumptions", () => {
  it("weights each window area by its actual N/E/S/W facade irradiance", () => {
    // 1 × 100 + 2 × 200 + 3 × 300 + 4 × 400 = 3000 W before the 0.2835 factor.
    expect(solarGainsW(solarZone, facadeRadiation(), solarAssumptions)).toBeCloseTo(850.5, 10);
    const northOnly = { solar_windows: [{ orientation: "N" as const, area_m2: 1 }] };
    const westOnly = { solar_windows: [{ orientation: "W" as const, area_m2: 4 }] };
    expect(solarGainsW(northOnly, facadeRadiation(), solarAssumptions)).toBeCloseTo(28.35, 10);
    expect(solarGainsW(westOnly, facadeRadiation(), solarAssumptions)).toBeCloseTo(453.6, 10);
  });

  it("adds multiple windows on the same facade without dividing or deduplicating their areas", () => {
    expect(solarGainsW({ solar_windows: [{ orientation: "N", area_m2: 1 }, { orientation: "N", area_m2: 2 }] }, facadeRadiation(), solarAssumptions)).toBeCloseTo(85.05, 10);
  });

  it("returns zero for no windows, zero-area windows or actual zero facade irradiance", () => {
    expect(solarGainsW({ solar_windows: [] }, facadeRadiation(), solarAssumptions)).toBe(0);
    expect(solarGainsW({ solar_windows: [] }, undefined, solarAssumptions)).toBe(0);
    expect(solarGainsW({ solar_windows: [{ orientation: "N", area_m2: 0 }] }, facadeRadiation(), solarAssumptions)).toBe(0);
    const darkness = facadeRadiation(); darkness.state = "0";
    darkness.attributes.facade_north_w_m2 = 0; darkness.attributes.facade_east_w_m2 = 0;
    darkness.attributes.facade_south_w_m2 = 0; darkness.attributes.facade_west_w_m2 = 0;
    expect(solarGainsW(solarZone, darkness, solarAssumptions)).toBe(0);
  });

  it("keeps missing weather inputs or assumptions unknown instead of treating missing solar data as zero", () => {
    expect(solarGainsW(solarZone, undefined, solarAssumptions)).toBeNull();
    expect(solarGainsW(solarZone, facadeRadiation())).toBeNull();
    expect(solarGainsW({ solar_windows: [] }, facadeRadiation())).toBeNull();
    const rawOnly = facadeRadiation();
    rawOnly.attributes = { device_class: "irradiance", unit_of_measurement: "W/m²", heizlast_ha_role: "solar_radiation" };
    expect(solarGainsW(solarZone, rawOnly, solarAssumptions)).toBeNull();
  });

  it("rejects partial facade inputs while preserving available raw GHI as a separate measurement", () => {
    const partial = facadeRadiation(); delete partial.attributes.facade_south_w_m2;
    expect(partial.state).toBe("500");
    expect(solarGainsW(solarZone, partial, solarAssumptions)).toBeNull();
  });

  it("needs irradiance for the room's window facades and keeps absent required facade values unknown", () => {
    const north = { solar_windows: [{ orientation: "N" as const, area_m2: 1 }] };
    const partial = facadeRadiation(); delete partial.attributes.facade_south_w_m2;
    expect(solarGainsW(north, partial, solarAssumptions)).toBeCloseTo(28.35, 10);
    delete partial.attributes.facade_north_w_m2;
    expect(solarGainsW(north, partial, solarAssumptions)).toBeNull();
  });

  it.each(["unknown", "unavailable", "", " ", "NaN", "Infinity", "-1", "0x20", "500 W/m²"])("rejects invalid raw irradiance %j despite numeric facade attributes", (value) => {
    expect(solarGainsW(solarZone, { ...facadeRadiation(), state: value }, solarAssumptions)).toBeNull();
  });

  it("rejects missing or incorrect irradiance units and device classes", () => {
    for (const unit of ["", "W/m2", "W", "°C"]) {
      const value = facadeRadiation(); value.attributes.unit_of_measurement = unit;
      expect(solarGainsW(solarZone, value, solarAssumptions)).toBeNull();
    }
    const changed = facadeRadiation(); changed.attributes.device_class = "temperature";
    expect(solarGainsW(solarZone, changed, solarAssumptions)).toBeNull();
    delete changed.attributes.device_class;
    expect(solarGainsW(solarZone, changed, solarAssumptions)).toBeNull();
  });

  it.each([-1, NaN, Infinity, -Infinity])("rejects invalid facade irradiance %s rather than silently removing that facade", (invalid) => {
    const value = facadeRadiation(); value.attributes.facade_east_w_m2 = invalid;
    expect(solarGainsW(solarZone, value, solarAssumptions)).toBeNull();
  });

  it.each([-1, NaN, Infinity, -Infinity])("rejects invalid window area %s", (invalid) => {
    expect(solarGainsW({ solar_windows: [{ orientation: "N", area_m2: invalid }] }, facadeRadiation(), solarAssumptions)).toBeNull();
  });

  it("validates every solar factor independently within the inclusive range 0 to 1", () => {
    for (const name of Object.keys(solarFactors) as Array<keyof typeof solarFactors>) {
      for (const invalid of [-0.1, 1.1, NaN, Infinity, -Infinity]) {
        expect(solarGainsW(solarZone, facadeRadiation(), { ...solarAssumptions, [name]: invalid })).toBeNull();
      }
      expect(solarGainsW(solarZone, facadeRadiation(), { ...solarAssumptions, [name]: 0 })).toBe(0);
      expect(solarGainsW(solarZone, facadeRadiation(), { ...solarAssumptions, [name]: 1 })).not.toBeNull();
    }
  });

  it("returns no gain if finite window inputs overflow the result", () => {
    const value = facadeRadiation(); value.attributes.facade_north_w_m2 = Number.MAX_VALUE;
    expect(solarGainsW({ solar_windows: [{ orientation: "N", area_m2: Number.MAX_VALUE }] }, value, solarAssumptions)).toBeNull();
  });
});
