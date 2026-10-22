import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { planningData } from "../src/planning-types";
import { clone, type HassState, type HomeAssistant, type Project } from "../src/types";
import { estimateGasUse, simulateHeatingDay, type WeatherForecast } from "../src/simulation-core";

const snapshot = (): Project => ({ revision: 4, planning_bindings: {}, planning_temperatures: Object.fromEntries(planningData.zones.map((zone) => [zone.id, 22])) });
function forecast(): WeatherForecast {
  return { timezone: "UTC", fetched_at: new Date().toISOString(), days: [1, 2].map((day) => ({ date: `2026-01-0${day}`, hours: Array.from({ length: 24 }, (_, hour) => ({ time: new Date(Date.UTC(2026, 0, day, hour)).toISOString(), outdoorTemperatureC: hour === 12 ? 10 : 0, globalIrradianceWPerM2: hour === 12 ? 300 : 0, facadeIrradiance: { N: 0, E: 0, S: hour === 12 ? 300 : 0, W: 0 } })) })) };
}
async function settle(card: HeizlastGrundrissCard) { await card.updateComplete; await new Promise((resolve) => setTimeout(resolve, 0)); await card.updateComplete; }
async function mount(project = snapshot(), weather = forecast(), states: Record<string, HassState> = {}) {
  const callWS = vi.fn(async (message: Record<string, unknown>) => clone(message.type === "heizlast_ha/get_weather" ? weather : project));
  const hass = { user: { is_admin: false }, states, callWS } as HomeAssistant;
  const card = new HeizlastGrundrissCard(); card.hass = hass; document.body.append(card); await settle(card);
  return { card, hass, callWS, project, weather };
}
async function press(card: HeizlastGrundrissCard, text: string) {
  [...card.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent!.trim() === text)!.click(); await settle(card);
}
async function select(card: HeizlastGrundrissCard, label: string, value: string) {
  const input = card.shadowRoot!.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); await settle(card);
}
const content = (card: HeizlastGrundrissCard) => card.shadowRoot!.textContent!;
const polygons = (card: HeizlastGrundrissCard) => [...card.shadowRoot!.querySelectorAll("polygon.room-shape")].map((polygon) => polygon.getAttribute("points"));
const readings = (card: HeizlastGrundrissCard) => [...card.shadowRoot!.querySelectorAll(".room-readings")].map((row) => row.textContent!);
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe("hourly day simulation in the fixed floor plan", () => {
  it("shows three hourly chart series without an hourly table or manual weather and FBH fields", async () => {
    const { card, callWS } = await mount();
    const shape = polygons(card); await press(card, "Simulation");
    expect(polygons(card)).toEqual(shape);
    expect([...card.shadowRoot!.querySelectorAll('input')].map((input) => input.id)).toEqual(["gas-price"]);
    expect(content(card)).not.toContain("Wetterannahmen einstellen");
    expect(content(card)).not.toContain("FBH-Annahmen einstellen");
    expect(card.shadowRoot!.querySelector("table")).toBeNull();
    expect(content(card)).not.toContain("Stundenwerte anzeigen");
    expect(card.shadowRoot!.querySelector(".load-line")!.getAttribute("d")).toContain("L");
    expect(card.shadowRoot!.querySelector(".supply-line")!.getAttribute("d")).toContain("L");
    expect(card.shadowRoot!.querySelector(".outdoor-line")!.getAttribute("d")).toContain("L");
    expect(card.shadowRoot!.querySelectorAll(".outdoor-point")).toHaveLength(24);
    expect(card.shadowRoot!.querySelector(".chart-legend")!.textContent).toContain("Außentemperatur · rechte Achse");
    card.shadowRoot!.querySelectorAll<SVGElement>(".chart-hit")[12].dispatchEvent(new MouseEvent("click", { bubbles: true })); await settle(card);
    expect(card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Stunde im Grundriss"]')!.value).toBe("12");
    expect(card.shadowRoot!.querySelector(".curve-summary")!.textContent).toContain("10 °C");
    expect(content(card)).toContain("Wärmebedarf am Tag");
    expect(content(card)).toContain("Raumtemperatur aus Live");
    expect(callWS.mock.calls.map(([message]) => message.type)).toEqual(["heizlast_ha/get_project", "heizlast_ha/get_weather"]);
  });

  it("uses selected hour in rooms, preserves date and hour across floors and views, and supports read-only users", async () => {
    const { card, callWS } = await mount(); await press(card, "Simulation");
    const initial = readings(card);
    await select(card, "Stunde im Grundriss", "12"); expect(readings(card)).not.toEqual(initial);
    await select(card, "Tag", "2026-01-02"); await select(card, "Stunde im Grundriss", "12");
    await press(card, "Obergeschoss"); const upper = polygons(card);
    await press(card, "Live"); expect(polygons(card)).toEqual(upper);
    await press(card, "Simulation");
    expect(card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Tag"]')!.value).toBe("2026-01-02");
    expect(card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Stunde im Grundriss"]')!.value).toBe("12");
    card.shadowRoot!.querySelector<HTMLButtonElement>('[data-shape="og-diele"]')!.click(); await settle(card);
    expect(content(card)).toContain("Kein eigener Heizkreis");
    expect(content(card)).toContain("Heizkreisverteiler OG: Ostzimmer");
    expect(card.shadowRoot!.querySelectorAll(".circuit-details li")).toHaveLength(0);
    expect(callWS.mock.calls.every(([message]) => !String(message.type).includes("save"))).toBe(true);
  });

  it("uses live sensor units and precedence, invalidates results when sensor values change, and never substitutes fixed values", async () => {
    const project = snapshot(); project.planning_bindings["5"] = ["sensor.room"];
    const state: HassState = { entity_id: "sensor.room", state: "71.6", attributes: { device_class: "temperature", unit_of_measurement: "°F" } };
    const { card, hass } = await mount(project, forecast(), { "sensor.room": state }); await press(card, "Simulation");
    const initial = readings(card);
    card.hass = { ...hass, states: { "sensor.room": { ...state, state: "77" } } }; await settle(card);
    expect(readings(card)).not.toEqual(initial);
    card.hass = { ...hass, states: { "sensor.room": { ...state, state: "unavailable" } } }; await settle(card);
    expect(content(card)).toContain("Raumtemperatur fehlt");
    expect(readings(card)).toEqual(Array(5).fill("? / ? / ?"));
    expect(card.shadowRoot!.querySelector(".supply-line")!.getAttribute("d")!.trim()).toBe("");
    expect(card.shadowRoot!.querySelectorAll(".outdoor-point")).toHaveLength(24);
  });

  it("keeps weather gaps unknown and distinguishes heating off and unreachable from valid temperatures", async () => {
    const data = forecast(); data.days[0].hours[2] = { time: data.days[0].hours[2].time };
    data.days[0].hours[3].outdoorTemperatureC = 30;
    data.days[0].hours[4].outdoorTemperatureC = -60;
    const { card } = await mount(snapshot(), data); await press(card, "Simulation");
    expect(content(card)).toContain("Wetterdaten fehlen für einzelne Stunden");
    expect(content(card)).toContain("Nicht erreichbar"); expect(content(card)).toContain("Heizung aus");
    expect(card.shadowRoot!.querySelector(".curve-summary")!.textContent).toContain("?");
    const outside = [...card.shadowRoot!.querySelectorAll<SVGCircleElement>(".outdoor-point")];
    expect(outside).toHaveLength(23);
    expect(outside.every((point) => Number(point.getAttribute("cy")) >= 38 && Number(point.getAttribute("cy")) <= 260)).toBe(true);
    expect(card.shadowRoot!.querySelector(".temperature-tick")!.textContent).toBe("-60");
    expect(card.shadowRoot!.querySelector(".outdoor-line")!.getAttribute("d")!.match(/M/g)).toHaveLength(2);
    expect(card.shadowRoot!.querySelector(".gas-energy")!.textContent).toBe("?");
    expect(card.shadowRoot!.querySelector(".gas-cost")!.textContent).toBe("?");
    await select(card, "Stunde im Grundriss", "2");
    expect(readings(card)).toEqual(Array(5).fill("? / ? / ?"));
    await select(card, "Stunde im Grundriss", "4"); expect(content(card)).toContain("Suchgrenze");
  });

  it("does not show a stale curve and recovers after a failed read", async () => {
    const data = forecast(); data.fetched_at = new Date(Date.now() - 3600001).toISOString();
    const { card, callWS } = await mount(snapshot(), data); await press(card, "Simulation");
    expect(content(card)).toContain("Keine frischen stündlichen Wetterdaten");
    expect(readings(card)).toEqual(Array(5).fill("? / ? / ?"));
    callWS.mockRejectedValueOnce(new Error("offline")); await press(card, "Wetterdaten aktualisieren");
    expect(content(card)).toContain("konnten nicht geladen werden");
    callWS.mockResolvedValueOnce(forecast()); await press(card, "Wetterdaten aktualisieren");
    expect(card.shadowRoot!.querySelectorAll(".outdoor-point")).toHaveLength(24);
    expect(readings(card)).not.toEqual(Array(5).fill("? / ? / ?"));
  });

  it("retains duplicate local times with offsets on a DST day and supports keyboard tab navigation", async () => {
    const data = forecast(); data.timezone = "Europe/Berlin";
    data.days = [{ date: "2026-10-25", hours: Array.from({ length: 25 }, (_, index) => ({ ...data.days[0].hours[0], time: new Date(Date.UTC(2026, 9, 24, 22 + index)).toISOString() })) }];
    const { card } = await mount(snapshot(), data);
    card.shadowRoot!.querySelector<HTMLButtonElement>("#view-live")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })); await settle(card);
    expect(card.shadowRoot!.querySelectorAll(".outdoor-point")).toHaveLength(25);
    const options = [...card.shadowRoot!.querySelectorAll('select[aria-label="Stunde im Grundriss"] option')].map((option) => option.textContent);
    expect(options).toContain("02:00 GMT+2"); expect(options).toContain("02:00 GMT+1");
  });

  it("estimates daily gas and costs from a saved work price for readers", async () => {
    const project = { ...snapshot(), gas_price_ct_per_kwh: 12.5 };
    const { card, callWS, weather } = await mount(project); await press(card, "Simulation");
    const day = simulateHeatingDay(planningData, weather.days[0].hours, project.planning_temperatures!);
    const gas = estimateGasUse(day.heatEnergyKWh, 12.5);
    expect(card.shadowRoot!.querySelector(".gas-energy")!.textContent).toBe(`≈ ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(gas.gasEnergyKWh!)} kWh`);
    expect(card.shadowRoot!.querySelector(".gas-cost")!.textContent).toBe(`≈ ${new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(gas.costEuro!)}`);
    const input = card.shadowRoot!.querySelector<HTMLInputElement>("#gas-price")!;
    expect(input.value).toBe("12.5"); expect(input.disabled).toBe(true);
    input.value = "20"; input.dispatchEvent(new Event("input", { bubbles: true })); await settle(card);
    expect(callWS.mock.calls.every(([message]) => !String(message.type).includes("save"))).toBe(true);
  });

  it("validates gas prices, persists decimal input, keeps drafts on errors and handles conflicts", async () => {
    const { card, hass, callWS, project } = await mount();
    card.hass = { ...hass, user: { is_admin: true } }; await press(card, "Simulation");
    const price = () => card.shadowRoot!.querySelector<HTMLInputElement>("#gas-price")!;
    const setPrice = async (value: string) => { price().value = value; price().dispatchEvent(new Event("input", { bubbles: true })); await settle(card); };
    const save = () => [...card.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Gaspreis speichern")!;
    expect(card.shadowRoot!.querySelector(".gas-cost")!.textContent).toBe("?");
    for (const invalid of ["-1", "abc", "Infinity", "1e400"]) {
      await setPrice(invalid); expect(price().getAttribute("aria-invalid")).toBe("true"); expect(save().disabled).toBe(true);
      expect(card.shadowRoot!.querySelector(".gas-cost")!.textContent).toBe("?");
    }
    await setPrice("12,5");
    callWS.mockRejectedValueOnce({ code: "storage_error" }); await press(card, "Gaspreis speichern");
    expect(price().value).toBe("12,5"); expect(content(card)).toContain("Gaspreis konnte nicht gespeichert werden");
    callWS.mockResolvedValueOnce({ ...project, revision: 5, gas_price_ct_per_kwh: 12.5 }); await press(card, "Gaspreis speichern");
    expect(callWS).toHaveBeenLastCalledWith({ type: "heizlast_ha/save_gas_price", revision: 4, gas_price_ct_per_kwh: 12.5 });
    expect(price().value).toBe("12.5"); expect(save().disabled).toBe(true);
    await setPrice("0"); expect(card.shadowRoot!.querySelector(".gas-cost")!.textContent).toContain("0,00");
    await press(card, "Gaspreis verwerfen"); expect(price().value).toBe("12.5");
    await setPrice("");
    callWS.mockResolvedValueOnce({ ...project, revision: 6 }); await press(card, "Gaspreis speichern");
    expect(callWS).toHaveBeenLastCalledWith({ type: "heizlast_ha/save_gas_price", revision: 5, gas_price_ct_per_kwh: null });
    await setPrice("10"); callWS.mockRejectedValueOnce({ code: "conflict" }); await press(card, "Gaspreis speichern");
    expect(price().value).toBe("10"); expect(price().disabled).toBe(true);
    expect(content(card)).toContain("zwischenzeitlich geändert");
    callWS.mockResolvedValueOnce({ ...project, revision: 8, gas_price_ct_per_kwh: 11 });
    await press(card, "Aktuelle Zuordnungen laden"); expect(price().value).toBe("11"); expect(price().disabled).toBe(false);
  });

  it("keeps room and gas price drafts independent while sharing the current revision", async () => {
    const { card, hass, callWS, project } = await mount();
    card.hass = { ...hass, user: { is_admin: true } }; await settle(card);
    const fixed = card.shadowRoot!.querySelector<HTMLInputElement>("#fixed-temperature")!;
    fixed.value = "23"; fixed.dispatchEvent(new Event("input", { bubbles: true })); await press(card, "Simulation");
    const setPrice = async (value: string) => { const input = card.shadowRoot!.querySelector<HTMLInputElement>("#gas-price")!; input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); await settle(card); };
    await setPrice("12.5");
    callWS.mockResolvedValueOnce({ ...project, revision: 5, gas_price_ct_per_kwh: 12.5 }); await press(card, "Gaspreis speichern");
    await setPrice("13"); await press(card, "Live");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>("#fixed-temperature")!.value).toBe("23");
    const temperatures = { ...project.planning_temperatures, "5": 23 };
    callWS.mockResolvedValueOnce({ ...project, revision: 6, gas_price_ct_per_kwh: 12.5, planning_temperatures: temperatures });
    await press(card, "Änderungen speichern");
    expect(callWS).toHaveBeenLastCalledWith({ type: "heizlast_ha/save_planning_bindings", revision: 5, bindings: {}, temperatures });
    await press(card, "Simulation");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>("#gas-price")!.value).toBe("13");
    callWS.mockResolvedValueOnce({ ...project, revision: 7, gas_price_ct_per_kwh: 13, planning_temperatures: temperatures }); await press(card, "Gaspreis speichern");
    expect(callWS).toHaveBeenLastCalledWith({ type: "heizlast_ha/save_gas_price", revision: 6, gas_price_ct_per_kwh: 13 });
  });
  it("expires displayed weather even without a new HA state or completed refresh", async () => {
    const data = forecast(); data.fetched_at = new Date(Date.now() - 3599000).toISOString();
    const { card } = await mount(snapshot(), data);
    vi.useFakeTimers();
    card.shadowRoot!.querySelector<HTMLButtonElement>("#view-simulation")!.click();
    await vi.advanceTimersByTimeAsync(0); await card.updateComplete;
    expect(readings(card)).not.toEqual(Array(5).fill("? / ? / ?"));
    await vi.advanceTimersByTimeAsync(1001); await card.updateComplete;
    expect(content(card)).toContain("Keine frischen stündlichen Wetterdaten");
    expect(readings(card)).toEqual(Array(5).fill("? / ? / ?"));
    card.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

});
