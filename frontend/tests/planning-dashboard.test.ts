import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { planningData } from "../src/planning-types";
import { clone, type HassState, type HomeAssistant, type Project } from "../src/types";

const sensor = (id: string, value = "20.7", deviceClass = "temperature"): HassState => ({ entity_id: id, state: value, attributes: { device_class: deviceClass, unit_of_measurement: deviceClass === "temperature" ? "°C" : "%", friendly_name: "Raumsensor" } });
const outsideSensor = (value = "-12.2", unit = "°C", id = "sensor.weather_actual"): HassState => ({ entity_id: id, state: value, attributes: { device_class: "temperature", unit_of_measurement: unit, heizlast_ha_role: "outdoor_temperature" } });
const radiationSensor = (value = "500", id = "sensor.sunlight"): HassState => ({ entity_id: id, state: value, attributes: { device_class: "irradiance", unit_of_measurement: "W/m²", heizlast_ha_role: "solar_radiation" } });
const facadeRadiationSensor = (north = 100, east = 100, south = 100, west = 100): HassState => ({ ...radiationSensor(), attributes: { ...radiationSensor().attributes, facade_north_w_m2: north, facade_east_w_m2: east, facade_south_w_m2: south, facade_west_w_m2: west } });
const livingReadings = (card: HeizlastGrundrissCard) => card.shadowRoot!.querySelector('[data-shape="eg_wohnen"] .room-readings')!.textContent;
const empty = (): Project => ({ revision: 4, planning_bindings: {} });
const text = (card: HeizlastGrundrissCard) => card.shadowRoot!.textContent!;
async function settle(card: HeizlastGrundrissCard) { await card.updateComplete; await new Promise((resolve) => setTimeout(resolve, 0)); await card.updateComplete; }
async function mount(snapshot = empty(), admin = true, states: Record<string, HassState> = {}) {
  const callWS = vi.fn(async (message: Record<string, unknown>): Promise<Project> => message.type === "heizlast_ha/get_project" ? clone(snapshot) : { ...clone(snapshot), revision: snapshot.revision + 1, planning_bindings: clone(message.bindings) as Record<string, string[]> });
  const hass = { user: { is_admin: admin }, states, callWS } as HomeAssistant;
  const card = new HeizlastGrundrissCard(); card.hass = hass; document.body.append(card); await settle(card);
  return { card, hass, callWS };
}
function button(card: HeizlastGrundrissCard, label: string): HTMLButtonElement { return [...card.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")].find((value) => value.textContent!.includes(label))!; }
async function choose(card: HeizlastGrundrissCard, shape: string) { card.shadowRoot!.querySelector<HTMLButtonElement>(`[data-shape="${shape}"]`)!.click(); await settle(card); }
async function check(card: HeizlastGrundrissCard, value: boolean) { const input = card.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!; input.checked = value; input.dispatchEvent(new Event("change", { bubbles: true })); await settle(card); }
afterEach(() => document.body.replaceChildren());

describe("documented floorplan dashboard", () => {
  it("renders only actual EG/OG planning data, separated from absent sensor readings", async () => {
    const { card, callWS } = await mount();
    expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "heizlast_ha/get_project" });
    expect(customElements.get("heizlast-grundriss-card")).toBe(HeizlastGrundrissCard);
    expect(text(card)).toContain("5.989"); expect(text(card)).toContain("7.354,5"); expect(text(card)).toContain("184,1");
    expect(text(card)).toContain("Kein Sensor zugeordnet"); expect(text(card)).not.toContain("21,4");
    expect(text(card)).not.toContain("Spitzboden"); expect(text(card)).not.toContain("Garage");
    expect(card.shadowRoot!.querySelectorAll(".floor-tabs button")).toHaveLength(2); expect(card.shadowRoot!.querySelectorAll(".room-label")).toHaveLength(5);
    expect(card.shadowRoot!.querySelector(".plan svg")!.getAttribute("viewBox")).toBe("0 122 440 400");
    expect(text(card)).toContain("Auslegung innen"); expect(text(card)).toContain("Heizlastberechnung · S. 10 / R5");
    expect(text(card)).not.toContain("Planungswerte und Messwerte werden getrennt angezeigt. Bei mehreren Sensoren wird keine gemeinsame Temperatur abgeleitet.");
  });
  it("shows living, dining and kitchen as one selectable Wohnen und Essen room with the unchanged total load", async () => {
    const { card } = await mount(); expect(card.shadowRoot!.querySelectorAll("polygon.room-shape")).toHaveLength(5);
    expect([...card.shadowRoot!.querySelectorAll(".room-name")].map((label) => label.textContent)).toEqual(["Abstellr.", "HWR", "Dusche/WC", "Diele", "Wohnen und Essen"]);
    await choose(card, "eg_wohnen"); expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Wohnen und Essen");
    expect(card.shadowRoot!.querySelectorAll('.room-label[aria-pressed="true"]')).toHaveLength(1);
    expect(card.shadowRoot!.querySelector(".heat-value")!.textContent).toContain("2.432,3"); expect(text(card)).toContain("56,46 m²");
    expect(card.shadowRoot!.querySelector('[data-shape="eg_essen"], [data-shape="eg_kueche"]')).toBeNull();
    await choose(card, "eg_diele"); expect(card.shadowRoot!.querySelectorAll('.room-label[aria-pressed="true"]')).toHaveLength(1);
    expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Diele"); expect(card.shadowRoot!.querySelector(".heat-value")!.textContent).toContain("613,5");
  });
  it("selects one merged Schlafzimmer, confirmed Bad and the requested upper-floor room names", async () => {
    const { card } = await mount(); button(card, "Obergeschoss").click(); await settle(card);
    expect(card.shadowRoot!.querySelectorAll(".room-label")).toHaveLength(6); await choose(card, "og-schlafzimmer");
    expect(card.shadowRoot!.querySelectorAll("polygon.room-shape.selected")).toHaveLength(1); expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Schlafzimmer");
    expect(card.shadowRoot!.querySelector(".heat-value")!.textContent).toContain("917"); await choose(card, "og-bad");
    expect(card.shadowRoot!.querySelector(".note.warning")).toBeNull(); expect(text(card)).toContain("12,74 m²"); expect(text(card)).toContain("Planfläche unbeschriftet");
    expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Bad"); expect(planningData.shapes.find((shape) => shape.zone === 7)!.area).toBeNull();
    await choose(card, "og-kind-i"); expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Basti");
    await choose(card, "og-kind-ii"); expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Ostzimmer");
  });
  it("updates real readings and handles unknown, unavailable, removed and changed-class entities", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const { card, hass } = await mount(snapshot, true, { "sensor.room": sensor("sensor.room") }); expect(card.shadowRoot!.querySelector(".sensor-reading strong")!.textContent).toBe("20,7 °C");
    for (const [value, expected] of [["22.4", "22,4 °C"], ["unknown", "?"], ["unavailable", "?"]]) {
      card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", value) } }; await settle(card); expect(card.shadowRoot!.querySelector(".sensor-reading strong")!.textContent).toBe(expected);
    }
    card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", "65", "humidity") } }; await settle(card);
    expect(card.shadowRoot!.querySelector(".sensor-reading strong")!.textContent).toBe("?"); expect(text(card)).toContain("Geräteklasse geändert"); expect(text(card)).not.toContain("65 %");
    card.hass = { ...hass, states: {} }; await settle(card); expect(card.shadowRoot!.querySelector(".sensor-reading strong")!.textContent).toBe("?"); expect(text(card)).toContain("entfernt");
  });
  it("shows all three requested values per room and updates labels from HA without inventing current heat loads", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const { card, hass } = await mount(snapshot, true, { "sensor.room": sensor("sensor.room") });
    const label = card.shadowRoot!.querySelector<HTMLButtonElement>('[data-shape="eg_wohnen"]')!;
    expect(label.querySelector(".room-readings")!.textContent).toBe("20,7 °C / 2.432,3 W / ?");
    expect(label.getAttribute("aria-label")).toContain("Wohnen und Essen auswählen · Rechenzone 5");
    expect(label.getAttribute("aria-label")).toContain("Aktuelle Temperatur: 20,7 °C / Berechnete Heizlast: 2.432,3 W / Aktuelle Heizlast: ?");
    expect(label.title).toContain("Aktuelle Heizlast: ?");
    expect(card.shadowRoot!.querySelector('[data-shape="eg_diele"] .room-readings')!.textContent).toBe("? / 613,5 W / ?");
    expect(card.shadowRoot!.querySelector(".readings-legend")!.textContent).toContain("Aktuelle Temperatur / berechnete Heizlast / aktuelle Heizlast");
    card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", "22.4") } }; await settle(card);
    expect(card.shadowRoot!.querySelector('[data-shape="eg_wohnen"] .room-readings')!.textContent).toBe("22,4 °C / 2.432,3 W / ?");
  });
  it("marks the current heating load as an estimate and reacts to both indoor and outdoor temperatures", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const { card, hass, callWS } = await mount(snapshot, false, { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor() });
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 2.432 W");
    expect(card.shadowRoot!.querySelector('[data-shape="eg_wohnen"]')!.getAttribute("aria-label")).toContain("Aktuelle Heizlast: ≈ 2.432 W");
    expect(card.shadowRoot!.querySelector(".current-heat-load")!.textContent).toContain("Aktuelle Heizlast: ≈ 2.432 W");
    expect(text(card)).toContain("Schätzung aus Temperaturen und verfügbaren solaren Gewinnen");
    expect(card.shadowRoot!.querySelector(".current-heat-load")!.textContent).toContain("ohne verfügbare Solarkorrektur");
    card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor("4.9") } }; await settle(card);
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 1.216 W");
    card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", "13.45"), "sensor.weather_actual": outsideSensor("4.9") } }; await settle(card);
    expect(livingReadings(card)).toBe("13,5 °C / 2.432,3 W / ≈ 608 W");
    card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor("25") } }; await settle(card);
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 0 W");
    card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor("-29.3") } }; await settle(card);
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 3.648 W");
    expect(callWS).toHaveBeenCalledTimes(1);
  });
  it("calculates mixed Fahrenheit and Kelvin readings while displaying each actual measurement unit", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const room = sensor("sensor.room", "71.6"); room.attributes.unit_of_measurement = "°F";
    const { card } = await mount(snapshot, false, { "sensor.room": room, "sensor.weather_actual": outsideSensor("260.95", "K") });
    expect(livingReadings(card)).toBe("71,6 °F / 2.432,3 W / ≈ 2.432 W");
    expect(card.shadowRoot!.querySelector(".outdoor-temperature strong")!.textContent).toBe("261 K");
  });
  it("waits for saved sensor bindings before estimating the current load", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    let resolveProject!: (project: Project) => void;
    const pending = new Promise<Project>((resolve) => { resolveProject = resolve; });
    const card = new HeizlastGrundrissCard();
    card.hass = { user: { is_admin: false }, states: { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor() }, callWS: async <T>(): Promise<T> => await pending as T };
    document.body.append(card); await settle(card);
    expect(livingReadings(card)).toBe("? / 2.432,3 W / ?");
    expect(text(card)).toContain("Sensorzuordnungen werden geladen");
    resolveProject(snapshot); await settle(card);
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 2.432 W");
  });
  it("requires exactly one available room reading and one unambiguous outdoor reading for an estimate", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const { card, hass } = await mount(snapshot, false, { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor() });
    expect(livingReadings(card)).toContain("≈ 2.432 W");
    const scenarios: Record<string, HassState>[] = [
      { "sensor.room": sensor("sensor.room", "22") },
      { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor("unknown") },
      { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor("-12.2", "%") },
      { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor(), "sensor.second_outdoor": outsideSensor("-12.2", "°C", "sensor.second_outdoor") },
      { "sensor.weather_actual": outsideSensor() },
      { "sensor.room": sensor("sensor.room", "unavailable"), "sensor.weather_actual": outsideSensor() },
      { "sensor.room": sensor("sensor.room", " "), "sensor.weather_actual": outsideSensor() },
      { "sensor.room": sensor("sensor.room", "22", "humidity"), "sensor.weather_actual": outsideSensor() },
    ];
    for (const states of scenarios) {
      card.hass = { ...hass, states }; await settle(card);
      expect(livingReadings(card)!.split(" / ")[2]).toBe("?");
      expect(card.shadowRoot!.querySelector(".current-heat-load")!.textContent).toContain("Aktuelle Heizlast: ?");
    }
  });
  it("keeps the temperature estimate when sunlight is missing and displays sunlight without inventing solar gains", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const states = { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor() };
    const { card, hass } = await mount(snapshot, false, states);
    expect(livingReadings(card)).toContain("≈ 2.432 W");
    expect(card.shadowRoot!.querySelector(".solar-radiation strong")!.textContent).toBe("?");
    expect(card.shadowRoot!.querySelector(".solar-gains")!.textContent).toContain("Solare Gewinne: ?");
    card.hass = { ...hass, states: { ...states, "sensor.sunlight": radiationSensor("500") } }; await settle(card);
    expect(card.shadowRoot!.querySelector(".solar-radiation strong")!.textContent).toBe("500 W/m²");
    expect(livingReadings(card)).toContain("≈ 2.432 W");
    card.hass = { ...hass, states: { ...states, "sensor.sunlight": radiationSensor("700") } }; await settle(card);
    expect(card.shadowRoot!.querySelector(".solar-radiation strong")!.textContent).toBe("700 W/m²");
    expect(livingReadings(card)).toContain("≈ 2.432 W");
    const sunlightScenarios: Record<string, HassState>[] = [
      { "sensor.sunlight": radiationSensor("unknown") },
      { "sensor.sunlight": radiationSensor("-1") },
      { "sensor.sunlight": radiationSensor(), "sensor.other_sunlight": radiationSensor("500", "sensor.other_sunlight") },
    ];
    for (const sunlightStates of sunlightScenarios) {
      card.hass = { ...hass, states: { ...states, ...sunlightStates } }; await settle(card);
      expect(card.shadowRoot!.querySelector(".solar-radiation strong")!.textContent).toBe("?");
      expect(livingReadings(card)).toContain("≈ 2.432 W");
    }
  });
  it("subtracts documented window gains from current losses and updates each facade's contribution", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const states = { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor() };
    const { card, hass } = await mount(snapshot, false, { ...states, "sensor.sunlight": facadeRadiationSensor() });
    // Zone 5 has W 4.1408 m², S 14.9778 m² and E 3.31648 m² whole-window areas.
    // Equal 100 W/m² facade irradiance yields 636.034518 W after the 0.2835 factor.
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 1.796 W");
    expect(card.shadowRoot!.querySelector(".solar-gains")!.textContent).toContain("Solare Gewinne: ≈ 636 W");
    expect(card.shadowRoot!.querySelector(".current-heat-load")!.textContent).toContain("Näherung mit solaren Gewinnen nach EnEV-Annahmen");
    card.hass = { ...hass, states: { ...states, "sensor.sunlight": facadeRadiationSensor(100, 200, 300, 400) } }; await settle(card);
    // Orientation-specific irradiances yield 1931.473026 W solar gains, leaving 500.786974 W.
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 501 W");
    expect(card.shadowRoot!.querySelector(".solar-gains")!.textContent).toContain("Solare Gewinne: ≈ 1.931 W");
    card.hass = { ...hass, states: { ...states, "sensor.sunlight": facadeRadiationSensor(500, 500, 500, 500) } }; await settle(card);
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 0 W");
    expect(card.shadowRoot!.querySelector(".solar-gains")!.textContent).toContain("Solare Gewinne: ≈ 3.180 W");
    const darkness = facadeRadiationSensor(0, 0, 0, 0); darkness.state = "0";
    card.hass = { ...hass, states: { ...states, "sensor.sunlight": darkness } }; await settle(card);
    expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 2.432 W");
    expect(card.shadowRoot!.querySelector(".solar-gains")!.textContent).toContain("Solare Gewinne: ≈ 0 W");
    expect(card.shadowRoot!.querySelector(".current-heat-load")!.textContent).toContain("Näherung mit solaren Gewinnen nach EnEV-Annahmen");
    card.hass = { ...hass, states: { "sensor.weather_actual": outsideSensor(), "sensor.sunlight": facadeRadiationSensor() } }; await settle(card);
    expect(livingReadings(card)).toBe("? / 2.432,3 W / ?");
    expect(card.shadowRoot!.querySelector(".solar-gains")!.textContent).toContain("Solare Gewinne: ≈ 636 W");
  });
  it("falls back to temperature-only losses when facade samples become missing, partial or ambiguous", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const states = { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor() };
    const { card, hass } = await mount(snapshot, false, { ...states, "sensor.sunlight": facadeRadiationSensor() });
    expect(livingReadings(card)).toContain("≈ 1.796 W");
    const partial = facadeRadiationSensor(); delete partial.attributes.facade_south_w_m2;
    const solarScenarios: Record<string, HassState>[] = [
      { "sensor.sunlight": radiationSensor() },
      { "sensor.sunlight": partial },
      { "sensor.sunlight": facadeRadiationSensor(), "sensor.second_sunlight": { ...facadeRadiationSensor(), entity_id: "sensor.second_sunlight" } },
    ];
    for (const sunlightStates of solarScenarios) {
      card.hass = { ...hass, states: { ...states, ...sunlightStates } }; await settle(card);
      expect(livingReadings(card)).toBe("22 °C / 2.432,3 W / ≈ 2.432 W");
      expect(card.shadowRoot!.querySelector(".solar-gains")!.textContent).toContain("Solare Gewinne: ?");
      expect(card.shadowRoot!.querySelector(".current-heat-load")!.textContent).toContain("ohne verfügbare Solarkorrektur");
    }
  });
  it("keeps zero solar gains distinct from missing solar data for a zone without windows", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "8": ["sensor.room"] };
    const { card } = await mount(snapshot, false, { "sensor.room": sensor("sensor.room", "22"), "sensor.weather_actual": outsideSensor() });
    button(card, "Obergeschoss").click(); await settle(card); await choose(card, "og-diele");
    expect(card.shadowRoot!.querySelector('[data-shape="og-diele"] .room-readings')!.textContent).toBe("22 °C / 202,2 W / ≈ 202 W");
    expect(card.shadowRoot!.querySelector(".solar-gains")!.textContent).toContain("Solare Gewinne: ≈ 0 W");
    expect(card.shadowRoot!.querySelector(".solar-radiation strong")!.textContent).toBe("?");
  });
  it("shows multiple real sensor values individually and keeps the shared room summary unknown", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.first", "sensor.second"] };
    const first = sensor("sensor.first", "20"), second = sensor("sensor.second", "71.6"); second.attributes.unit_of_measurement = "°F";
    const { card } = await mount(snapshot, true, { "sensor.first": first, "sensor.second": second, "sensor.weather_actual": outsideSensor() });
    expect([...card.shadowRoot!.querySelectorAll(".sensor-reading strong")].map((reading) => reading.textContent)).toEqual(["20 °C", "71,6 °F"]);
    expect(card.shadowRoot!.querySelector('[data-shape="eg_wohnen"] .room-readings')!.textContent).toBe("? / 2.432,3 W / ?");
    expect(text(card)).not.toContain("Planungswerte und Messwerte werden getrennt angezeigt. Bei mehreren Sensoren wird keine gemeinsame Temperatur abgeleitet.");
  });
  it("keeps complete values and accessible labels on both floors", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "4": ["sensor.room"] };
    const extreme = sensor("sensor.room", "123456789012345"); extreme.attributes.unit_of_measurement = "K";
    const { card } = await mount(snapshot, true, { "sensor.room": extreme });
    const diele = card.shadowRoot!.querySelector<HTMLButtonElement>('[data-shape="eg_diele"]')!;
    expect(diele.querySelector(".room-readings")!.textContent).toBe("123.456.789.012.345 K / 613,5 W / ?");
    expect(diele.getAttribute("aria-label")).toContain("Aktuelle Temperatur: 123.456.789.012.345 K");
    for (const floor of ["Erdgeschoss", "Obergeschoss"]) {
      button(card, floor).click(); await settle(card);
      for (const label of card.shadowRoot!.querySelectorAll<HTMLButtonElement>(".room-label")) {
        expect(label.getAttribute("aria-label")).toContain(`${label.querySelector(".room-name")!.textContent} auswählen`);
        expect(label.querySelector(".room-readings")!.textContent!.split(" / ")).toHaveLength(3);
      }
    }
  });
  it("finds the integration outdoor sensor by role, updates from HA and excludes it from room choices", async () => {
    const outside = sensor("sensor.weather_actual", "8.2"); outside.attributes.heizlast_ha_role = "outdoor_temperature";
    const { card, hass } = await mount(empty(), true, { "sensor.weather_actual": outside, "sensor.room": sensor("sensor.room") });
    expect(card.shadowRoot!.querySelector(".outdoor-temperature strong")!.textContent).toBe("8,2 °C");
    expect(card.shadowRoot!.querySelector('.outdoor-temperature a')!.getAttribute("href")).toBe("https://open-meteo.com/");
    expect(card.shadowRoot!.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    card.hass = { ...hass, states: { "sensor.weather_actual": { ...outside, state: "9.4" } } }; await settle(card);
    expect(card.shadowRoot!.querySelector(".outdoor-temperature strong")!.textContent).toBe("9,4 °C");
    card.hass = { ...hass, states: {} }; await settle(card);
    expect(card.shadowRoot!.querySelector(".outdoor-temperature strong")!.textContent).toBe("?");
  });
  it("persists real sensor assignments for fixed shared zones", async () => {
    const snapshot = empty();
    const { card, callWS } = await mount(snapshot, true, { "sensor.room": sensor("sensor.room"), "sensor.humidity": sensor("sensor.humidity", "55", "humidity") });
    expect(card.shadowRoot!.querySelectorAll('input[type="checkbox"]')).toHaveLength(1); await check(card, true); await choose(card, "eg_diele"); await choose(card, "eg_wohnen");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true); button(card, "Zuordnungen speichern").click(); await settle(card);
    expect(callWS).toHaveBeenLastCalledWith({ type: "heizlast_ha/save_planning_bindings", revision: 4, bindings: { "5": ["sensor.room"] } });
    expect(text(card)).toContain("in Home Assistant gespeichert"); expect(text(card)).not.toContain("Ungespeicherte Sensorzuordnungen");
    await check(card, false); button(card, "Zuordnungen speichern").click(); await settle(card);
    expect(callWS).toHaveBeenLastCalledWith({ type: "heizlast_ha/save_planning_bindings", revision: 5, bindings: { "5": [] } });
  });
  it("shows readonly sensor values without assignment controls", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] }; const { card, callWS } = await mount(snapshot, false, { "sensor.room": sensor("sensor.room") });
    expect(text(card)).toContain("20,7 °C"); expect(text(card)).toContain("Leserechten"); expect(card.shadowRoot!.querySelector('input[type="checkbox"]')).toBeNull();
    expect(text(card)).not.toContain("Temperatursensoren zuordnen"); await choose(card, "eg_abstell"); expect(callWS).toHaveBeenCalledTimes(1);
  });
  it("reloads after a revision conflict and retries with the current revision", async () => {
    const { card, callWS } = await mount(empty(), true, { "sensor.room": sensor("sensor.room") }); await check(card, true); callWS.mockRejectedValueOnce({ code: "conflict" });
    button(card, "Zuordnungen speichern").click(); await settle(card); expect(text(card)).toContain("zwischenzeitlich geändert"); expect(card.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    callWS.mockResolvedValueOnce({ ...empty(), revision: 9 }); button(card, "Aktuelle Zuordnungen laden").click(); await settle(card);
    expect(text(card)).not.toContain("zwischenzeitlich geändert"); expect(card.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    await check(card, true); button(card, "Zuordnungen speichern").click(); await settle(card);
    expect(callWS).toHaveBeenLastCalledWith({ type: "heizlast_ha/save_planning_bindings", revision: 9, bindings: { "5": ["sensor.room"] } });
  });
  it("retains the draft after failed save and keeps source data visible when loading fails", async () => {
    const { card, callWS } = await mount(empty(), true, { "sensor.room": sensor("sensor.room") }); await check(card, true); callWS.mockRejectedValueOnce(new Error("offline"));
    button(card, "Zuordnungen speichern").click(); await settle(card); expect(text(card)).toContain("nicht gespeichert"); expect(card.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    button(card, "Zuordnungen speichern").click(); await settle(card); expect(text(card)).toContain("in Home Assistant gespeichert");
    const failed = new HeizlastGrundrissCard(); failed.hass = { states: {}, user: { is_admin: true }, callWS: vi.fn().mockRejectedValue(new Error("offline")) }; document.body.append(failed); await settle(failed);
    expect(text(failed)).toContain("Planungsdaten bleiben sichtbar"); expect(failed.shadowRoot!.querySelector(".heat-value")).not.toBeNull(); expect(failed.shadowRoot!.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
