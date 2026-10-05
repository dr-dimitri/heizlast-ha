import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { planningData } from "../src/planning-types";
import { clone, type HassState, type HomeAssistant, type Project } from "../src/types";

const sensor = (id: string, value = "20.7"): HassState => ({ entity_id: id, state: value, attributes: { device_class: "temperature", unit_of_measurement: "°C" } });
const snapshot = (): Project => ({ revision: 4, planning_bindings: { "5": ["sensor.first"] } });
const content = (card: HeizlastGrundrissCard) => card.shadowRoot!.textContent!;
async function settle(card: HeizlastGrundrissCard) { await card.updateComplete; await new Promise((resolve) => setTimeout(resolve, 0)); await card.updateComplete; }
async function mount(admin = false, states: Record<string, HassState> = {}) {
  const project = snapshot();
  const callWS = vi.fn(async () => clone(project));
  const hass = { user: { is_admin: admin }, states, callWS } as HomeAssistant;
  const card = new HeizlastGrundrissCard(); card.hass = hass; document.body.append(card); await settle(card);
  return { card, hass, callWS, project };
}
async function press(card: HeizlastGrundrissCard, text: string) {
  [...card.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent!.trim() === text)!.click(); await settle(card);
}
function numberInput(card: HeizlastGrundrissCard, label: string) { return card.shadowRoot!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; }
async function change(card: HeizlastGrundrissCard, label: string, value: string) {
  const input = numberInput(card, label); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); await settle(card);
}
async function weather(card: HeizlastGrundrissCard, value: "sunny" | "cloudy") {
  const select = card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Wetter"]')!; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); await settle(card);
}
const readings = (card: HeizlastGrundrissCard) => [...card.shadowRoot!.querySelectorAll(".room-readings")].map((row) => row.textContent!);
const polygons = (card: HeizlastGrundrissCard) => [...card.shadowRoot!.querySelectorAll("polygon.room-shape")].map((polygon) => polygon.getAttribute("points"));
function metric(card: HeizlastGrundrissCard, label: string) { return [...card.shadowRoot!.querySelectorAll(".metric")].find((metric) => metric.querySelector(".metric-label")!.textContent!.includes(label))!.querySelector("strong")!.textContent; }
afterEach(() => document.body.replaceChildren());

