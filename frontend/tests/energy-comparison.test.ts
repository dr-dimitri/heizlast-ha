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
      { start: "2026-01-01T12:00:00.000Z", end: "2026-01-01T12:30:00.000Z", priceCtPerKWh: 30, lowTariff: false },
      { start: "2026-01-01T12:30:00.000Z", end: "2026-01-01T13:00:00.000Z", priceCtPerKWh: 10, lowTariff: true },
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

describe("einmaliger morgendlicher NT-Speicher", () => {
  const clock = (value: number) => `2026-01-01T${String(value).padStart(2, "0")}:00:00Z`;
  const hoursFor = (values: Array<number | null>) => values.map((value, index) => hour(clock(index), value));
  const contextFor = (hours: ReturnType<typeof hoursFor>, windows = [{ start: "22:00", end: "06:00", price_eur_kwh: .1 }]) => {
    const source = tou(windows);
    return { timezone: "UTC", tariffContext: tariffIntervalsForHours([{ time: "2025-12-31T23:00:00Z" }, ...hours], source, "UTC") };
  };
  const pvFor = (start = "2026-01-01T09:00:00Z", end = "2026-01-01T12:00:00Z") => [
    pv(clock(0), start, 0), pv(start, end, 1),
  ];
  it("entnimmt chronologisch höchstens 6 kWh zu 18 Cent und bezieht den Rest normal", () => {
    const hours = hoursFor([0, 0, 0, 0, 0, 0, 3, 4, 2, 0, 0, 0]);
    const context = contextFor(hours);
    const result = compareHeatingElectricity(hours, context.tariffContext, pvFor(), 8, context);
    expect(result.storageElectricityKWh).toBe(6);
    expect(result.storageCostEuro).toBeCloseTo(1.08);
    expect(result.gridElectricityKWh).toBe(3);
    expect(result.gridCostEuro).toBeCloseTo(.9);
    expect(result.totalCostEuro).toBeCloseTo(1.98);
    expect(result.gridOnlyCostEuro).toBeCloseTo(2.7);
    expect(result.hours.slice(6, 9).map((value) => value.storageElectricityKWh)).toEqual([3, 3, 0]);
    expect(result.hours.slice(6, 9).map((value) => value.gridElectricityKWh)).toEqual([0, 1, 2]);
    expect(result.electricityKWh).toBe(result.storageElectricityKWh! + result.gridElectricityKWh! + result.pvElectricityKWh!);
  });
  it("berechnet eine volle Ladung und Nullbedarf ohne Mindestverbrauch", () => {
    const hours = hoursFor([0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0]);
    const context = contextFor(hours);
    expect(compareHeatingElectricity(hours, context.tariffContext, pvFor(), 8, context).totalCostEuro).toBeCloseTo(1.08);
    const zero = compareHeatingElectricity(hours.map((value) => ({ ...value, electricityKWh: 0 })), [], null, null, context);
    expect(zero.storageElectricityKWh).toBe(0); expect(zero.storageCostEuro).toBe(0); expect(zero.totalCostEuro).toBe(0);
  });
  it("teilt NT-Ende und ersten positiven PV-Beginn auch innerhalb einer Stunde", () => {
    const hours = hoursFor([0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0]);
    const context = contextFor(hours, [{ start: "22:00", end: "06:30", price_eur_kwh: .1 }]);
    const result = compareHeatingElectricity(hours, context.tariffContext, pvFor("2026-01-01T08:15:00Z"), 8, context);
    expect(result.storageElectricityKWh).toBeCloseTo(3.5);
    expect(result.hours[6].storageElectricityKWh).toBe(1);
    expect(result.hours[8].storageElectricityKWh).toBe(.5);
    expect(result.hours[8].gridElectricityKWh).toBeCloseTo(1.3);
    expect(result.gridOnlyCostEuro).toBeCloseTo(1.6);
  });
  it("verwendet nur das letzte morgendliche NT-Ende und füllt am Abend nicht auf", () => {
    const hours = hoursFor(Array.from({ length: 24 }, (_, index) => [2, 6, 7, 10, 18, 21].includes(index) ? 2 : 0));
    const context = contextFor(hours, [{ start: "23:00", end: "02:00", price_eur_kwh: .1 },
      { start: "04:00", end: "06:00", price_eur_kwh: .1 }, { start: "19:00", end: "20:00", price_eur_kwh: .1 }]);
    const generation = [pv(clock(0), clock(9), 0), pv(clock(9), clock(11), 1), pv(clock(11), "2026-01-02T00:00:00Z", 0)];
    const result = compareHeatingElectricity(hours, context.tariffContext, generation, 8, context);
    expect(result.storageElectricityKWh).toBe(4);
    expect(result.hours[2].storageElectricityKWh).toBe(0);
    expect(result.hours[10].storageElectricityKWh).toBe(0);
    expect(result.hours[18].storageElectricityKWh).toBe(0);
    expect(result.hours[21].storageElectricityKWh).toBe(0);
    expect(result.hours[21].gridElectricityKWh).toBe(2);
  });
  it("erkennt das NT-Ende um Mitternacht mit dem vorherigen Tarifintervall", () => {
    const hours = hoursFor([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const context = contextFor(hours, [{ start: "22:00", end: "00:00", price_eur_kwh: .1 }]);
    expect(compareHeatingElectricity(hours, context.tariffContext, pvFor(), 8, context).storageElectricityKWh).toBe(4);
    const missingPrevious = { ...context, tariffContext: context.tariffContext.slice(1) };
    expect(compareHeatingElectricity(hours, context.tariffContext, pvFor(), 8, missingPrevious).storageElectricityKWh).toBeNull();
  });
  it("erfindet keine NT-Fenster aus festen oder dynamischen günstigen Preisen", () => {
    const hours = hoursFor([2, 2, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0]);
    for (const source of [state("10", { tariff_type: "fixed" }), state("10", { tariff_type: "dynamic" })]) {
      const slots = [{ start: clock(0), end: clock(12), price_ct_kwh: 10 }];
      const prices = tariffIntervalsForHours(hours, source, "UTC", slots);
      const result = compareHeatingElectricity(hours, prices, pvFor(), 8, { timezone: "UTC", tariffContext: prices });
      expect(result.storageElectricityKWh).toBe(0); expect(result.gridOnlyCostEuro).toBeCloseTo(1);
    }
  });
  it("rechnet ohne positiven PV-Beginn und ohne nutzbares Morgenfenster keinen Speicher an", () => {
    const hours = hoursFor(Array(12).fill(1)); const context = contextFor(hours);
    const noPv = compareHeatingElectricity(hours, context.tariffContext, [pv(clock(0), clock(12), 0)], 8, context);
    expect(noPv.storageElectricityKWh).toBe(0); expect(noPv.totalCostEuro).toBeCloseTo(noPv.gridOnlyCostEuro!);
    const earlyPv = compareHeatingElectricity(hours, context.tariffContext, [pv(clock(0), clock(12), 1)], 8, context);
    expect(earlyPv.storageElectricityKWh).toBe(0);
  });
  it("hält unvollständige oder überlappende PV- und Tarifdaten unbekannt", () => {
    const hours = hoursFor(Array(12).fill(1)); const context = contextFor(hours);
    for (const generation of [null, pvFor().slice(1), [...pvFor(), pv(clock(0), clock(1), 0)],
      [pv(clock(0), clock(9), null), pv(clock(9), clock(12), 1)]]) {
      const result = compareHeatingElectricity(hours, context.tariffContext, generation, 8, context);
      expect(result.storageElectricityKWh).toBeNull(); expect(result.totalCostEuro).toBeNull();
      expect(result.gridOnlyCostEuro).not.toBeNull();
    }
    for (const tariffContext of [[], context.tariffContext.slice(0, -1), [...context.tariffContext, context.tariffContext[0]]]) {
      const result = compareHeatingElectricity(hours, context.tariffContext, pvFor(), 8, { ...context, tariffContext });
      expect(result.storageElectricityKWh).toBeNull(); expect(result.storageCostEuro).toBeNull(); expect(result.totalCostEuro).toBeNull();
    }
  });
  it("hält vollständige PV-Deckung auch bei unbekanntem Tarif und Speicher berechenbar", () => {
    const result = compareHeatingElectricity([hour()], [], [pv(undefined, undefined, 3)], 8, { tariffContext: [], timezone: "UTC" });
    expect(result.storageElectricityKWh).toBe(0); expect(result.gridElectricityKWh).toBe(0);
    expect(result.storageCostEuro).toBe(0); expect(result.totalCostEuro).toBeCloseTo(.16);
    expect(result.gridOnlyCostEuro).toBeNull();
  });
  it("setzt nach unbekanntem Morgenbedarf keine neue volle Speicherladung voraus", () => {
    const hours = hoursFor([0, 0, 0, 0, 0, 0, null, 2, 2, 0, 0, 0]); const context = contextFor(hours);
    const result = compareHeatingElectricity(hours, context.tariffContext, pvFor(), 8, context);
    expect(result.storageElectricityKWh).toBeNull(); expect(result.totalCostEuro).toBeNull();
    expect(result.hours[7].storageElectricityKWh).toBeNull(); expect(result.hours[8].totalCostEuro).toBeNull();
    expect(result.hours[9].storageElectricityKWh).toBe(0);
    const prices = context.tariffContext.filter((value) => value.start !== "2026-01-01T06:00:00.000Z");
    const missingTariff = compareHeatingElectricity(hours.map((value) => ({ ...value, electricityKWh: 2 })), prices, pvFor(), 8, context);
    expect(missingTariff.hours[7].storageElectricityKWh).toBeNull();
  });
  it("verwendet absolute Zeitgrenzen bei beiden Zeitumstellungen", () => {
    for (const [start, count] of [["2026-03-28T23:00:00Z", 23], ["2026-10-24T22:00:00Z", 25]] as const) {
      const beginning = Date.parse(start);
      const hours = Array.from({ length: count }, (_, index) => hour(new Date(beginning + index * 3600000).toISOString(), 1));
      const source = tou([{ start: "22:00", end: "06:00", price_eur_kwh: .1 }]);
      const tariffContext = tariffIntervalsForHours([{ time: new Date(beginning - 3600000).toISOString() }, ...hours], source, "Europe/Berlin");
      const pvStart = new Date(beginning + (count === 23 ? 8 : 10) * 3600000).toISOString();
      const generation = [pv(start, pvStart, 0), pv(pvStart, new Date(beginning + count * 3600000).toISOString(), 1)];
      const result = compareHeatingElectricity(hours, tariffContext, generation, 8, { tariffContext, timezone: "Europe/Berlin" });
      expect(result.storageElectricityKWh).toBe(3);
      expect(result.storageCostEuro).toBeCloseTo(.54);
    }
  });
  it("ändert weder Prognosen noch Tarifkontext und wird ohne Option nicht aktiv", () => {
    const hours = hoursFor(Array(12).fill(1)); const context = contextFor(hours); const generation = pvFor();
    const before = JSON.stringify([hours, context, generation]);
    compareHeatingElectricity(hours, context.tariffContext, generation, 8, context);
    expect(JSON.stringify([hours, context, generation])).toBe(before);
    const legacy = compareHeatingElectricity(hours, context.tariffContext, generation, 8);
    expect(legacy.storageElectricityKWh).toBe(0); expect(legacy.storageCostEuro).toBe(0);
  });
});
