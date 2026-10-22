// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareHeatingElectricity, priceCtPerKWh, tariffIntervalsForHours, type PriceInterval, type PvEnergyInterval } from "../src/energy-comparison";
import type { HassState } from "../src/types";

const state = (value: string, attributes: Record<string, unknown> = {}): HassState => ({ entity_id: "sensor.energy_price", state: value,
  attributes: { unit_of_measurement: "ct/kWh", ...attributes } });
const hour = (time = "2026-01-01T12:00:00Z", electricityKWh: number | null = 2) => ({ time, electricityKWh });
const price = (start = hour().time, end = "2026-01-01T13:00:00Z", priceCtPerKWh = 30): PriceInterval => ({ start, end, priceCtPerKWh });
const pv = (start = hour().time, end = "2026-01-01T13:00:00Z", energy_kwh: number | null = 1): PvEnergyInterval => ({ start, end, energy_kwh });
const tou = (windows: unknown[], base = 0.3) => state("30", { tariff_type: "time_of_use", unavailable_reason: null, base_price_eur_kwh: base, windows });

describe("SAX-Tarifsensoren", () => {
  it("normalisiert Cent und Euro und bewahrt negative sowie Nullpreise", () => {
    expect(priceCtPerKWh(state("0"))).toBe(0);
    expect(priceCtPerKWh(state("-10"))).toBe(-10);
    expect(priceCtPerKWh(state("0.32", { unit_of_measurement: "EUR/kWh" }))).toBe(32);
    expect(priceCtPerKWh(state("0.32", { unit_of_measurement: "€/kWh" }))).toBe(32);
    for (const invalid of ["unavailable", "unknown", "", "NaN", "Infinity", "0x10"])
      expect(priceCtPerKWh(state(invalid))).toBeNull();
    expect(priceCtPerKWh(state("32", { unit_of_measurement: "EUR" }))).toBeNull();
  });
  it("verwendet den Festpreis und trägt einen dynamischen aktuellen Preis niemals fort", () => {
    expect(tariffIntervalsForHours([hour()], state("32", { tariff_type: "fixed" }), "Europe/Berlin"))
      .toEqual([{ ...price(), end: "2026-01-01T13:00:00.000Z", priceCtPerKWh: 32 }]);
    const dynamic = state("10", { tariff_type: "dynamic" });
    expect(tariffIntervalsForHours([hour()], dynamic, "Europe/Berlin")).toEqual([]);
    expect(tariffIntervalsForHours([hour()], dynamic, "Europe/Berlin", [{ start: hour().time, end: price().end, price_ct_kwh: -5 }]))
      .toEqual([price(undefined, undefined, -5)]);
    expect(tariffIntervalsForHours([hour()], state("unavailable", { tariff_type: "fixed" }), "Europe/Berlin")).toEqual([]);
    expect(tariffIntervalsForHours([hour()], state("10", { tariff_type: "disabled" }), "Europe/Berlin")).toEqual([]);
  });
  it("teilt einen lokalen Tarifwechsel innerhalb der Stunde und Fenster über Mitternacht", () => {
    const source = tou([{ start: "13:30:00", end: "14:00:00", price_eur_kwh: 0.1 }, { start: "22:00:00", end: "06:00:00", price_eur_kwh: 0.2 }]);
    const result = tariffIntervalsForHours([hour()], source, "Europe/Berlin");
    expect(result).toEqual([
      { start: "2026-01-01T12:00:00.000Z", end: "2026-01-01T12:30:00.000Z", priceCtPerKWh: 30 },
      { start: "2026-01-01T12:30:00.000Z", end: "2026-01-01T13:00:00.000Z", priceCtPerKWh: 10 },
    ]);
    for (const time of ["2026-01-01T22:00:00Z", "2026-01-01T03:00:00Z"])
      expect(tariffIntervalsForHours([hour(time)], source, "Europe/Berlin")[0].priceCtPerKWh).toBe(20);
  });
  it("hält beide 02-Uhr-Stunden bei der Zeitumstellung getrennt", () => {
    const hours = [hour("2026-10-25T00:00:00Z"), hour("2026-10-25T01:00:00Z")];
    const prices = tariffIntervalsForHours(hours, tou([{ start: "02:30:00", end: "03:00:00", price_eur_kwh: 0.1 }]), "Europe/Berlin");
    expect(prices.map((value) => value.priceCtPerKWh)).toEqual([30, 10, 30, 10]);
    expect(prices.map((value) => value.start)).toEqual([
      "2026-10-25T00:00:00.000Z", "2026-10-25T00:30:00.000Z", "2026-10-25T01:00:00.000Z", "2026-10-25T01:30:00.000Z",
    ]);
    expect(compareHeatingElectricity(hours, prices, null, null).gridOnlyCostEuro).toBeCloseTo(0.8);
  });
  it("beachtet übersprungene Wanduhrzeiten und gebrochene UTC-Offsets", () => {
    const skipped = tariffIntervalsForHours([hour("2026-03-29T00:30:00Z")], tou([{ start: "02:30:00", end: "03:30:00", price_eur_kwh: 0.1 }]), "Europe/Berlin");
    expect(skipped.map((value) => value.priceCtPerKWh)).toEqual([30, 10]);
    expect(skipped[0].end).toBe("2026-03-29T01:00:00.000Z");
    const quarter = tariffIntervalsForHours([hour("2026-01-01T00:00:00Z")], tou([{ start: "06:00:00", end: "07:00:00", price_eur_kwh: 0.1 }]), "Asia/Kathmandu");
    expect(quarter.map((value) => value.priceCtPerKWh)).toEqual([30, 10]);
    expect(quarter[0].end).toBe("2026-01-01T00:15:00.000Z");
  });
  it("summiert genau die tatsächlichen 23 oder 25 Stunden eines lokalen Tages", () => {
    for (const [start, count] of [["2026-03-28T23:00:00Z", 23], ["2026-10-24T22:00:00Z", 25]] as const) {
      const hours = Array.from({ length: count }, (_, index) => hour(new Date(Date.parse(start) + index * 3600000).toISOString(), 1));
      const prices = tariffIntervalsForHours(hours, tou([{ start: "22:00:00", end: "06:00:00", price_eur_kwh: 0.1 }]), "Europe/Berlin");
      const result = compareHeatingElectricity(hours, prices, null, null);
      expect(result.electricityKWh).toBe(count);
      expect(result.gridOnlyCostEuro).toBeCloseTo(count === 23 ? 16 * 0.3 + 7 * 0.1 : 16 * 0.3 + 9 * 0.1);
    }
  });
  it("lehnt ungültige, überlappende und unvollständige Tarifpläne ab", () => {
    for (const windows of [
      [{ start: "22:00", end: "06:00", price_eur_kwh: 0.2 }, { start: "05:00", end: "07:00", price_eur_kwh: 0.1 }],
      [{ start: "22:00", end: "22:00", price_eur_kwh: 0.2 }],
      [{ start: "25:00", end: "06:00", price_eur_kwh: 0.2 }],
      [{ start: "22:00", end: "06:00", price_eur_kwh: NaN }],
    ]) expect(tariffIntervalsForHours([hour()], tou(windows), "Europe/Berlin")).toEqual([]);
    expect(tariffIntervalsForHours([hour()], tou([]), "invalid-zone")).toEqual([]);
    expect(tariffIntervalsForHours([hour()], state("30", { ...tou([]).attributes, unavailable_reason: "tariff_incomplete" }), "Europe/Berlin")).toEqual([]);
  });
});

