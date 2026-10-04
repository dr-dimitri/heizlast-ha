import { afterEach, describe, expect, it, vi } from "vitest";
import sample from "../../examples/ground-floor.json";
import { HeizlastHaCard } from "../src/card";
import { clone, type Floorplan, type HomeAssistant, type Project } from "../src/types";

const empty = (): Project => ({ revision: 0, plan: null, bindings: {} });
const existing = (): Project => ({ ...empty(), revision: 7, plan: clone(sample) as Floorplan, bindings: { eg_wohnzimmer: ["sensor.a", "sensor.removed"] } });
const state = (value = "21.4") => ({ entity_id: "sensor.a", state: value, attributes: { friendly_name: "Raumsensor", device_class: "temperature", unit_of_measurement: "°C" } });
const flush = async (card: HeizlastHaCard) => { await card.updateComplete; await new Promise((resolve) => setTimeout(resolve, 0)); await card.updateComplete; };

async function mount(project = existing(), admin = true, rejectSave = false, saveGate?: Promise<void>) {
  let saved = clone(project);
  const callWS = vi.fn(async (message: Record<string, unknown>) => {
    if (message.type === "heizlast_ha/get_project") return clone(saved);
    if (message.type === "heizlast_ha/save_project") {
      if (rejectSave) throw { code: "conflict", message: "Conflict" };
      await saveGate;
      saved = { ...saved, revision: saved.revision + 1, plan: clone(message.plan) as Floorplan, bindings: clone(message.bindings) as Record<string, string[]> };
      return clone(saved);
    }
    throw new Error("Unexpected request");
  });
  const hass = { user: { is_admin: admin }, states: { "sensor.a": state() }, callWS } as unknown as HomeAssistant;
  const card = new HeizlastHaCard(); card.setConfig({ type: "custom:heizlast-ha-card", title: "Testhaus" }); document.body.append(card); card.hass = hass; await flush(card); await flush(card);
  return { card, hass, callWS, saved: () => saved };
}
function button(card: HeizlastHaCard, text: string): HTMLButtonElement {
  const result = [...card.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text);
  if (!result) throw new Error(`Button not found: ${text}`);
  return result;
}
async function editJson(card: HeizlastHaCard, value: string) {
  if (!card.shadowRoot!.querySelector("textarea.json")) { button(card, "Grundriss einrichten").click(); await flush(card); }
  const textarea = card.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea.json")!; textarea.value = value; textarea.dispatchEvent(new Event("input", { bubbles: true })); await flush(card);
  button(card, "Import prüfen").click(); await flush(card);
}
async function mergeRooms(card: HeizlastHaCard, targetId: string) {
  const select = card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Mit Raum verbinden"]')!;
  select.value = targetId; select.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
  button(card, "Räume verbinden").click(); await flush(card);
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("Home Assistant card workflow", () => {
  it("loads persisted geometry and renders removed entities without crashing", async () => {
    const { card, callWS } = await mount();
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4);
    expect(card.shadowRoot!.textContent).toContain("21,4 °C"); expect(card.shadowRoot!.textContent).toContain("Entität entfernt");
    expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "heizlast_ha/get_project" });
    expect(card.shadowRoot!.querySelector("svg image")).toBeNull();
  });
  it("leaves the displayed plan and all assignments intact after failed import", async () => {
    const { card, callWS } = await mount(), before = card.shadowRoot!.querySelector("polygon")!.getAttribute("points");
    await editJson(card, '{"schema_version":"9.0"}');
    expect(card.shadowRoot!.querySelector("polygon")!.getAttribute("points")).toBe(before);
    expect(card.shadowRoot!.textContent).toContain("Entität entfernt"); expect(callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_project")).toHaveLength(0);
  });
  it("previews JSON text first and saves only after explicit acceptance", async () => {
    const { card, callWS, saved } = await mount(empty());
    await editJson(card, JSON.stringify(sample));
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4); expect(saved().plan).toBeNull();
    button(card, "Import übernehmen").click(); await flush(card);
    expect(saved().plan?.floors).toHaveLength(1); expect(saved().revision).toBe(1); expect(card.shadowRoot!.textContent).toContain("sind gespeichert");
    expect(callWS.mock.calls.find(([message]) => message.type === "heizlast_ha/save_project")?.[0].confirmed_removed_room_ids).toEqual([]);
  });
  it("imports JSON files using the same preview-only validation path", async () => {
    const { card, saved } = await mount(empty());
    const input = card.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="JSON-Datei importieren"]')!;
    Object.defineProperty(input, "files", { value: [{ size: 1000, text: async () => JSON.stringify(sample) }] });
    input.dispatchEvent(new Event("change", { bubbles: true })); await flush(card); await flush(card);
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4); expect(saved().plan).toBeNull(); expect(button(card, "Import übernehmen")).toBeDefined();
  });
  it("keeps bindings when room IDs stay the same, including a reverted preview removal", async () => {
    const { card, saved } = await mount();
    const removed = clone(sample); removed.floors[0].rooms[0].id = "new_living_room";
    await editJson(card, JSON.stringify(removed)); await editJson(card, JSON.stringify(sample));
    button(card, "Import übernehmen").click(); await flush(card);
    expect(saved().bindings.eg_wohnzimmer).toEqual(["sensor.a", "sensor.removed"]);
  });
  it("requires confirmation for every removed room ID and sends those exact IDs", async () => {
    const { card, callWS } = await mount();
    const changed = clone(sample); changed.floors[0].rooms[0].id = "new_living_room"; changed.floors[0].rooms[1].id = "new_kitchen";
    await editJson(card, JSON.stringify(changed)); button(card, "Import übernehmen").click(); await flush(card);
    expect(card.shadowRoot!.querySelector('[aria-label="Entfernte Räume bestätigen"]')).not.toBeNull();
    expect(card.shadowRoot!.textContent).toContain("sensor.removed");
    expect(callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_project")).toHaveLength(0);
    button(card, "Entfernung bestätigen & speichern").click(); await flush(card);
    const message = callWS.mock.calls.find(([message]) => message.type === "heizlast_ha/save_project")![0];
    expect(message.confirmed_removed_room_ids).toEqual(["eg_wohnzimmer", "eg_kueche"]); expect(message.bindings).toEqual({});
  });
  it("persists corrected room names, point changes, added points and removed points", async () => {
    const { card, saved } = await mount(); button(card, "Raumgrenzen korrigieren").click(); await flush(card);
    const name = card.shadowRoot!.querySelector<HTMLInputElement>("aside input[maxlength='120']")!; name.value = "Wohnen"; name.dispatchEvent(new Event("input", { bubbles: true })); await flush(card);
    const x = card.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Punkt 1 x"]')!; x.value = "66"; x.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    card.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Nach Punkt 1 hinzufügen"]')!.click(); await flush(card); expect(card.shadowRoot!.querySelectorAll(".point")).toHaveLength(5);
    card.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Punkt 2 entfernen"]')!.click(); await flush(card);
    button(card, "Änderungen speichern").click(); await flush(card);
    expect(saved().plan!.floors[0].rooms[0].name).toBe("Wohnen"); expect(saved().plan!.floors[0].rooms[0].polygon[0][0]).toBe(66); expect(saved().plan!.floors[0].rooms[0].polygon).toHaveLength(4);
  });
  it("merges imported rooms before acceptance while preserving the selected identity and known area", async () => {
    const { card, callWS, saved } = await mount(empty()), input = clone(sample) as Floorplan;
    input.floors[0].rooms[0].area_m2 = 30; input.floors[0].rooms[1].area_m2 = 12.5;
    await editJson(card, JSON.stringify(input));
    expect(card.shadowRoot!.textContent).toContain("Räume bearbeiten");
    await mergeRooms(card, "eg_kueche");
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(3);
    expect(card.shadowRoot!.querySelector(".room-title")!.textContent).toBe("Wohnzimmer");
    expect(card.shadowRoot!.textContent).toContain("42,5 m²"); expect(saved().plan).toBeNull();
    button(card, "Import übernehmen").click(); await flush(card);
    expect(saved().plan!.floors[0].rooms.map((room) => room.id)).toEqual(["eg_wohnzimmer", "eg_flur", "eg_bad"]);
    expect(saved().plan!.floors[0].rooms[0]).toMatchObject({ name: "Wohnzimmer", area_m2: 42.5 });
    expect(saved().plan!.floors[0].rooms[0].polygon).not.toEqual(input.floors[0].rooms[0].polygon);
    expect(callWS.mock.calls.find(([message]) => message.type === "heizlast_ha/save_project")![0].confirmed_removed_room_ids).toEqual([]);
  });
  it("transfers and deduplicates sensors during a merge and confirms only the removed persisted identity", async () => {
    const project = existing(); project.plan!.floors[0].rooms[1].area_m2 = 12.5;
    project.bindings.eg_kueche = ["sensor.a", "sensor.kitchen"];
    const { card, callWS, saved } = await mount(project);
    await mergeRooms(card, "eg_kueche");
    expect(card.shadowRoot!.textContent).toContain("sensor.kitchen"); expect(card.shadowRoot!.textContent).toContain("Fläche nicht bestätigt");
    button(card, "Änderungen speichern").click(); await flush(card);
    expect(card.shadowRoot!.querySelector('[aria-label="Entfernte Räume bestätigen"]')).not.toBeNull();
    expect(callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_project")).toHaveLength(0);
    button(card, "Entfernung bestätigen & speichern").click(); await flush(card);
    expect(saved().bindings).toEqual({ eg_wohnzimmer: ["sensor.a", "sensor.removed", "sensor.kitchen"] });
    expect(saved().plan!.floors[0].rooms[0].area_m2).toBeNull();
    expect(callWS.mock.calls.find(([message]) => message.type === "heizlast_ha/save_project")![0].confirmed_removed_room_ids).toEqual(["eg_kueche"]);
  });
  it("deletes an imported unsaved room, selects the next room and saves without a removal confirmation", async () => {
    const { card, callWS, saved } = await mount(empty());
    await editJson(card, JSON.stringify(sample)); button(card, "Raum löschen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(3);
    expect(card.shadowRoot!.querySelector(".room-title")!.textContent).toBe("Küche"); expect(saved().plan).toBeNull();
    button(card, "Import übernehmen").click(); await flush(card);
    expect(saved().plan!.floors[0].rooms.some((room) => room.id === "eg_wohnzimmer")).toBe(false);
    expect(card.shadowRoot!.querySelector('[aria-label="Entfernte Räume bestätigen"]')).toBeNull();
    expect(callWS.mock.calls.find(([message]) => message.type === "heizlast_ha/save_project")![0].confirmed_removed_room_ids).toEqual([]);
  });
  it("saves an empty floor after deleting its last persisted room and removes that room's bindings", async () => {
    const project = existing(); project.plan!.floors[0].rooms = project.plan!.floors[0].rooms.slice(0, 1);
    const { card, callWS, saved } = await mount(project);
    button(card, "Raum löschen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(0); expect(card.shadowRoot!.querySelector(".room-title")).toBeNull();
    expect(card.shadowRoot!.querySelector('.plan-heading')!.textContent).toContain("Erdgeschoss");
    button(card, "Änderungen speichern").click(); await flush(card); button(card, "Entfernung bestätigen & speichern").click(); await flush(card);
    expect(saved().plan!.floors[0].rooms).toEqual([]); expect(saved().bindings).toEqual({});
    expect(callWS.mock.calls.find(([message]) => message.type === "heizlast_ha/save_project")![0].confirmed_removed_room_ids).toEqual(["eg_wohnzimmer"]);
  });
  it("discards room merges and deletions and restores the persisted geometry and sensor assignments", async () => {
    const project = existing(); project.bindings.eg_kueche = ["sensor.kitchen"];
    const { card, callWS, saved } = await mount(project);
    await mergeRooms(card, "eg_kueche"); button(card, "Raum löschen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(2);
    button(card, "Änderungen verwerfen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4); expect(card.shadowRoot!.textContent).toContain("sensor.removed");
    button(card, "Küche").click(); await flush(card); expect(card.shadowRoot!.textContent).toContain("sensor.kitchen");
    expect(saved()).toEqual(project); expect(callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_project")).toHaveLength(0);
    await editJson(card, JSON.stringify(sample)); await mergeRooms(card, "eg_kueche"); button(card, "Vorschau verwerfen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4); expect(card.shadowRoot!.textContent).toContain("sensor.removed");
  });
  it("limits merge choices to the selected floor and rejects a forged target from another floor", async () => {
    const project = existing(), upper = clone(project.plan!.floors[0]);
    upper.id = "og"; upper.name = "Obergeschoss"; upper.rooms = upper.rooms.slice(0, 1); upper.rooms[0].id = "og_room"; project.plan!.floors.push(upper);
    const { card, callWS, saved } = await mount(project);
    const select = card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Mit Raum verbinden"]')!;
    expect([...select.options].map((option) => option.value).filter(Boolean)).toEqual(["eg_kueche", "eg_flur", "eg_bad"]);
    const forged = document.createElement("option"); forged.value = "og_room"; select.append(forged); select.value = forged.value;
    select.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    button(card, "Räume verbinden").dispatchEvent(new Event("click", { bubbles: true })); await flush(card);
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4);
    button(card, "Obergeschoss").click(); await flush(card); expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(1);
    expect(saved()).toEqual(project); expect(callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_project")).toHaveLength(0);
  });
  it("keeps the draft unchanged when a merge would cross a third room", async () => {
    const project = existing(), floor = project.plan!.floors[0]; floor.canvas = { width: 1200, height: 800 };
    floor.rooms = [
      { id: "left", name: "Links", polygon: [[100, 100], [500, 100], [500, 500], [100, 500]], area_m2: null },
      { id: "right", name: "Rechts", polygon: [[520, 100], [920, 100], [920, 500], [520, 500]], area_m2: null },
      { id: "between", name: "Dazwischen", polygon: [[500, 200], [520, 200], [520, 400], [500, 400]], area_m2: null },
    ]; project.bindings = { left: ["sensor.a"], right: ["sensor.removed"] };
    const { card, saved } = await mount(project), before = [...card.shadowRoot!.querySelectorAll("polygon")].map((polygon) => polygon.getAttribute("points"));
    await mergeRooms(card, "right");
    expect([...card.shadowRoot!.querySelectorAll("polygon")].map((polygon) => polygon.getAttribute("points"))).toEqual(before);
    expect(card.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull(); expect(saved()).toEqual(project);
    expect(card.shadowRoot!.querySelector(".room-title")!.textContent).toBe("Links");
    expect(card.shadowRoot!.querySelector("aside")!.textContent).not.toContain("sensor.removed");
  });
  it("disables room editing while saving and guards direct events against changing the in-flight draft", async () => {
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const { card, saved } = await mount(existing(), true, false, gate);
    await mergeRooms(card, "eg_kueche"); button(card, "Änderungen speichern").click(); await flush(card);
    button(card, "Entfernung bestätigen & speichern").click(); await flush(card);
    const select = card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Mit Raum verbinden"]')!;
    expect(select.disabled).toBe(true); expect(button(card, "Räume verbinden").disabled).toBe(true); expect(button(card, "Raum löschen").disabled).toBe(true);
    select.value = "eg_flur"; select.dispatchEvent(new Event("change", { bubbles: true }));
    button(card, "Räume verbinden").dispatchEvent(new Event("click", { bubbles: true })); button(card, "Raum löschen").dispatchEvent(new Event("click", { bubbles: true })); await flush(card);
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(3);
    releaseSave(); await flush(card); await flush(card);
    expect(saved().plan!.floors[0].rooms.map((room) => room.id)).toEqual(["eg_wohnzimmer", "eg_flur", "eg_bad"]);
  });
  it("preserves form edits while live sensor values update", async () => {
    const { card, hass } = await mount(); button(card, "Grundriss einrichten").click(); await flush(card);
    const name = card.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Etagenname"]')!; name.value = "Neue Etage"; name.dispatchEvent(new Event("input", { bubbles: true })); await flush(card);
    const json = card.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea.json")!; json.value = "Angefangene Eingabe"; json.dispatchEvent(new Event("input", { bubbles: true })); await flush(card);
    card.hass = { ...hass, states: { "sensor.a": state("unavailable") } }; await flush(card);
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Etagenname"]')!.value).toBe("Neue Etage"); expect(card.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea.json")!.value).toBe("Angefangene Eingabe"); expect(card.shadowRoot!.textContent).toContain("Nicht verfügbar");
  });
  it("explains and restores a cleared coordinate field without changing geometry", async () => {
    const { card, saved } = await mount(); button(card, "Raumgrenzen korrigieren").click(); await flush(card);
    const field = card.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Punkt 1 x"]')!, before = field.value;
    field.value = ""; field.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    expect(field.value).toBe(before); expect(card.shadowRoot!.textContent).toContain("letzte gültige Koordinate"); expect(saved().plan!.floors[0].rooms[0].polygon[0][0]).toBe(Number(before));
  });
  it("keeps edits after a revision conflict and offers recovery", async () => {
    const { card, saved } = await mount(existing(), true, true);
    await editJson(card, JSON.stringify(sample)); button(card, "Import übernehmen").click(); await flush(card);
    expect(card.shadowRoot!.textContent).toContain("zwischenzeitlich geändert"); expect(button(card, "Änderungen sichern")).toBeDefined(); expect(button(card, "Aktuelle Version laden")).toBeDefined(); expect(saved().revision).toBe(7); expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4);
  });
  it("is read-only for non-admin users while keeping rooms and live readings", async () => {
    const { card } = await mount(existing(), false);
    expect(card.shadowRoot!.textContent).toContain("Administratorrechte"); expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4); expect(card.shadowRoot!.textContent).toContain("21,4 °C"); expect(card.shadowRoot!.querySelector("input[type=checkbox]")).toBeNull(); expect([...card.shadowRoot!.querySelectorAll("button")].some((element) => element.textContent?.includes("korrigieren"))).toBe(false);
    expect(card.shadowRoot!.querySelector('select[aria-label="Mit Raum verbinden"]')).toBeNull();
    expect([...card.shadowRoot!.querySelectorAll("button")].some((element) => ["Räume verbinden", "Raum löschen"].includes(element.textContent?.trim() ?? ""))).toBe(false);
  });
  it("opens and copies the prompt without uploading any image, including clipboard fallback", async () => {
    const { card, callWS } = await mount(empty());
    expect(card.shadowRoot!.querySelector('input[aria-label="Grundrissbild hochladen"]')).toBeNull();
    button(card, "LLM-Prompt anzeigen").click(); await flush(card);
    const field = card.shadowRoot!.querySelector<HTMLTextAreaElement>(".prompt-text")!;
    expect(field.value).toContain("1.1"); expect(field.value).toContain("Erdgeschoss"); expect(card.shadowRoot!.querySelector("a[download]")).toBeNull();
    expect(field.value).not.toContain("Die LLM-Antwort ist ein Vorschlag."); expect(field.value).not.toContain("Für Anzeige, Korrekturen und Sensorzuordnungen genügt danach das JSON.");
    expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "heizlast_ha/get_project" });
    const writeText = vi.fn().mockRejectedValue(new Error("Unavailable")); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    button(card, "Prompt kopieren").click(); await flush(card);
    expect(writeText).toHaveBeenCalledWith(field.value); expect(field.selectionEnd).toBe(field.value.length); expect(card.shadowRoot!.textContent).toContain("manuell kopieren");
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });
  it("loads the example locally and saves it without image requests", async () => {
    const { card, callWS, saved } = await mount(empty());
    button(card, "Beispiel laden").click(); await vi.waitFor(() => expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4));
    await flush(card); button(card, "Import übernehmen").click(); await flush(card);
    expect(saved().plan?.schema_version).toBe("1.1");
    expect(callWS.mock.calls.map(([message]) => message.type)).toEqual(["heizlast_ha/get_project", "heizlast_ha/save_project"]);
  });
  it("renders each imported floor and retains all floors on save", async () => {
    const { card, saved } = await mount(empty()), input = clone(sample), second = clone(input.floors[0]);
    second.id = "og"; second.name = "Obergeschoss"; second.rooms.forEach((room) => room.id = `og_${room.id}`); input.floors.push(second);
    await editJson(card, JSON.stringify(input)); button(card, "Obergeschoss").click(); await flush(card); expect(card.shadowRoot!.querySelector('.plan-heading')!.textContent).toContain("Obergeschoss");
    button(card, "Import übernehmen").click(); await flush(card); expect(saved().plan!.floors).toHaveLength(2);
  });
});
