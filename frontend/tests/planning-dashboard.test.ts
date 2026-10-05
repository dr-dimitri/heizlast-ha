import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { planningData } from "../src/planning-types";
import { clone, type HassState, type HomeAssistant, type Project } from "../src/types";

const sensor = (id: string, value = "20.7", deviceClass = "temperature"): HassState => ({ entity_id: id, state: value, attributes: { device_class: deviceClass, unit_of_measurement: deviceClass === "temperature" ? "°C" : "%", friendly_name: "Raumsensor" } });
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
    expect(card.shadowRoot!.querySelectorAll(".floor-tabs button")).toHaveLength(2); expect(card.shadowRoot!.querySelectorAll(".room-label")).toHaveLength(7);
    expect(card.shadowRoot!.querySelector(".plan svg")!.getAttribute("viewBox")).toBe("0 122 440 400");
    expect(text(card)).toContain("Auslegung innen"); expect(text(card)).toContain("Heizlastberechnung · S. 10 / R5");
  });
  it("keeps living spaces shared and displays the merged Diele with its complete documented load", async () => {
    const { card } = await mount(); expect(card.shadowRoot!.querySelectorAll("polygon.room-shape")).toHaveLength(5);
    for (const shape of ["eg_wohnen", "eg_essen", "eg_kueche"]) {
      await choose(card, shape); expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Wohnen/Essen/Küche");
      expect(card.shadowRoot!.querySelectorAll('.room-label[aria-pressed="true"]')).toHaveLength(3);
      expect(card.shadowRoot!.querySelector(".heat-value")!.textContent).toContain("2.432,3"); expect(text(card)).toContain("Gemeinsame Rechenzone für Wohnen + Essen + Küche");
    }
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
    for (const shape of ["eg_wohnen", "eg_essen", "eg_kueche"]) {
      const label = card.shadowRoot!.querySelector<HTMLButtonElement>(`[data-shape="${shape}"]`)!;
      expect(label.querySelector(".room-readings")!.textContent).toBe("20,7 °C / 2.432,3 W / ?");
      expect(label.getAttribute("aria-label")).toContain("Aktuelle Temperatur: 20,7 °C / Berechnete Heizlast: 2.432,3 W / Aktuelle Heizlast: ?");
      expect(label.title).toContain("Aktuelle Heizlast: ?");
    }
    expect(card.shadowRoot!.querySelector('[data-shape="eg_diele"] .room-readings')!.textContent).toBe("? / 613,5 W / ?");
    expect(card.shadowRoot!.querySelector(".readings-legend")!.textContent).toContain("Aktuelle Temperatur / berechnete Heizlast / aktuelle Heizlast");
    card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", "22.4") } }; await settle(card);
    expect(card.shadowRoot!.querySelector('[data-shape="eg_essen"] .room-readings')!.textContent).toBe("22,4 °C / 2.432,3 W / ?");
  });
  it("shows multiple real sensor values individually and keeps the shared room summary unknown", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.first", "sensor.second"] };
    const first = sensor("sensor.first", "20"), second = sensor("sensor.second", "71.6"); second.attributes.unit_of_measurement = "°F";
    const { card } = await mount(snapshot, true, { "sensor.first": first, "sensor.second": second });
    expect([...card.shadowRoot!.querySelectorAll(".sensor-reading strong")].map((reading) => reading.textContent)).toEqual(["20 °C", "71,6 °F"]);
    expect(card.shadowRoot!.querySelector('[data-shape="eg_wohnen"] .room-readings')!.textContent).toBe("? / 2.432,3 W / ?");
    expect(text(card)).toContain("keine gemeinsame Temperatur abgeleitet");
  });
  it("fits complete label rows in fixed plan-coordinate boxes without viewport-dependent pixel sizes", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "4": ["sensor.room"] };
    const extreme = sensor("sensor.room", "123456789012345"); extreme.attributes.unit_of_measurement = "K";
    const { card } = await mount(snapshot, true, { "sensor.room": extreme });
    for (const floor of ["Erdgeschoss", "Obergeschoss"]) {
      button(card, floor).click(); await settle(card);
      for (const box of card.shadowRoot!.querySelectorAll("foreignObject.room-label-box")) {
        const label = box.querySelector<HTMLButtonElement>("button")!;
        const shape = planningData.shapes.find((shape) => shape.key === label.dataset.shape)!;
        expect(Number(box.getAttribute("x"))).toBe(shape.center[0] - shape.label_box[0] / 2);
        expect(Number(box.getAttribute("y"))).toBe(shape.center[1] - shape.label_box[1] / 2);
        expect(Number(box.getAttribute("width"))).toBe(shape.label_box[0]); expect(Number(box.getAttribute("height"))).toBe(shape.label_box[1]);
        expect(label.style.position).toBe("");
        for (const row of label.querySelectorAll("text")) {
          expect(Number(row.getAttribute("textLength"))).toBeLessThanOrEqual(shape.label_box[0] - 12);
          expect(row.getAttribute("lengthAdjust")).toBe("spacingAndGlyphs");
        }
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
    expect(card.shadowRoot!.querySelectorAll('input[type="checkbox"]')).toHaveLength(1); await check(card, true); await choose(card, "eg_essen");
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