describe("Stromkosten mit zeitgleicher PV-Erzeugung", () => {
  it("bilanziert Netzbezug und entgangene Einspeisung getrennt", () => {
    const result = compareHeatingElectricity([hour()], [price()], [pv()], 8);
    expect(result.electricityKWh).toBe(2);
    expect(result.pvElectricityKWh).toBe(1);
    expect(result.gridElectricityKWh).toBe(1);
    expect(result.gridOnlyCostEuro).toBeCloseTo(0.6);
    expect(result.gridCostEuro).toBeCloseTo(0.3);
    expect(result.pvOpportunityCostEuro).toBeCloseTo(0.08);
    expect(result.totalCostEuro).toBeCloseTo(0.38);
  });
  it("rechnet PV am richtigen Teilintervall statt mit einem Tages- oder Stundenmittel", () => {
    const prices = [price(undefined, "2026-01-01T12:30:00Z", 50), price("2026-01-01T12:30:00Z", undefined, 10)];
    const generation = [pv(undefined, "2026-01-01T12:30:00Z", 1), pv("2026-01-01T12:30:00Z", undefined, 0)];
    const result = compareHeatingElectricity([hour()], prices, generation, 8);
    expect(result.gridOnlyCostEuro).toBeCloseTo(0.6);
    expect(result.gridCostEuro).toBeCloseTo(0.1);
    expect(result.totalCostEuro).toBeCloseTo(0.18);
    expect(result.pvElectricityKWh).toBe(1);
    const surplus = compareHeatingElectricity([hour()], [price()], [pv(undefined, undefined, 100)], 8);
    expect(surplus.pvElectricityKWh).toBe(2);
    expect(surplus.gridElectricityKWh).toBe(0);
    expect(surplus.totalCostEuro).toBeCloseTo(0.16);
  });
  it("kann PV nicht in eine andere Stunde übertragen", () => {
    const hours = [hour(), hour("2026-01-01T13:00:00Z")];
    const result = compareHeatingElectricity(hours, [price(), price("2026-01-01T13:00:00Z", "2026-01-01T14:00:00Z")],
      [pv(undefined, undefined, 10), pv("2026-01-01T13:00:00Z", "2026-01-01T14:00:00Z", 0)], 8);
    expect(result.gridElectricityKWh).toBe(2);
    expect(result.pvElectricityKWh).toBe(2);
    expect(result.totalCostEuro).toBeCloseTo(0.76);
  });
  it("hält PV-Lücken von den Kosten ohne PV und Preis-Lücken von Energiemengen getrennt", () => {
    const missingPv = compareHeatingElectricity([hour()], [price()], null, 8);
    expect(missingPv.gridOnlyCostEuro).toBeCloseTo(0.6);
    expect(missingPv.totalCostEuro).toBeNull();
    expect(missingPv.pvElectricityKWh).toBeNull();
    const missingPrice = compareHeatingElectricity([hour()], [], [pv()], 8);
    expect(missingPrice.gridOnlyCostEuro).toBeNull();
    expect(missingPrice.gridCostEuro).toBeNull();
    expect(missingPrice.pvElectricityKWh).toBe(1);
    expect(missingPrice.pvOpportunityCostEuro).toBeCloseTo(0.08);
    const missingFeedIn = compareHeatingElectricity([hour()], [price()], [pv()], null);
    expect(missingFeedIn.gridCostEuro).toBeCloseTo(0.3);
    expect(missingFeedIn.pvOpportunityCostEuro).toBeNull();
    expect(missingFeedIn.totalCostEuro).toBeNull();
    expect(compareHeatingElectricity([hour()], [price()], [pv(undefined, undefined, 0)], null).totalCostEuro).toBeCloseTo(0.6);
    for (const invalid of [NaN, Infinity]) expect(compareHeatingElectricity([hour()], [price()], [pv(undefined, undefined, 0)], invalid).totalCostEuro).toBeCloseTo(0.6);
  });
  it("erhält Nullen und negative Preise, aber ersetzt unbekannten Bedarf nicht", () => {
    const zero = compareHeatingElectricity([hour(undefined, 0)], [], null, null);
    for (const key of ["electricityKWh", "gridElectricityKWh", "pvElectricityKWh", "gridOnlyCostEuro", "gridCostEuro", "pvOpportunityCostEuro", "totalCostEuro"] as const)
      expect(zero[key]).toBe(0);
    expect(compareHeatingElectricity([hour()], [price(undefined, undefined, -10)], [pv()], 8).totalCostEuro).toBeCloseTo(-0.02);
    for (const value of [null, -1, NaN, Infinity]) {
      const unknown = compareHeatingElectricity([hour(undefined, value)], [price()], [pv()], 8);
      expect(unknown.electricityKWh).toBeNull(); expect(unknown.totalCostEuro).toBeNull();
    }
  });
  it("weist doppelte, lückenhafte, ungültige und überlappende Intervalle zurück", () => {
    expect(compareHeatingElectricity([hour(), hour()], [price()], [pv()], 8).electricityKWh).toBeNull();
    expect(compareHeatingElectricity([hour(), hour("2026-01-01T14:00:00Z")], [price()], [pv()], 8).electricityKWh).toBeNull();
    expect(compareHeatingElectricity([hour("2026-01-01T12:00:00")], [price()], [pv()], 8).electricityKWh).toBeNull();
    expect(compareHeatingElectricity([hour()], [price(), price()], [pv()], 8).gridOnlyCostEuro).toBeNull();
    expect(compareHeatingElectricity([hour()], [price()], [pv(), pv()], 8).totalCostEuro).toBeNull();
    expect(compareHeatingElectricity([hour()], [price()], [pv(undefined, "2026-01-01T12:30:00Z")], 8).totalCostEuro).toBeNull();
    expect(compareHeatingElectricity([hour()], [price()], [pv(undefined, undefined, -1)], 8).pvElectricityKWh).toBeNull();
    expect(compareHeatingElectricity([], [], null, null).totalCostEuro).toBeNull();
  });
  it("verändert Eingaben nicht und prüft numerischen Überlauf", () => {
    const hours = [hour()], prices = [price()], generation = [pv()];
    const before = JSON.stringify([hours, prices, generation]);
    compareHeatingElectricity(hours, prices, generation, 8);
    expect(JSON.stringify([hours, prices, generation])).toBe(before);
    const huge = compareHeatingElectricity([hour(undefined, Number.MAX_VALUE)], [price(undefined, undefined, Number.MAX_VALUE)], [pv(undefined, undefined, 0)], 8);
    expect(huge.electricityKWh).toBe(Number.MAX_VALUE);
    expect(huge.gridOnlyCostEuro).toBeNull(); expect(huge.totalCostEuro).toBeNull();
    expect(compareHeatingElectricity([hour(undefined, Number.MAX_VALUE)], [price(undefined, undefined, 100)], null, null).gridOnlyCostEuro).toBe(Number.MAX_VALUE);
  });
});
