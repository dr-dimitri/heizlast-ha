import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastEnergyComparison } from "../src/energy-dashboard";
import { clone, type EnergySettings, type HassState, type HomeAssistant, type Project } from "../src/types";
import type { HeatingDay, HeatingHour } from "../src/simulation-core";

const settings = (): EnergySettings => ({ heat_generator: "bosch_aw5800_5", pv_forecast_entity_id: "sensor.pv_prediction",
  electricity_price_entity_id: "sensor.electricity_price", feed_in_tariff_entity_id: "sensor.feed_in_tariff" });
const snapshot = (): Project => ({ revision: 4, planning_bindings: {}, energy_settings: settings() });
const sources = { pv_forecast: [{ entity_id: "sensor.pv_prediction", config_entry_id: "pv-entry" }],
  electricity_price: [{ entity_id: "sensor.electricity_price", config_entry_id: "sax-entry" }],
  feed_in_tariff: [{ entity_id: "sensor.feed_in_tariff", config_entry_id: "sax-entry" }] };
const tariffStates = (): Record<string, HassState> => ({
  "sensor.pv_prediction": { entity_id: "sensor.pv_prediction", state: "12", attributes: { unit_of_measurement: "kWh", friendly_name: "PV-Vorhersage" } },
  "sensor.electricity_price": { entity_id: "sensor.electricity_price", state: "40", attributes: { unit_of_measurement: "ct/kWh", tariff_type: "fixed", friendly_name: "Strompreis" } },
  "sensor.feed_in_tariff": { entity_id: "sensor.feed_in_tariff", state: "8", attributes: { unit_of_measurement: "ct/kWh", friendly_name: "Einspeisevergütung" } },
});
function day(date = "2026-10-22"): HeatingDay {
  const hours: HeatingHour[] = [10, 11].map((hour) => ({ time: `${date}T${hour}:00:00Z`, status: "covered", outdoorTemperatureC: 2,
    globalIrradianceWPerM2: 0, heatDemandW: 2910, roomHeatDemandW: 4500, requiredSupplyTemperatureC: 35, zones: [], circuits: [] }));
  return { hours, heatEnergyKWh: 5.82, missingZoneIds: [] };
}
const pvFor = (start: string, energy = .5) => ({ status: "available", fetched_at: "2026-10-22T10:00:00Z", expires_at: "2026-10-22T11:00:00Z",
  intervals: [0, 1].map((offset) => ({ start: new Date(Date.parse(start) + offset * 3600000).toISOString(),
    end: new Date(Date.parse(start) + (offset + 1) * 3600000).toISOString(), energy_kwh: energy })) });
