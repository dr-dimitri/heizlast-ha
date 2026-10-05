import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { planningData } from "../src/planning-types";
import { clone, type HassState, type HomeAssistant, type Project } from "../src/types";

const sensor = (id: string, value = "20.7"): HassState => ({ entity_id: id, state: value, attributes: { device_class: "temperature", unit_of_measurement: "°C" } });
const snapshot = (): Project => ({ revision: 4, planning_bindings: { "5": ["sensor.first"] } });
const content = (card: HeizlastGrundrissCard) => card.shadowRoot!.textContent!;
async function settle(card: HeizlastGrundrissCard) { await card.updateComplete; await new Promise((resolve) => setTimeout(resolve, 0)); await card.updateComplete; }
async function mount(admin = false, states: Record<string, HassState> = {}, latitude: number | undefined = 50) {
  const project = snapshot();
  const callWS = vi.fn(async () => clone(project));
  const hass = { user: { is_admin: admin }, config: { latitude }, states, callWS } as HomeAssistant;
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
async function selectMonth(card: HeizlastGrundrissCard, value: string) {
  const select = card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Monat"]')!; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); await settle(card);
}
const readings = (card: HeizlastGrundrissCard) => [...card.shadowRoot!.querySelectorAll(".room-readings")].map((row) => row.textContent!);
const polygons = (card: HeizlastGrundrissCard) => [...card.shadowRoot!.querySelectorAll("polygon.room-shape")].map((polygon) => polygon.getAttribute("points"));
function metric(card: HeizlastGrundrissCard, label: string) { return [...card.shadowRoot!.querySelectorAll(".metric")].find((metric) => metric.querySelector(".metric-label")!.textContent!.includes(label))!.querySelector("strong")!.textContent; }
function detailValue(card: HeizlastGrundrissCard, label: string) { return [...card.shadowRoot!.querySelectorAll(".simulation-results .loss")].find((row) => row.querySelector("span")!.textContent === label)!.querySelector("b")!.textContent; }
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
    expect(card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Monat"]')!.value).toBe("1");
    expect(card.shadowRoot!.querySelectorAll('select[aria-label="Monat"] option')).toHaveLength(12);
    expect(content(card)).toContain("Solarer Referenztag: 15. Januar");
    expect(content(card)).toContain("Standortbreite aus Home Assistant: 50°");
    expect(numberInput(card, "Breitengrad für das Szenario (°)")).toBeNull();
    expect(content(card)).toContain("Mittlerer Wärmebedarf / mögliche FBH-Leistung / mittlere Bilanz (alle W)");
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
    await selectMonth(card, "12");
    await press(card, "Obergeschoss"); await press(card, "Live"); await press(card, "Simulation");
    expect(numberInput(card, "Vorlauf (°C)").value).toBe("30"); expect(numberInput(card, "Gewünschte Innentemperatur (°C)").value).toBe("21");
    expect(numberInput(card, "Außentemperatur (°C)").value).toBe("-5"); expect(numberInput(card, "Aktiver Flächenanteil (0–1)").value).toBe("0.65");
    expect(card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Wetter"]')!.value).toBe("cloudy");
    expect(card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Monat"]')!.value).toBe("12");
    expect(card.shadowRoot!.querySelector('input[type="checkbox"]')).toBeNull();
    expect(content(card)).not.toContain("Temperatursensoren zuordnen");
    expect(callWS).toHaveBeenCalledTimes(1); expect(project).toEqual(snapshot()); expect(JSON.stringify(planningData)).toBe(originalData);
  });

  it("is independent of HA sensor updates and remains usable when the connection fails or is absent", async () => {
    const { card, hass, callWS } = await mount(false, { "sensor.first": sensor("sensor.first", "45") });
    await press(card, "Simulation"); const initialReadings = readings(card);
    card.hass = { ...hass, states: { "sensor.first": sensor("sensor.first", "unknown") } }; await settle(card);
    expect(readings(card)).toEqual(initialReadings); expect(callWS).toHaveBeenCalledTimes(1);
    const failed = new HeizlastGrundrissCard(); failed.hass = { states: {}, config: { latitude: 50 }, callWS: async () => { throw new Error("offline"); } }; document.body.append(failed); await settle(failed);
    expect(content(failed)).toContain("Sensorzuordnungen konnten nicht geladen werden"); await press(failed, "Simulation");
    expect(failed.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(readings(failed)).toEqual(initialReadings); await change(failed, "Außentemperatur (°C)", "-10"); expect(readings(failed)).not.toEqual(initialReadings);
    const disconnected = new HeizlastGrundrissCard(); document.body.append(disconnected); await settle(disconnected); await press(disconnected, "Simulation");
    expect(readings(disconnected)).toEqual(Array(5).fill("? / ? / ?"));
    expect(numberInput(disconnected, "Vorlauf (°C)").disabled).toBe(false);
    await change(disconnected, "Breitengrad für das Szenario (°)", "50"); expect(readings(disconnected)).toEqual(initialReadings);
  });

  it("compares each room's possible output with demand and marks deficits using both values and a text legend", async () => {
    const { card } = await mount(); await press(card, "Simulation"); await weather(card, "cloudy");
    await change(card, "Referenz-Diffusstrahlung bewölkt bei 45° (W/m²)", "0"); await change(card, "Vorlauf (°C)", "22");
    expect(metric(card, "Mögliche FBH-Leistung")).toBe("≈ 0 W"); expect(metric(card, "Räume mit Spitzen-Defizit")).toBe("5 / 5");
    expect(content(card)).toContain("Spitzen-Defizit · ohne Speicher"); expect(content(card)).toContain("Größtes Defizit (ohne Speicher):");
    for (const label of card.shadowRoot!.querySelectorAll(".room-label")) expect(label.getAttribute("aria-label")).toContain("Größtes Defizit (ohne Speicher):");
    expect(card.shadowRoot!.querySelectorAll("polygon.room-shape.simulated-deficit")).toHaveLength(5);
    await change(card, "Vorlauf (°C)", "60");
    expect(metric(card, "Räume mit Spitzen-Defizit")).toBe("0 / 5"); expect(content(card)).toContain("Spitzenbedarf gedeckt");
    expect(card.shadowRoot!.querySelectorAll("polygon.room-shape.simulated-covered")).toHaveLength(5);
    expect(content(card)).toContain("Die FBH-Zahl ist mögliche Heizkapazität");
  });

  it("reacts to weather, month and heating assumptions through the adjustable model", async () => {
    const { card } = await mount(); await press(card, "Simulation"); const sunny = readings(card);
    await weather(card, "cloudy"); expect(readings(card)).not.toEqual(sunny);
    const cloudySolar = metric(card, "Solare Gewinne"); await change(card, "Referenz-Diffusstrahlung bewölkt bei 45° (W/m²)", "0");
    expect(metric(card, "Solare Gewinne")).toBe("≈ 0 W"); expect(metric(card, "Solare Gewinne")).not.toBe(cloudySolar);
    const initialPower = metric(card, "Mögliche FBH-Leistung"); await change(card, "Aktiver Flächenanteil (0–1)", "0");
    expect(metric(card, "Mögliche FBH-Leistung")).toBe("≈ 0 W"); expect(initialPower).not.toBe("≈ 0 W");
    await weather(card, "sunny"); const januarySolar = metric(card, "Solare Gewinne"); await selectMonth(card, "6");
    expect(metric(card, "Solare Gewinne")).not.toBe(januarySolar);
  });

  it("shows January's full-day demand and solar surplus separately instead of cancelling night demand with daytime sunshine", async () => {
    const { card } = await mount(); await press(card, "Simulation");
    expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Wohnen und Essen");
    expect(card.shadowRoot!.querySelector(".simulation-results .heat-value")!.textContent).toBe("≈ 820 W");
    expect(detailValue(card, "Temperaturbezogene Verluste")).toBe("≈ 1.209 W");
    expect(detailValue(card, "Solare Gewinne · Tagesmittel")).toBe("≈ 782 W");
    expect(detailValue(card, "Solarüberschuss · Tagesmittel")).toBe("≈ 393 W");
    expect(detailValue(card, "Größter Wärmebedarf")).toBe("≈ 1.209 W");
    expect(content(card)).toContain("24h-Tagesmittel für den 15. des gewählten Monats");
    expect(content(card)).toContain("Die FBH-Zahl ist mögliche Heizkapazität");
    expect(content(card)).toContain("nicht als Nachtwärme verrechnet");
    const januaryDemand = metric(card, "Mittlerer Wärmebedarf"), januarySolar = metric(card, "Solare Gewinne");
    await selectMonth(card, "6");
    expect(content(card)).toContain("Solarer Referenztag: 15. Juni");
    expect(metric(card, "Mittlerer Wärmebedarf")).not.toBe(januaryDemand);
    expect(metric(card, "Solare Gewinne")).not.toBe(januarySolar);
    expect(card.shadowRoot!.querySelector(".simulation-results .heat-value")!.textContent).not.toBe("≈ 0 W");
    expect(numberInput(card, "Sonnenazimut (° · 180 = Süd)")).toBeNull();
    expect(content(card)).toContain("keine gemessenen Monatsmittel");
  });

  it("marks the room's peak deficit even when its mean balance is positive", async () => {
    const { card } = await mount(); await press(card, "Simulation"); await change(card, "Vorlauf (°C)", "30");
    const livingLabel = card.shadowRoot!.querySelector('[data-shape="eg_wohnen"]')!;
    expect(livingLabel.querySelector(".room-readings")!.textContent).toMatch(/^≈ [\d.]+ \/ [\d.]+ \/ \+[\d.]+ W$/);
    expect(livingLabel.getAttribute("aria-label")).toMatch(/Größtes Defizit \(ohne Speicher\): ≈ [1-9][\d.]* W/);
    expect(card.shadowRoot!.querySelector(".simulation-balance")!.classList.contains("deficit")).toBe(true);
    expect(card.shadowRoot!.querySelector(".simulation-balance")!.textContent).toContain("reicht zeitweise nicht");
    const livingPolygon = [...card.shadowRoot!.querySelectorAll("polygon.room-shape")].find((polygon) => polygon.querySelector("title")!.textContent!.startsWith("Wohnen und Essen"))!;
    expect(livingPolygon.classList.contains("simulated-deficit")).toBe(true);
    expect(metric(card, "Räume mit Spitzen-Defizit")).not.toBe("0 / 5");
    expect(content(card)).toContain("Eine positive mittlere Bilanz kann ein Nachtdefizit nicht ausgleichen");
  });

  it("recalculates the monthly solar profile from updated HA latitude while preserving scenario controls", async () => {
    const { card, hass, callWS } = await mount(); await press(card, "Simulation");
    const northernSolar = metric(card, "Solare Gewinne");
    card.hass = { ...hass, config: { latitude: -50 } }; await settle(card);
    expect(metric(card, "Solare Gewinne")).not.toBe(northernSolar);
    expect(content(card)).toContain("Standortbreite aus Home Assistant: -50°");
    expect(numberInput(card, "Breitengrad für das Szenario (°)")).toBeNull();
    expect(card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Monat"]')!.value).toBe("1");
    card.hass = { ...hass, config: { latitude: 0 } }; await settle(card);
    expect(card.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(content(card)).toContain("Standortbreite aus Home Assistant: 0°");
    expect(callWS).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, NaN, Infinity, 91, -91])("requires an explicit local scenario latitude when HA's latitude is %s", async (latitude) => {
    const { card, hass, callWS, project } = await mount();
    card.hass = { ...hass, config: { latitude } }; await settle(card); await press(card, "Simulation");
    expect(numberInput(card, "Breitengrad für das Szenario (°)").value).toBe("");
    expect(numberInput(card, "Breitengrad für das Szenario (°)").getAttribute("aria-invalid")).toBe("true");
    expect(card.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain("ein Breitengrad zwischen −90° und 90° erforderlich");
    expect(metric(card, "Mittlerer Wärmebedarf")).toBe("?"); expect(readings(card)).toEqual(Array(5).fill("? / ? / ?"));
    await change(card, "Breitengrad für das Szenario (°)", "91"); expect(readings(card)).toEqual(Array(5).fill("? / ? / ?"));
    await change(card, "Breitengrad für das Szenario (°)", "0"); expect(card.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    await press(card, "Obergeschoss"); await press(card, "Live"); await press(card, "Simulation");
    expect(numberInput(card, "Breitengrad für das Szenario (°)").value).toBe("0");
    expect(readings(card)).not.toContain("? / ? / ?");
    expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "heizlast_ha/get_project" }); expect(project).toEqual(snapshot());
  });

  it("uses a newly available HA location instead of the manual latitude and keeps manual values local to the card", async () => {
    const { card, hass, callWS } = await mount();
    card.hass = { ...hass, config: undefined }; await settle(card); await press(card, "Simulation");
    await change(card, "Breitengrad für das Szenario (°)", "-50"); const manualReadings = readings(card);
    card.hass = hass; await settle(card);
    expect(numberInput(card, "Breitengrad für das Szenario (°)")).toBeNull(); expect(readings(card)).not.toEqual(manualReadings);
    expect(content(card)).toContain("Standortbreite aus Home Assistant: 50°");
    const fresh = new HeizlastGrundrissCard(); document.body.append(fresh); await settle(fresh); await press(fresh, "Simulation");
    expect(numberInput(fresh, "Breitengrad für das Szenario (°)").value).toBe("");
    expect(readings(fresh)).toEqual(Array(5).fill("? / ? / ?"));
    expect(callWS).toHaveBeenCalledTimes(1);
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
    await change(card, "Maximale Bodenoberfläche (°C)", "35"); await weather(card, "cloudy"); await change(card, "Referenz-Diffusstrahlung bewölkt bei 45° (W/m²)", "0");
    expect(card.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    for (const floor of ["Erdgeschoss", "Obergeschoss"]) {
      await press(card, floor);
      for (const row of readings(card)) expect(row).toMatch(/^≈ [\d.]+ \/ [\d.]+ \/ [−+][\d.]+ W$/);
      for (const label of card.shadowRoot!.querySelectorAll(".room-label")) {
        expect(label.getAttribute("aria-label")).toMatch(/Wärmebedarf: ≈ [\d.]+ W \/ Mögliche FBH-Leistung: ≈ [\d.]+ W/);
      }
    }
    expect(content(card)).toContain("mittlere Bilanz (alle W)");
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
