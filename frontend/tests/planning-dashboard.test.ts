import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { planningData } from "../src/planning-types";
import { clone, type HassState, type HomeAssistant, type Project } from "../src/types";

const sensor = (id: string, value = "20.7", deviceClass = "temperature"): HassState => ({ entity_id: id, state: value, attributes: { device_class: deviceClass, unit_of_measurement: deviceClass === "temperature" ? "°C" : "%", friendly_name: "Raumsensor" } });
const empty = (): Project => ({ revision: 4, plan: null, bindings: {}, planning_bindings: {} });
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
    expect(card.shadowRoot!.querySelectorAll(".floor-tabs button")).toHaveLength(2); expect(card.shadowRoot!.querySelectorAll(".room-label")).toHaveLength(8);
    expect(card.shadowRoot!.querySelector(".plan svg")!.getAttribute("viewBox")).toBe("0 122 440 400");
    expect(text(card)).toContain("Auslegung innen"); expect(text(card)).toContain("Heizlastberechnung · S. 10 / R5");
  });
  it("keeps living spaces and hall/garderobe as shared zones without invented contours or divided loads", async () => {
    const { card } = await mount(); expect(card.shadowRoot!.querySelectorAll("polygon.room-shape")).toHaveLength(5);
    for (const shape of ["eg_wohnen", "eg_essen", "eg_kueche"]) {
      await choose(card, shape); expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Wohnen/Essen/Küche");
      expect(card.shadowRoot!.querySelectorAll('.room-label[aria-pressed="true"]')).toHaveLength(3);
      expect(card.shadowRoot!.querySelector(".heat-value")!.textContent).toContain("2.432,3"); expect(text(card)).toContain("Gemeinsame Rechenzone für Wohnen + Essen + Küche");
    }
    await choose(card, "eg_diele"); expect(card.shadowRoot!.querySelectorAll('.room-label[aria-pressed="true"]')).toHaveLength(2);
    expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Gard./Diele"); expect(card.shadowRoot!.querySelector(".heat-value")!.textContent).toContain("613,5");
  });
  it("selects both sleeping polygons and marks the unconfirmed Bad assignment", async () => {
    const { card } = await mount(); button(card, "Obergeschoss").click(); await settle(card);
    expect(card.shadowRoot!.querySelectorAll(".room-label")).toHaveLength(7); await choose(card, "og-ankleide");
    expect(card.shadowRoot!.querySelectorAll("polygon.room-shape.selected")).toHaveLength(2); expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toBe("Schlafen/Ankleide");
    expect(card.shadowRoot!.querySelector(".heat-value")!.textContent).toContain("917"); await choose(card, "og-sanitaer-unbenannt");
    expect(card.shadowRoot!.querySelector(".note.warning")!.textContent).toContain("unbeschriftet"); expect(text(card)).toContain("12,74 m²"); expect(text(card)).toContain("Planfläche unbeschriftet");
    expect(card.shadowRoot!.querySelector("aside h2")!.textContent).toContain("Bad ?"); expect(planningData.shapes.find((shape) => shape.zone === 7)!.area).toBeNull();
  });
  it("updates real readings and handles unknown, unavailable, removed and changed-class entities", async () => {
    const snapshot = empty(); snapshot.planning_bindings = { "5": ["sensor.room"] };
    const { card, hass } = await mount(snapshot, true, { "sensor.room": sensor("sensor.room") }); expect(card.shadowRoot!.querySelector(".sensor-reading strong")!.textContent).toBe("20,7 °C");
    for (const [value, expected] of [["22.4", "22,4 °C"], ["unknown", "Wert unbekannt"], ["unavailable", "Nicht verfügbar"]]) {
      card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", value) } }; await settle(card); expect(card.shadowRoot!.querySelector(".sensor-reading strong")!.textContent).toBe(expected);
    }
    card.hass = { ...hass, states: { "sensor.room": sensor("sensor.room", "65", "humidity") } }; await settle(card);
    expect(card.shadowRoot!.querySelector(".sensor-reading strong")!.textContent).toBe("Kein Temperatursensor mehr"); expect(text(card)).not.toContain("65 %");
    card.hass = { ...hass, states: {} }; await settle(card); expect(card.shadowRoot!.querySelector(".sensor-reading strong")!.textContent).toBe("Entität entfernt");
  });
  it("persists real sensor assignments for shared zones while retaining the generic project", async () => {
    const snapshot = empty(); snapshot.plan = { schema_version: "1.1", floors: [{ id: "f", name: "Etage", canvas: { width: 100, height: 100 }, rooms: [] }] }; snapshot.bindings = { old: ["sensor.old"] };
    const { card, callWS } = await mount(snapshot, true, { "sensor.room": sensor("sensor.room"), "sensor.humidity": sensor("sensor.humidity", "55", "humidity") });
    expect(card.shadowRoot!.querySelectorAll('input[type="checkbox"]')).toHaveLength(1); await check(card, true); await choose(card, "eg_essen");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true); button(card, "Zuordnungen speichern").click(); await settle(card);
    expect(callWS).toHaveBeenLastCalledWith({ type: "heizlast_ha/save_planning_bindings", revision: 4, bindings: { "5": ["sensor.room"] } });
    expect(text(card)).toContain("in Home Assistant gespeichert"); expect(text(card)).not.toContain("Ungespeicherte Sensorzuordnungen");
    expect(snapshot.plan.floors[0].id).toBe("f"); expect(snapshot.bindings.old).toEqual(["sensor.old"]);
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