async function settle(card: HeizlastEnergyComparison) { for (let index = 0; index < 8; index++) { await card.updateComplete; await Promise.resolve(); } }
async function mount(options: { admin?: boolean; project?: Project; states?: Record<string, HassState>; handler?: (message: Record<string, unknown>) => Promise<unknown> } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
  const project = options.project ?? snapshot();
  const callWS = vi.fn(async (message: Record<string, unknown>) => {
    if (options.handler) return options.handler(message);
    if (message.type === "heizlast_ha/get_energy_sources") return clone(sources);
    if (message.type === "heizlast_ha/get_energy_forecast") return pvFor(message.start as string);
    if (message.type === "heizlast_ha/get_project") return clone(project);
    if (message.type === "heizlast_ha/save_energy_settings") return { ...clone(project), revision: 5, energy_settings: clone(message.settings) };
    throw new Error(`Unexpected request ${message.type}`);
  });
  const hass = { states: options.states ?? tariffStates(), user: { is_admin: options.admin === true }, callWS } as HomeAssistant;
  const card = new HeizlastEnergyComparison(); card.hass = hass; card.project = project; card.day = day(); card.timezone = "UTC"; card.gasPriceCtPerKWh = 10;
  document.body.append(card); await settle(card);
  return { card, hass, callWS, project };
}
const input = (card: HeizlastEnergyComparison, label: string) => card.shadowRoot!.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const content = (card: HeizlastEnergyComparison) => card.shadowRoot!.textContent!;
const text = (card: HeizlastEnergyComparison, selector: string) => card.shadowRoot!.querySelector(selector)!.textContent!;
const button = (card: HeizlastEnergyComparison, label: string) => [...card.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")].find((value) => value.textContent!.trim() === label)!;
async function select(card: HeizlastEnergyComparison, label: string, value: string) {
  const field = input(card, label); field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); await settle(card);
}
async function press(card: HeizlastEnergyComparison, label: string) { button(card, label).click(); await settle(card); }
const euro = (value: number) => `≈ ${new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value)}`;
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe("energy comparison dashboard", () => {
  it("prices building heat rather than the higher room design demand for gas, grid and PV without writing", async () => {
    const { card, callWS } = await mount();
    expect(input(card, "Wärmeerzeuger").value).toBe("bosch_aw5800_5");
    expect([...card.shadowRoot!.querySelectorAll("select")].every((field) => field.disabled)).toBe(true);
    expect(content(card)).toContain("Leserechten");
    expect(content(card)).toContain("Gebäudewärmebedarf für Raumheizung");
    expect(text(card, ".comparison-gas-cost")).toBe(euro(5.82 / .95 * .1));
    expect(text(card, ".grid-only-cost")).toBe(euro(.8));
    expect(text(card, ".heat-pump-cost")).toBe(euro(.48));
    expect(text(card, ".pv-energy")).toBe("≈ 1 kWh"); expect(text(card, ".grid-energy")).toBe("≈ 1 kWh");
    expect(text(card, ".cost-saving")).toBe(euro(5.82 / .95 * .1 - .48));
    expect(callWS).toHaveBeenCalledWith({ type: "heizlast_ha/get_energy_forecast", pv_forecast_entity_id: "sensor.pv_prediction", start: "2026-10-22T10:00:00Z", end: "2026-10-22T12:00:00.000Z" });
    await select(card, "Wärmeerzeuger", "gas");
    expect(card.project!.energy_settings!.heat_generator).toBe("bosch_aw5800_5");
    expect(text(card, ".heat-pump-cost")).toBe(euro(.48));
    expect(callWS.mock.calls.every(([message]) => !String(message.type).includes("save"))).toBe(true);
    expect(content(card)).toContain("Obergrenze"); expect(content(card)).toContain("entgangener Einspeisevergütung");
  });

  it("saves generator and source drafts with the latest revision while preserving drafts across room updates", async () => {
    const project = { ...snapshot(), energy_settings: { ...settings(), heat_generator: "gas" as const } };
    const { card, callWS } = await mount({ admin: true, project });
    expect(callWS).not.toHaveBeenCalled();
    await select(card, "Wärmeerzeuger", "bosch_aw5800_5");
    expect(content(card)).toContain("ungespeicherten Energieeinstellungen");
    const updated = { ...clone(project), revision: 6, planning_temperatures: { "1": 21 } }; card.project = updated; await settle(card);
    expect(input(card, "Wärmeerzeuger").value).toBe("bosch_aw5800_5");
    const savedEvent = vi.fn(); card.addEventListener("energy-project-saved", savedEvent);
    await press(card, "Energieeinstellungen speichern");
    expect(callWS).toHaveBeenCalledWith({ type: "heizlast_ha/save_energy_settings", revision: 6, settings: settings() });
    expect(savedEvent).toHaveBeenCalledOnce();
    expect(content(card)).toContain("in Home Assistant gespeichert"); expect(content(card)).not.toContain("ungespeicherten Energieeinstellungen");
  });

  it("retains drafts on storage errors, blocks conflicted writes and reloads the current shared project", async () => {
    let mode = "storage_error";
    const handler = async (message: Record<string, unknown>) => {
      if (message.type === "heizlast_ha/get_energy_sources") return clone(sources);
      if (message.type === "heizlast_ha/get_energy_forecast") return pvFor(message.start as string);
      if (message.type === "heizlast_ha/get_project") return { ...snapshot(), revision: 7 };
      if (message.type === "heizlast_ha/save_energy_settings") throw { code: mode };
      throw new Error("request");
    };
    const { card, callWS } = await mount({ admin: true, handler });
    await select(card, "PV-Vorhersage · pv-forecast-ha", "");
    await press(card, "Energieeinstellungen speichern");
    expect(content(card)).toContain("nicht gespeichert"); expect(input(card, "PV-Vorhersage · pv-forecast-ha").value).toBe("");
    expect(button(card, "Energieeinstellungen speichern").disabled).toBe(false);
    mode = "conflict"; await press(card, "Energieeinstellungen speichern");
    expect(content(card)).toContain("zwischenzeitlich geändert"); expect(button(card, "Energieeinstellungen speichern").disabled).toBe(true);
    const writes = callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_energy_settings").length;
    await press(card, "Energieeinstellungen speichern");
    expect(callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_energy_settings")).toHaveLength(writes);
    await press(card, "Energieeinstellungen neu laden");
    expect(card.project!.revision).toBe(7); expect(input(card, "PV-Vorhersage · pv-forecast-ha").value).toBe("sensor.pv_prediction");
    expect(content(card)).not.toContain("zwischenzeitlich geändert");
    await select(card, "Wärmeerzeuger", "gas"); await press(card, "Energieeinstellungen verwerfen");
    expect(input(card, "Wärmeerzeuger").value).toBe("bosch_aw5800_5");
  });

  it("uses SAX time-of-use intervals and re-evaluates live tariff and feed-in updates", async () => {
    const states = tariffStates(); states["sensor.electricity_price"].attributes = { unit_of_measurement: "ct/kWh", tariff_type: "time_of_use", base_price_eur_kwh: .4,
      windows: [{ start: "10:30", end: "11:30", price_eur_kwh: .2 }] };
    const { card, hass } = await mount({ states });
    expect(text(card, ".grid-only-cost")).toBe(euro(.6)); expect(text(card, ".heat-pump-cost")).toBe(euro(.38));
    const changed = clone(states); changed["sensor.feed_in_tariff"].state = "0";
    card.hass = { ...hass, states: changed }; await settle(card);
    expect(text(card, ".heat-pump-cost")).toBe(euro(.3));
    changed["sensor.electricity_price"] = { ...changed["sensor.electricity_price"], state: "20", attributes: { unit_of_measurement: "ct/kWh", tariff_type: "fixed" } };
    card.hass = { ...hass, states: clone(changed) }; await settle(card);
    expect(text(card, ".grid-only-cost")).toBe(euro(.4)); expect(text(card, ".heat-pump-cost")).toBe(euro(.2));
  });

  it("includes morning storage at 18 ct until PV begins and preserves the grid reference", async () => {
    const states = tariffStates();
    states["sensor.electricity_price"].attributes = { unit_of_measurement: "ct/kWh", tariff_type: "time_of_use", base_price_eur_kwh: .4,
      windows: [{ start: "22:00", end: "06:30", price_eur_kwh: .2 }] };
    const morning = day();
    morning.hours = [6, 7, 8, 9].map((hour) => ({ ...morning.hours[0], time: `2026-10-22T0${hour}:00:00Z` }));
    morning.heatEnergyKWh = 11.64;
    const handler = async (message: Record<string, unknown>) => {
      if (message.type === "heizlast_ha/get_energy_sources") return clone(sources);
      if (message.type === "heizlast_ha/get_energy_forecast") return { ...pvFor(morning.hours[0].time),
        intervals: morning.hours.map((hour, index) => ({ start: hour.time,
          end: new Date(Date.parse(hour.time) + 3600000).toISOString(), energy_kwh: index === 3 ? 1 : 0 })) };
      throw new Error("request");
    };
    const { card, hass, callWS } = await mount({ states, handler });
    card.day = morning; await settle(card);
    expect(content(card)).toContain("Netz + PV + Speicher");
    expect(content(card)).toContain("6 kWh nutzbarer Strom zu 18 ct/kWh");
    expect(text(card, ".storage-energy")).toBe("≈ 2,5 kWh");
    expect(text(card, ".storage-cost")).toBe(euro(.45));
    expect(text(card, ".grid-energy")).toBe("≈ 0,5 kWh");
    expect(text(card, ".pv-energy")).toBe("≈ 1 kWh");
    expect(text(card, ".grid-only-cost")).toBe(euro(1.5));
    expect(text(card, ".heat-pump-cost")).toBe(euro(.63));
    expect(callWS.mock.calls.every(([message]) => !String(message.type).includes("save"))).toBe(true);

    const changed = clone(states);
    changed["sensor.electricity_price"].attributes = { unit_of_measurement: "ct/kWh", tariff_type: "fixed" };
    card.hass = { ...hass, states: changed }; await settle(card);
    expect(text(card, ".storage-energy")).toBe("≈ 0 kWh");
    expect(text(card, ".heat-pump-cost")).toBe(euro(1.28));
  });

  it("shows selected-hour COP and capacity deficits while withholding incomplete daily heat-pump costs", async () => {
    const { card } = await mount(); const limited = day();
    limited.hours[1] = { ...limited.hours[1], outdoorTemperatureC: -7, heatDemandW: 6000 };
    limited.heatEnergyKWh = 8.91; card.day = limited; card.selectedHour = 1; await settle(card);
    expect(text(card, ".hour-status")).toContain("Heizleistung reicht nicht aus");
    expect(text(card, ".hour-status")).toContain("5,42 kW"); expect(text(card, ".hour-status")).toContain("580 W");
    expect(text(card, ".grid-only-cost")).toBe("?"); expect(text(card, ".heat-pump-cost")).toBe("?");
    expect(text(card, ".comparison-gas-cost")).toBe(euro(8.91 / .95 * .1));
    card.selectedHour = 0; await settle(card);
    expect(text(card, ".hour-status")).toContain("Bedarf gedeckt"); expect(text(card, ".hour-status")).toContain("2,91");
    const off = day(); off.hours[1] = { ...off.hours[1], heatDemandW: 0 };
    card.day = off; card.selectedHour = 1; await settle(card);
    expect(text(card, ".hour-status")).toContain("Heizung aus"); expect(text(card, ".hour-status")).toContain("≈ 0 kWh");
  });

  it("reads dynamic slots through SAX for today and tomorrow while leaving unsupported future dates unknown", async () => {
    const states = tariffStates(); states["sensor.electricity_price"].attributes.tariff_type = "dynamic";
    const handler = async (message: Record<string, unknown>) => {
      if (message.type === "heizlast_ha/get_energy_sources") return clone(sources);
      if (message.type === "heizlast_ha/get_energy_forecast") return pvFor(message.start as string);
      if (message.type === "sax_power/dashboard/tariff/series") { const date = message.day === "today" ? "2026-10-22" : "2026-10-23";
        return { date, status: "available", slots: [{ start: `${date}T10:00:00Z`, end: `${date}T12:00:00Z`, price_ct_kwh: 30 }] }; }
      throw new Error("request");
    };
    const { card, callWS } = await mount({ states, handler });
    expect(callWS).toHaveBeenCalledWith({ type: "sax_power/dashboard/tariff/series", entry_id: "sax-entry", day: "today" });
    expect(text(card, ".grid-only-cost")).toBe(euro(.6));
    card.day = day("2026-10-23"); await settle(card);
    expect(callWS).toHaveBeenCalledWith({ type: "sax_power/dashboard/tariff/series", entry_id: "sax-entry", day: "tomorrow" });
    expect(text(card, ".grid-only-cost")).toBe(euro(.6));
    const before = callWS.mock.calls.filter(([message]) => message.type === "sax_power/dashboard/tariff/series").length;
    card.day = day("2026-10-24"); await settle(card);
    expect(text(card, ".grid-only-cost")).toBe("?");
    expect(callWS.mock.calls.filter(([message]) => message.type === "sax_power/dashboard/tariff/series")).toHaveLength(before);
  });

  it("rejects stale context responses after a day switch and expires cached PV without changing gas costs", async () => {
    const delayed: { start: string; resolve: (value: unknown) => void }[] = [];
    const handler = async (message: Record<string, unknown>) => {
      if (message.type === "heizlast_ha/get_energy_sources") return clone(sources);
      if (message.type === "heizlast_ha/get_energy_forecast") return new Promise((resolve) => delayed.push({ start: message.start as string, resolve }));
      throw new Error("request");
    };
    const { card } = await mount({ handler }); const initialGas = text(card, ".comparison-gas-cost");
    card.day = day("2026-10-23"); await settle(card);
    const newest = delayed.at(-1)!; newest.resolve(pvFor(newest.start, .75)); await settle(card);
    expect(text(card, ".pv-energy")).toBe("≈ 1,5 kWh");
    delayed.filter((request) => request !== newest).forEach((request) => request.resolve(pvFor(request.start, .1))); await settle(card);
    expect(text(card, ".pv-energy")).toBe("≈ 1,5 kWh");
    await vi.advanceTimersByTimeAsync(3600000); await settle(card);
    expect(text(card, ".heat-pump-cost")).toBe("?"); expect(text(card, ".comparison-gas-cost")).toBe(initialGas);
  });

  it("finishes loading when weather hours disappear during a pending PV read", async () => {
    const requests: ((value: unknown) => void)[] = [];
    const handler = async (message: Record<string, unknown>) => {
      if (message.type === "heizlast_ha/get_energy_sources") return clone(sources);
      if (message.type === "heizlast_ha/get_energy_forecast") return new Promise((resolve) => requests.push(resolve));
      throw new Error("request");
    };
    const { card } = await mount({ handler });
    expect(button(card, "Quellen erneut laden").disabled).toBe(true);
    card.day = { hours: [], heatEnergyKWh: null, missingZoneIds: [] }; await settle(card);
    expect(button(card, "Quellen erneut laden").disabled).toBe(false);
    requests.forEach((resolve) => resolve(pvFor("2026-10-22T10:00:00Z"))); await settle(card);
    expect(text(card, ".heat-pump-cost")).toBe("?");
  });
});
