import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { planningData } from "../src/planning-types";
import { clone, type HassState, type HomeAssistant, type Project } from "../src/types";
import type { WeatherForecast } from "../src/simulation-core";

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
  it("shows two hourly chart series and exact values without manual weather or FBH fields", async () => {
    const { card, callWS } = await mount();
    const shape = polygons(card); await press(card, "Simulation");
    expect(polygons(card)).toEqual(shape);
    expect(card.shadowRoot!.querySelectorAll('input')).toHaveLength(0);
    expect(content(card)).not.toContain("Wetterannahmen einstellen");
    expect(content(card)).not.toContain("FBH-Annahmen einstellen");
    expect(card.shadowRoot!.querySelectorAll(".hour-table tbody tr")).toHaveLength(24);
    expect(card.shadowRoot!.querySelector(".load-line")!.getAttribute("d")).toContain("L");
    expect(card.shadowRoot!.querySelector(".supply-line")!.getAttribute("d")).toContain("L");
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
  });

  it("keeps weather gaps unknown and distinguishes heating off and unreachable from valid temperatures", async () => {
    const data = forecast(); data.days[0].hours[2] = { time: data.days[0].hours[2].time };
    data.days[0].hours[3].outdoorTemperatureC = 30;
    data.days[0].hours[4].outdoorTemperatureC = -60;
    const { card } = await mount(snapshot(), data); await press(card, "Simulation");
    expect(content(card)).toContain("Wetterdaten fehlen für einzelne Stunden");
    expect(content(card)).toContain("Nicht erreichbar"); expect(content(card)).toContain("Heizung aus");
    expect(card.shadowRoot!.querySelector(".curve-summary")!.textContent).toContain("?");
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
    expect(card.shadowRoot!.querySelectorAll(".hour-table tbody tr")).toHaveLength(24);
    expect(readings(card)).not.toEqual(Array(5).fill("? / ? / ?"));
  });

  it("retains duplicate local times with offsets on a DST day and supports keyboard tab navigation", async () => {
    const data = forecast(); data.timezone = "Europe/Berlin";
    data.days = [{ date: "2026-10-25", hours: Array.from({ length: 25 }, (_, index) => ({ ...data.days[0].hours[0], time: new Date(Date.UTC(2026, 9, 24, 22 + index)).toISOString() })) }];
    const { card } = await mount(snapshot(), data);
    card.shadowRoot!.querySelector<HTMLButtonElement>("#view-live")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })); await settle(card);
    expect(card.shadowRoot!.querySelectorAll(".hour-table tbody tr")).toHaveLength(25);
    const options = [...card.shadowRoot!.querySelectorAll('select[aria-label="Stunde im Grundriss"] option')].map((option) => option.textContent);
    expect(options).toContain("02:00 GMT+2"); expect(options).toContain("02:00 GMT+1");
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