describe("simulation in the existing fixed floorplan", () => {
  it("starts in Live and reuses the same EG/OG contours, labels and room selection in Simulation", async () => {
    const { card, callWS } = await mount();
    expect(card.shadowRoot!.querySelector('#view-live')!.getAttribute("aria-selected")).toBe("true");
    const groundPolygons = polygons(card);
    const groundNames = [...card.shadowRoot!.querySelectorAll(".room-name")].map((name) => name.textContent);
    await press(card, "Simulation");
    expect(polygons(card)).toEqual(groundPolygons);
    expect([...card.shadowRoot!.querySelectorAll(".room-name")].map((name) => name.textContent)).toEqual(groundNames);
    expect(numberInput(card, "Vorlauf (°C)").value).toBe(String(planningData.underfloor_heating.design_supply_temperature_c));
    expect(numberInput(card, "Gewünschte Innentemperatur (°C)").value).toBe("22");
    expect(numberInput(card, "Außentemperatur (°C)").value).toBe("5");
    expect(content(card)).toContain("Wärmebedarf / mögliche FBH-Leistung / Bilanz (alle W)");
    await press(card, "Obergeschoss"); const upperPolygons = polygons(card);
    expect(card.shadowRoot!.querySelectorAll(".room-label")).toHaveLength(6);
    card.shadowRoot!.querySelector<HTMLButtonElement>('[data-shape="og-bad"]')!.click(); await settle(card);
    expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Bad");
    await press(card, "Live"); expect(polygons(card)).toEqual(upperPolygons);
    expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Bad");
    expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "heizlast_ha/get_project" });
  });

  it("lets read-only users change the scenario and keeps it across floors and tabs without changing source data or bindings", async () => {
    const originalData = JSON.stringify(planningData);
    const { card, callWS, project } = await mount(false, { "sensor.first": sensor("sensor.first") });
    await press(card, "Simulation");
    await change(card, "Vorlauf (°C)", "30"); await change(card, "Gewünschte Innentemperatur (°C)", "21"); await change(card, "Außentemperatur (°C)", "-5"); await weather(card, "cloudy");
    await change(card, "Aktiver Flächenanteil (0–1)", "0.65");
    await press(card, "Obergeschoss"); await press(card, "Live"); await press(card, "Simulation");
    expect(numberInput(card, "Vorlauf (°C)").value).toBe("30"); expect(numberInput(card, "Gewünschte Innentemperatur (°C)").value).toBe("21");
    expect(numberInput(card, "Außentemperatur (°C)").value).toBe("-5"); expect(numberInput(card, "Aktiver Flächenanteil (0–1)").value).toBe("0.65");
    expect(card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Wetter"]')!.value).toBe("cloudy");
    expect(card.shadowRoot!.querySelector('input[type="checkbox"]')).toBeNull();
    expect(content(card)).not.toContain("Temperatursensoren zuordnen");
    expect(callWS).toHaveBeenCalledTimes(1); expect(project).toEqual(snapshot()); expect(JSON.stringify(planningData)).toBe(originalData);
  });

  it("is independent of HA sensor updates and remains usable when the connection fails or is absent", async () => {
    const { card, hass, callWS } = await mount(false, { "sensor.first": sensor("sensor.first", "45") });
    await press(card, "Simulation"); const initialReadings = readings(card);
    card.hass = { ...hass, states: { "sensor.first": sensor("sensor.first", "unknown") } }; await settle(card);
    expect(readings(card)).toEqual(initialReadings); expect(callWS).toHaveBeenCalledTimes(1);
    const failed = new HeizlastGrundrissCard(); failed.hass = { states: {}, callWS: async () => { throw new Error("offline"); } }; document.body.append(failed); await settle(failed);
    expect(content(failed)).toContain("Sensorzuordnungen konnten nicht geladen werden"); await press(failed, "Simulation");
    expect(failed.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(readings(failed)).toEqual(initialReadings); await change(failed, "Außentemperatur (°C)", "-10"); expect(readings(failed)).not.toEqual(initialReadings);
    const disconnected = new HeizlastGrundrissCard(); document.body.append(disconnected); await settle(disconnected); await press(disconnected, "Simulation");
    expect(readings(disconnected)).toEqual(initialReadings); expect(numberInput(disconnected, "Vorlauf (°C)").disabled).toBe(false);
  });

  it("compares each room's possible output with demand and marks deficits using both values and a text legend", async () => {
    const { card } = await mount(); await press(card, "Simulation"); await weather(card, "cloudy");
    await change(card, "Diffuse Strahlung bewölkt (W/m²)", "0"); await change(card, "Vorlauf (°C)", "22");
    expect(metric(card, "Mögliche FBH-Leistung")).toBe("≈ 0 W"); expect(metric(card, "Räume mit Defizit")).toBe("5 / 5");
    expect(content(card)).toContain("Defizit · zusätzliche Leistung nötig"); expect(content(card)).toContain("Defizit:");
    for (const label of card.shadowRoot!.querySelectorAll(".room-label")) expect(label.getAttribute("aria-label")).toContain("Defizit:");
    expect(card.shadowRoot!.querySelectorAll("polygon.room-shape.simulated-deficit")).toHaveLength(5);
    await change(card, "Vorlauf (°C)", "60");
    expect(metric(card, "Räume mit Defizit")).toBe("0 / 5"); expect(content(card)).toContain("Leistungsreserve:");
    expect(card.shadowRoot!.querySelectorAll("polygon.room-shape.simulated-covered")).toHaveLength(5);
    expect(content(card)).toContain("ein Überschuss ist eine Leistungsreserve");
  });

  it("reacts to weather, sun position and heating assumptions through the adjustable model", async () => {
    const { card } = await mount(); await press(card, "Simulation"); const sunny = readings(card);
    await weather(card, "cloudy"); expect(readings(card)).not.toEqual(sunny);
    const cloudySolar = metric(card, "Solare Gewinne"); await change(card, "Diffuse Strahlung bewölkt (W/m²)", "0");
    expect(metric(card, "Solare Gewinne")).toBe("≈ 0 W"); expect(metric(card, "Solare Gewinne")).not.toBe(cloudySolar);
    const initialPower = metric(card, "Mögliche FBH-Leistung"); await change(card, "Aktiver Flächenanteil (0–1)", "0");
    expect(metric(card, "Mögliche FBH-Leistung")).toBe("≈ 0 W"); expect(initialPower).not.toBe("≈ 0 W");
    await weather(card, "sunny"); const southSolar = metric(card, "Solare Gewinne"); await change(card, "Sonnenazimut (° · 180 = Süd)", "0");
    expect(metric(card, "Solare Gewinne")).not.toBe(southSolar);
  });

  it("keeps invalid and incomplete scenarios visible as unknown results and recovers after valid input", async () => {
    const { card } = await mount(); await press(card, "Simulation"); await change(card, "Vorlauf (°C)", "");
    expect(card.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain("Szenario unvollständig oder ungültig");
    expect(numberInput(card, "Vorlauf (°C)").getAttribute("aria-invalid")).toBe("true");
    expect(readings(card)).toEqual(Array(5).fill("? / ? / ?")); expect(metric(card, "Wärmebedarf")).toBe("?");
    expect(card.shadowRoot!.querySelector(".simulation-results .heat-value")!.textContent).toBe("?");
    await press(card, "Obergeschoss"); await press(card, "Live"); await press(card, "Simulation"); expect(numberInput(card, "Vorlauf (°C)").value).toBe("");
    await change(card, "Vorlauf (°C)", "61"); expect(card.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    await change(card, "Vorlauf (°C)", "35"); expect(card.shadowRoot!.querySelector('[role="alert"]')).toBeNull(); expect(readings(card)).not.toContain("? / ? / ?");
    await change(card, "Referenz-Innentemperatur (°C)", "30");
    expect(card.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain("Der Referenzrücklauf muss über der Referenz-Innentemperatur liegen");
    expect(card.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain("Referenzleistung, Referenzspreizung und Referenz-Innentemperatur müssen zusammenpassen");
    await change(card, "Referenz-Innentemperatur (°C)", "20"); expect(card.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    await change(card, "Referenzleistung (W/m²)", "200"); await change(card, "Referenz-Innentemperatur (°C)", "27");
    expect(card.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain("Die Referenz-Bodenoberfläche darf nicht über der Heizmitteltemperatur liegen");
    expect(readings(card)).not.toContain("≈ 0 / 0 / +0 W");
  });

  it("keeps the complete values compact with one shared watt unit at extreme valid scenario settings", async () => {
    const { card } = await mount(); await press(card, "Simulation");
    await change(card, "Vorlauf (°C)", "60"); await change(card, "Gewünschte Innentemperatur (°C)", "5");
    await change(card, "Außentemperatur (°C)", "-40"); await change(card, "Aktiver Flächenanteil (0–1)", "1");
    await change(card, "Maximale Bodenoberfläche (°C)", "35"); await weather(card, "cloudy"); await change(card, "Diffuse Strahlung bewölkt (W/m²)", "0");
    expect(card.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    for (const floor of ["Erdgeschoss", "Obergeschoss"]) {
      await press(card, floor);
      for (const row of readings(card)) expect(row).toMatch(/^≈ [\d.]+ \/ [\d.]+ \/ [−+][\d.]+ W$/);
      for (const label of card.shadowRoot!.querySelectorAll(".room-label")) {
        expect(label.getAttribute("aria-label")).toMatch(/Wärmebedarf: ≈ [\d.]+ W \/ Mögliche FBH-Leistung: ≈ [\d.]+ W/);
      }
    }
    expect(content(card)).toContain("Bilanz (alle W)");
  });

  it("preserves unsaved Live assignments while editing a simulation and sends no save requests", async () => {
    const { card, callWS } = await mount(true, { "sensor.first": sensor("sensor.first"), "sensor.second": sensor("sensor.second", "21") });
    const unassigned = [...card.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => !input.checked)!;
    unassigned.checked = true; unassigned.dispatchEvent(new Event("change", { bubbles: true })); await settle(card);
    expect(content(card)).toContain("Ungespeicherte Sensorzuordnungen");
    await press(card, "Simulation"); await change(card, "Vorlauf (°C)", "25"); await press(card, "Live");
    expect([...card.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.checked)).toBe(true);
    expect(content(card)).toContain("Ungespeicherte Sensorzuordnungen"); expect(callWS).toHaveBeenCalledTimes(1);
  });

  it("distinguishes documented planning data from adjustable assumptions and shows room-level source values", async () => {
    const { card } = await mount(); await press(card, "Simulation");
    expect(content(card)).toContain("Belegter EnEV-Planungsansatz: Vorlauf 35 °C / Rücklauf 28 °C");
    expect(content(card)).toContain("Einstellbare Modellannahmen"); expect(content(card)).toContain("angenommenen konstanten spezifischen Durchfluss");
    expect(content(card)).toContain("Normheizlast: 2.432,3 W"); expect(content(card)).toContain("Fensterbauteilflächen:");
    expect(content(card)).toContain("West 4,141 m²; Süd 14,978 m²; Ost 3,316 m²"); expect(content(card)).toContain("Heizlastberechnung · S. 10 / R5");
    expect(content(card)).toContain("Angenäherter Rücklauf"); expect(content(card)).toContain("Wärmestromdichte"); expect(content(card)).toContain("Summe Normheizlasten");
  });

  it("supports keyboard tab navigation and keeps the active panel associated with its tab", async () => {
    const { card } = await mount(); const live = card.shadowRoot!.querySelector<HTMLButtonElement>('#view-live')!;
    live.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await settle(card);
    expect(card.shadowRoot!.querySelector('#view-simulation')!.getAttribute("aria-selected")).toBe("true");
    expect(card.shadowRoot!.querySelector('[role="tabpanel"]')!.getAttribute("aria-labelledby")).toBe("view-simulation");
    card.shadowRoot!.querySelector('#view-simulation')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); await settle(card);
    expect(live.getAttribute("aria-selected")).toBe("true"); expect(card.shadowRoot!.querySelector('.scenario')).toBeNull();
  });
});
