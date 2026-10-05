import { describe, expect, it, vi } from "vitest";
import { entityName, formatNumber, measuredTemperatureLabel, outdoorTemperatureLabel, temperatureLabel, temperatureSensors } from "../src/types";
import type { HassState, HomeAssistant } from "../src/types";

const state = (value = "21.456", unit = "°C"): HassState => ({
  entity_id: "sensor.room_temperature",
  state: value,
  attributes: { friendly_name: "Raumtemperatur", device_class: "temperature", unit_of_measurement: unit },
});
const host = (overrides: Partial<HomeAssistant> = {}): HomeAssistant => ({
  states: {},
  async callWS<T>(): Promise<T> { return {} as T; },
  ...overrides,
});

describe("Home Assistant entity formatting", () => {
  it("uses the host entity name with the state object and host receiver", () => {
    const entity = state();
    const formatEntityName = vi.fn(function(this: HomeAssistant, value: HassState) {
      expect(this.states[entity.entity_id]).toBe(value);
      return "Wohnzimmer Temperatur";
    });
    const hass = host({ states: { [entity.entity_id]: entity }, formatEntityName });
    expect(entityName(entity, hass)).toBe("Wohnzimmer Temperatur");
    expect(formatEntityName).toHaveBeenCalledExactlyOnceWith(entity);
  });

  it("keeps useful names when the host helper or entity is absent", () => {
    expect(entityName()).toBeUndefined();
    expect(entityName(state())).toBe("Raumtemperatur");
    expect(entityName({ ...state(), attributes: {} })).toBe("sensor.room_temperature");
    expect(entityName(state(), host({ formatEntityName: () => " " }))).toBe("Raumtemperatur");
    expect(entityName(state(), host({ formatEntityName: () => { throw new Error("unavailable"); } }))).toBe("Raumtemperatur");
  });

  it("uses the host state formatting including its precision and unit", () => {
    const entity = state("70.1234", "°F");
    const formatEntityState = vi.fn(() => "70.123 °F");
    expect(temperatureLabel(entity, host({ formatEntityState }))).toBe("70.123 °F");
    expect(formatEntityState).toHaveBeenCalledExactlyOnceWith(entity);
  });

  it.each([["unknown", "Unknown"], ["unavailable", "Unavailable"]])("localizes %s with the host state helper", (value, label) => {
    expect(temperatureLabel(state(value), host({ formatEntityState: () => label }))).toBe(label);
  });

  it.each(["", "  ", "n/a", "NaN", "Infinity"])("keeps the invalid reading warning for %j", (value) => {
    const formatEntityState = vi.fn(() => "Formatted value");
    expect(temperatureLabel(state(value), host({ formatEntityState }))).toBe("Ungültiger Messwert");
    expect(formatEntityState).not.toHaveBeenCalled();
  });

  it("retains removed entities and missing unit warnings", () => {
    const formatEntityState = vi.fn(() => "21.456");
    expect(temperatureLabel(undefined, host({ formatEntityState }))).toBe("Entität entfernt");
    expect(formatEntityState).not.toHaveBeenCalled();
    expect(temperatureLabel(state("21.456", ""), host({ formatEntityState }))).toBe("21.456 (Einheit fehlt)");
  });

  it("formats numeric fallback values in the profile language", () => {
    const hass = host({ locale: { language: "en" } });
    expect(temperatureLabel(state(), hass)).toBe("21.46 °C");
    expect(formatNumber(1234.56, hass, { maximumFractionDigits: 1 })).toBe("1,234.6");
    expect(formatNumber(1234.56, undefined, { maximumFractionDigits: 1 })).toBe("1.234,6");
  });

  it("falls back safely when the host formatter fails or returns no label", () => {
    expect(temperatureLabel(state(), host({ formatEntityState: () => { throw new Error("unavailable"); } }))).toBe("21,46 °C");
    expect(temperatureLabel(state("unknown"), host({ formatEntityState: () => "" }))).toBe("Wert unbekannt");
    expect(temperatureLabel(state("unavailable"), host({ formatEntityState: () => " " }))).toBe("Nicht verfügbar");
    expect(formatNumber(21.4, host({ locale: { language: "invalid_locale" } }))).toBe("21,4");
  });

  it("sorts sensor choices by the displayed host name", () => {
    const first = state();
    const second = { ...state(), entity_id: "sensor.other_temperature" };
    const hass = host({
      states: { [first.entity_id]: first, [second.entity_id]: second },
      formatEntityName: (entity) => entity === first ? "Zebra" : "Alpha",
    });
    expect(temperatureSensors(hass).map((entity) => entity.entity_id)).toEqual([second.entity_id, first.entity_id]);
  });

  it.each([["20.75", "°C", "20,8 °C"], ["71.6", "°F", "71,6 °F"], ["293.15", "K", "293,2 K"], ["0", "°C", "0 °C"], ["-12", "°C", "-12 °C"]])("displays numeric temperature %s in its actual %s unit", (value, unit, expected) => {
    expect(measuredTemperatureLabel(state(value, unit))).toBe(expected);
  });

  it.each(["unknown", "unavailable", "", " ", "NaN", "Infinity", "1e999", "0x20", "20 °C", "21,5", "n/a"])("uses ? for a missing or invalid live temperature %j", (value) => {
    expect(measuredTemperatureLabel(state(value))).toBe("?");
  });

  it("uses ? for removed sensors, changed device classes and unrecognized or missing units", () => {
    expect(measuredTemperatureLabel()).toBe("?");
    expect(measuredTemperatureLabel({ ...state(), attributes: { device_class: "humidity", unit_of_measurement: "%" } })).toBe("?");
    for (const unit of ["", "C", "%", "W", "°C / h"]) expect(measuredTemperatureLabel(state("20", unit))).toBe("?");
    expect(measuredTemperatureLabel(state("21.4"), host({ locale: { language: "en" } }))).toBe("21.4 °C");
  });

  it("requires exactly one role-marked outdoor sensor without selecting arbitrary weather entities", () => {
    const ordinary = state("21.4");
    const outside = { ...state("5.5"), entity_id: "sensor.weather", attributes: { ...state().attributes, heizlast_ha_role: "outdoor_temperature" } };
    expect(outdoorTemperatureLabel(host({ states: { [ordinary.entity_id]: ordinary } }))).toBe("?");
    const hass = host({ states: { [ordinary.entity_id]: ordinary, [outside.entity_id]: outside } });
    expect(outdoorTemperatureLabel(hass)).toBe("5,5 °C");
    expect(temperatureSensors(hass).map((entity) => entity.entity_id)).toEqual([ordinary.entity_id]);
    expect(outdoorTemperatureLabel(host({ states: { [outside.entity_id]: outside, "sensor.other": { ...outside, entity_id: "sensor.other" } } }))).toBe("?");
  });
});
