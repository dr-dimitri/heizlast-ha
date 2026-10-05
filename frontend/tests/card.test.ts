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
async function editJson(card: HeizlastHaCard, value: string, enterRooms = true) {
  if (!card.shadowRoot!.querySelector("textarea.json")) { button(card, "Grundriss einrichten").click(); await flush(card); }
  const textarea = card.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea.json")!; textarea.value = value; textarea.dispatchEvent(new Event("input", { bubbles: true })); await flush(card);
  button(card, "Import prüfen").click(); await flush(card);
  if (enterRooms && card.shadowRoot!.querySelector('.editor-progress [aria-current="step"]')?.textContent?.includes("Geschosse")) await step(card, 2);
}
async function mergeRooms(card: HeizlastHaCard, targetId: string) {
  const select = card.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Mit Raum verbinden"]')!;
  select.value = targetId; select.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
  button(card, "Räume verbinden").click(); await flush(card);
}
async function step(card: HeizlastHaCard, index: number) {
  card.shadowRoot!.querySelectorAll<HTMLButtonElement>(".editor-progress button")[index].click(); await flush(card);
}
async function openEditor(card: HeizlastHaCard) {
  button(card, "Grundriss bearbeiten").click(); await flush(card);
}
async function field(card: HeizlastHaCard, label: string, value: string, event = "change") {
  const input = card.shadowRoot!.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  if (!input) throw new Error(`Field not found: ${label}`);
  input.value = value; input.dispatchEvent(new Event(event, { bubbles: true })); await flush(card);
}
async function drawing(card: HeizlastHaCard, points: number[][]) {
  for (const [index, point] of points.entries()) {
    button(card, "Punkt hinzufügen").click(); await flush(card);
    await field(card, `Zeichenpunkt ${index + 1} x`, String(point[0]), "input");
    await field(card, `Zeichenpunkt ${index + 1} y`, String(point[1]), "input");
  }
}
async function openDetails(card: HeizlastHaCard, label: string): Promise<HTMLDetailsElement> {
  const summary = [...card.shadowRoot!.querySelectorAll<HTMLElement>("summary")].find((element) => element.textContent?.trim() === label);
  if (!summary) throw new Error(`Summary not found: ${label}`);
  const details = summary.closest("details")!;
  if (!details.open) { summary.click(); await flush(card); }
  return details;
}
function sensorCheckbox(card: HeizlastHaCard, entityId: string): HTMLInputElement {
  const label = [...card.shadowRoot!.querySelectorAll(".sensor-select label")].find((element) => element.textContent?.includes(entityId));
  if (!label) throw new Error(`Sensor not found: ${entityId}`);
  return label.querySelector<HTMLInputElement>("input")!;
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

describe("Variant A room editor", () => {
  it("uses the same five-step editor after blank creation and JSON import without saving either source", async () => {
    const blank = await mount(empty());
    expect([...blank.card.shadowRoot!.querySelectorAll(".editor-progress button")].map((element) => element.textContent?.trim())).toEqual(["1 Quelle", "2 Geschosse", "3 Räume", "4 Sensoren", "5 Prüfen"]);
    button(blank.card, "Neuen Grundriss erstellen").click(); await flush(blank.card);
    expect(blank.card.shadowRoot!.querySelector('.editor-progress [aria-current="step"]')!.textContent).toContain("Geschosse");
    await field(blank.card, "Geschossname", "Erdgeschoss"); button(blank.card, "Geschoss anlegen").click(); await flush(blank.card);
    await step(blank.card, 2);
    expect(blank.card.shadowRoot!.querySelector(".editor-layout")).not.toBeNull();
    expect(blank.card.shadowRoot!.querySelectorAll(".editor-tool")).toHaveLength(5);
    expect(blank.card.shadowRoot!.querySelectorAll(".room-shape")).toHaveLength(0);
    const imported = await mount(empty()); await editJson(imported.card, JSON.stringify(sample), false);
    expect(imported.card.shadowRoot!.querySelector('.editor-progress [aria-current="step"]')!.textContent).toContain("Geschosse");
    await step(imported.card, 2);
    expect(imported.card.shadowRoot!.querySelector(".editor-layout")).not.toBeNull();
    expect(imported.card.shadowRoot!.querySelectorAll(".editor-tool")).toHaveLength(5);
    expect(imported.card.shadowRoot!.querySelector(".room-title")!.textContent).toBe("Wohnzimmer");
    expect(blank.saved().plan).toBeNull(); expect(imported.saved().plan).toBeNull();
    expect(blank.callWS.mock.calls.map(([message]) => message.type)).toEqual(["heizlast_ha/get_project"]);
    expect(imported.callWS.mock.calls.map(([message]) => message.type)).toEqual(["heizlast_ha/get_project"]);
  });

  it("creates a complete two-floor plan with a rectangle, polygon and sensor through visible forms", async () => {
    const { card, saved, callWS } = await mount(empty());
    button(card, "Neuen Grundriss erstellen").click(); await flush(card); button(card, "Geschoss anlegen").click(); await flush(card); await step(card, 2);
    button(card, "Rechteck").click(); await flush(card); await field(card, "Name des neuen Raums", "Arbeitszimmer", "input");
    await drawing(card, [[100, 100], [400, 400]]); button(card, "Raum fertigstellen").click(); await flush(card);
    await openDetails(card, "Temperatursensoren zuordnen");
    const sensor = card.shadowRoot!.querySelector<HTMLInputElement>(".sensor-select input")!; sensor.checked = true; sensor.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    button(card, "Polygon").click(); await flush(card); await field(card, "Name des neuen Raums", "Küche", "input");
    await drawing(card, [[500, 100], [800, 100], [700, 350]]); button(card, "Raum fertigstellen").click(); await flush(card);
    card.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Geschoss hinzufügen"]')!.click(); await flush(card);
    await field(card, "Geschossname", "Obergeschoss"); await step(card, 2);
    button(card, "Rechteck").click(); await flush(card); await field(card, "Name des neuen Raums", "Schlafzimmer", "input");
    await drawing(card, [[100, 100], [600, 500]]); button(card, "Raum fertigstellen").click(); await flush(card);
    await step(card, 3); await step(card, 1); await step(card, 4);
    expect(card.shadowRoot!.textContent).toContain("2 Geschosse · 3 Räume · 1 Sensorzuordnungen"); expect(saved().plan).toBeNull();
    button(card, "Änderungen speichern").click(); await flush(card);
    const floors = saved().plan!.floors;
    expect(floors.map((floor) => floor.name)).toEqual(["Erdgeschoss", "Obergeschoss"]);
    expect(floors[0].rooms.map((room) => room.name)).toEqual(["Arbeitszimmer", "Küche"]);
    expect(floors[1].rooms[0].name).toBe("Schlafzimmer");
    expect(floors[0].rooms[0].area_m2).toBeNull(); expect(floors[0].rooms[1].polygon).toHaveLength(3);
    expect(saved().bindings[floors[0].rooms[0].id]).toEqual(["sensor.a"]);
    expect(callWS.mock.calls.find(([message]) => message.type === "heizlast_ha/save_project")![0].confirmed_removed_room_ids).toEqual([]);
  });

  it("draws a rectangle by dragging and allows one undo and redo for the completed room", async () => {
    vi.stubGlobal("DOMPoint", class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
    const { card, saved } = await mount(empty());
    button(card, "Neuen Grundriss erstellen").click(); await flush(card); button(card, "Geschoss anlegen").click(); await flush(card); await step(card, 2);
    button(card, "Rechteck").click(); await flush(card); await field(card, "Name des neuen Raums", "Wohnen", "input");
    const svg = card.shadowRoot!.querySelector<SVGSVGElement>(".plan-svg")!;
    Object.defineProperty(svg, "getScreenCTM", { configurable: true, value: () => ({ inverse: () => ({}) }) });
    const pointer = async (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }); Object.defineProperty(event, "pointerId", { value: 1 }); svg.dispatchEvent(event); await flush(card);
    };
    await pointer("pointerdown", 100, 100); await pointer("pointermove", 200, 250); await pointer("pointermove", 400, 400); await pointer("pointerup", 400, 400);
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 400, clientY: 400 })); await flush(card);
    button(card, "Raum fertigstellen").click(); await flush(card);
    expect(card.shadowRoot!.querySelector(".room-shape")!.getAttribute("points")).toBe("100,100 400,100 400,400 100,400");
    button(card, "Rückgängig").click(); await flush(card); expect(card.shadowRoot!.querySelectorAll(".room-shape")).toHaveLength(0);
    button(card, "Wiederholen").click(); await flush(card); expect(card.shadowRoot!.querySelectorAll(".room-shape")).toHaveLength(1); expect(card.shadowRoot!.querySelector(".room-title")!.textContent).toBe("Wohnen");
    expect(saved().plan).toBeNull();
  });

  it("keeps the first rectangle corner when a second touch tap crosses a snap threshold with one-pixel jitter", async () => {
    vi.stubGlobal("DOMPoint", class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
    const { card, saved } = await mount(empty());
    button(card, "Neuen Grundriss erstellen").click(); await flush(card); button(card, "Geschoss anlegen").click(); await flush(card); await step(card, 2);
    button(card, "Rechteck").click(); await flush(card);
    const svg = card.shadowRoot!.querySelector<SVGSVGElement>(".plan-svg")!;
    Object.defineProperty(svg, "getScreenCTM", { configurable: true, value: () => ({ inverse: () => ({}) }) });
    const touch = async (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "touch" } });
      svg.dispatchEvent(event); await flush(card);
    };
    const tap = async (start: number, end: number) => {
      await touch("pointerdown", start, start); await touch("pointermove", end, end); await touch("pointerup", end, end);
      svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: end, clientY: end })); await flush(card);
    };
    await tap(100, 101);
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Zeichenpunkt 1 x"]')!.value).toBe("100");
    // On the 1000-unit canvas, 408.2 snaps to 400 but 409.2 snaps to 416.67.
    await tap(408.2, 409.2);
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Zeichenpunkt 1 x"]')!.value).toBe("100");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Zeichenpunkt 2 x"]')!.value).toBe("416.67");
    button(card, "Raum fertigstellen").click(); await flush(card);
    expect(card.shadowRoot!.querySelector(".room-shape")!.getAttribute("points")).toBe("100,100 416.67,100 416.67,416.67 100,416.67");
    expect(saved().plan).toBeNull();
  });

  it("restores rejected finite room coordinates, area and canvas dimensions in their visible fields", async () => {
    const project = existing(); project.plan!.floors[0].rooms[0].area_m2 = 28.4;
    const { card, saved, callWS } = await mount(project); await openEditor(card);
    const before = [...card.shadowRoot!.querySelectorAll(".room-shape")].map((element) => element.getAttribute("points"));
    await openDetails(card, "Raumgrenzen korrigieren"); await field(card, "Punkt 1 x", "2000");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Punkt 1 x"]')!.value).toBe("110");
    expect(card.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    await field(card, "Fläche in m²", "-2");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Fläche in m²"]')!.value).toBe("28.4");
    expect([...card.shadowRoot!.querySelectorAll(".room-shape")].map((element) => element.getAttribute("points"))).toEqual(before);
    await step(card, 1); await field(card, "Zeichenfläche Breite", "900");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Zeichenfläche Breite"]')!.value).toBe("1200");
    expect(card.shadowRoot!.querySelector(".plan-svg")!.getAttribute("viewBox")).toBe("0 0 1200 800");
    expect([...card.shadowRoot!.querySelectorAll(".room-shape")].map((element) => element.getAttribute("points"))).toEqual(before);
    expect([...card.shadowRoot!.querySelectorAll("button")].some((element) => element.textContent?.trim() === "Änderungen speichern")).toBe(false);
    expect(saved()).toEqual(project); expect(callWS.mock.calls.map(([message]) => message.type)).toEqual(["heizlast_ha/get_project"]);
  });

  it.each([false, true])("preserves the next uncommitted room coordinate during a preceding coordinate render (editor: %s)", async (editor) => {
    const { card, saved } = await mount();
    if (editor) { await openEditor(card); await openDetails(card, "Raumgrenzen korrigieren"); }
    else { button(card, "Raumgrenzen korrigieren").click(); await flush(card); }
    const x = card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Punkt 1 x"]')!;
    const y = card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Punkt 1 y"]')!;
    x.value = "100"; x.dispatchEvent(new Event("change", { bubbles: true }));
    y.value = "120"; y.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(card);
    expect(y.value).toBe("120");
    y.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    button(card, "Änderungen speichern").click(); await flush(card);
    expect(saved().plan!.floors[0].rooms[0].polygon[0]).toEqual([100, 120]);
  });

  it.each([false, true])("preserves a pending floor name while Home Assistant states update (blank: %s)", async (blank) => {
    const { card, hass, saved } = await mount(blank ? empty() : existing());
    if (blank) { button(card, "Neuen Grundriss erstellen").click(); await flush(card); }
    else { await openEditor(card); await step(card, 1); }
    const name = card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Geschossname"]')!;
    name.value = "Wohnebene"; name.dispatchEvent(new Event("input", { bubbles: true }));
    card.hass = { ...hass, states: { "sensor.a": state("22.1") } }; await flush(card);
    expect(name.value).toBe("Wohnebene");
    name.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    if (blank) { button(card, "Geschoss anlegen").click(); await flush(card); }
    expect(card.shadowRoot!.querySelector(".editor-floor")!.textContent).toBe("Wohnebene");
    expect(saved().plan).toEqual(blank ? null : sample);
  });

  it("undoes geometry and sensor changes all the way to the clean saved baseline", async () => {
    const project = existing(), { card, saved, callWS } = await mount(project); await openEditor(card);
    const original = card.shadowRoot!.querySelector(".room-shape")!.getAttribute("points");
    await openDetails(card, "Raumgrenzen korrigieren"); await field(card, "Punkt 1 x", "100");
    const changed = card.shadowRoot!.querySelector(".room-shape")!.getAttribute("points"); expect(changed).not.toBe(original);
    await openDetails(card, "Temperatursensoren zuordnen");
    const assigned = sensorCheckbox(card, "sensor.a"); assigned.checked = false; assigned.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    expect(sensorCheckbox(card, "sensor.a").checked).toBe(false);
    button(card, "Rückgängig").click(); await flush(card);
    expect(sensorCheckbox(card, "sensor.a").checked).toBe(true); expect(card.shadowRoot!.querySelector(".room-shape")!.getAttribute("points")).toBe(changed);
    expect(button(card, "Änderungen speichern").disabled).toBe(false);
    button(card, "Rückgängig").click(); await flush(card);
    expect(card.shadowRoot!.querySelector(".room-shape")!.getAttribute("points")).toBe(original); expect(sensorCheckbox(card, "sensor.a").checked).toBe(true);
    expect(card.shadowRoot!.querySelector(".editor-footer")!.textContent).toContain("Gespeicherter Stand");
    expect(card.shadowRoot!.textContent).not.toContain("Ungespeicherte Änderungen");
    expect([...card.shadowRoot!.querySelectorAll("button")].some((element) => element.textContent?.trim() === "Änderungen speichern")).toBe(false);
    expect(button(card, "Rückgängig").disabled).toBe(true); expect(button(card, "Wiederholen").disabled).toBe(false);
    expect(saved()).toEqual(project); expect(callWS.mock.calls.map(([message]) => message.type)).toEqual(["heizlast_ha/get_project"]);
  });

  it("resets a zoomed and panned canvas to a valid whole-floor view on undo and redo", async () => {
    const { card, saved } = await mount(); await openEditor(card); await step(card, 1); await field(card, "Zeichenfläche Breite", "2400"); await step(card, 2);
    for (let index = 0; index < 7; index++) { card.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Vergrößern"]')!.click(); await flush(card); }
    for (let index = 0; index < 4; index++) { card.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Ansicht nach Rechts"]')!.click(); await flush(card); }
    const zoomed = card.shadowRoot!.querySelector(".plan-svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    expect(zoomed[0]).toBeGreaterThan(1200); expect(zoomed[2]).toBe(600);
    button(card, "Rückgängig").click(); await flush(card);
    expect(card.shadowRoot!.querySelector(".plan-svg")!.getAttribute("viewBox")).toBe("0 0 1200 800");
    expect(card.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Verkleinern"]')!.disabled).toBe(true);
    button(card, "Wiederholen").click(); await flush(card);
    expect(card.shadowRoot!.querySelector(".plan-svg")!.getAttribute("viewBox")).toBe("0 0 2400 800"); expect(saved().plan).toEqual(sample);
  });

  it("rejects an overlapping drawn room and cancel leaves all existing geometry and bindings unchanged", async () => {
    const { card, saved } = await mount(); await openEditor(card);
    const before = [...card.shadowRoot!.querySelectorAll(".room-shape")].map((element) => element.getAttribute("points"));
    button(card, "Rechteck").click(); await flush(card); await drawing(card, [[200, 200], [400, 400]]);
    button(card, "Raum fertigstellen").click(); await flush(card);
    expect(card.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain("überlappen");
    expect([...card.shadowRoot!.querySelectorAll(".room-shape")].map((element) => element.getAttribute("points"))).toEqual(before);
    button(card, "Abbrechen").click(); await flush(card);
    expect(card.shadowRoot!.querySelector(".room-title")!.textContent).toBe("Wohnzimmer"); expect(card.shadowRoot!.textContent).toContain("sensor.removed");
    expect(saved()).toEqual(existing());
    expect([...card.shadowRoot!.querySelectorAll("button")].some((element) => element.textContent?.trim() === "Änderungen speichern")).toBe(false);
  });

  it("renames, reorders and removes a new floor without changing persisted room IDs or their sensors", async () => {
    const { card, saved } = await mount(); await openEditor(card);
    card.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Geschoss hinzufügen"]')!.click(); await flush(card);
    await field(card, "Geschossname", "Obergeschoss"); button(card, "Nach oben").click(); await flush(card);
    expect([...card.shadowRoot!.querySelectorAll(".editor-floor")].map((element) => element.textContent)).toEqual(["Obergeschoss", "Erdgeschoss"]);
    button(card, "Geschoss löschen").click(); await flush(card);
    expect(card.shadowRoot!.querySelector('[aria-label="Geschoss löschen"][role="dialog"]')).not.toBeNull();
    button(card, "Abbrechen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll(".editor-floor")).toHaveLength(2);
    button(card, "Geschoss löschen").click(); await flush(card); button(card, "Geschoss entfernen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll(".editor-floor")).toHaveLength(1);
    button(card, "Rückgängig").click(); await flush(card); expect(card.shadowRoot!.querySelectorAll(".editor-floor")).toHaveLength(2);
    button(card, "Wiederholen").click(); await flush(card); expect(card.shadowRoot!.querySelectorAll(".editor-floor")).toHaveLength(1);
    expect(card.shadowRoot!.querySelector(".editor-footer")!.textContent).toContain("Gespeicherter Stand");
    expect([...card.shadowRoot!.querySelectorAll("button")].some((element) => element.textContent?.trim() === "Änderungen speichern")).toBe(false);
    expect(saved().plan).toEqual(sample); expect(saved().bindings).toEqual(existing().bindings);
  });

  it("confirms deletion of the last floor, can undo it and saves an explicitly confirmed empty project", async () => {
    const { card, saved, callWS } = await mount(); await openEditor(card); await step(card, 1);
    button(card, "Geschoss löschen").click(); await flush(card); button(card, "Geschoss entfernen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll(".editor-floor")).toHaveLength(0);
    expect(card.shadowRoot!.querySelector('.editor-progress [aria-current="step"]')!.textContent).toContain("Geschosse");
    expect(saved().plan).toEqual(sample);
    button(card, "Rückgängig").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll(".room-shape")).toHaveLength(4); await step(card, 2); expect(card.shadowRoot!.textContent).toContain("sensor.removed");
    button(card, "Wiederholen").click(); await flush(card); button(card, "Änderungen speichern").click(); await flush(card);
    expect(callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_project")).toHaveLength(0);
    button(card, "Entfernung bestätigen & speichern").click(); await flush(card);
    expect(saved().plan).toBeNull(); expect(saved().bindings).toEqual({});
    expect(callWS.mock.calls.find(([message]) => message.type === "heizlast_ha/save_project")![0].confirmed_removed_room_ids).toEqual(["eg_wohnzimmer", "eg_kueche", "eg_flur", "eg_bad"]);
  });

  it("previews and cancels splitting, then saves named parts with deliberate sensor distribution and one operation", async () => {
    const { card, saved, callWS } = await mount(); await openEditor(card);
    button(card, "Raum teilen").click(); await flush(card); await drawing(card, [[350, 110], [350, 690]]);
    button(card, "Teilung prüfen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll(".split-preview")).toHaveLength(2);
    expect(card.shadowRoot!.querySelectorAll(".room-shape")).toHaveLength(4);
    button(card, "Abbrechen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll(".split-preview")).toHaveLength(0); expect(card.shadowRoot!.textContent).toContain("sensor.removed");
    button(card, "Raum teilen").click(); await flush(card); await drawing(card, [[350, 110], [350, 690]]); button(card, "Teilung prüfen").click(); await flush(card);
    await field(card, "Name erster Teilraum", "Wohnen links", "input"); await field(card, "Name zweiter Teilraum", "Wohnen rechts", "input");
    await field(card, "Ursprüngliche ID behalten", "smaller");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Name erster Teilraum"]')!.value).toBe("Wohnen links");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Name zweiter Teilraum"]')!.value).toBe("Wohnen rechts");
    await field(card, "Ursprüngliche ID behalten", "larger");
    expect(card.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Name erster Teilraum"]')!.value).toBe("Wohnen links");
    await field(card, "Sensorverteilung sensor.a", "both"); await field(card, "Sensorverteilung sensor.removed", "created");
    button(card, "Teilung übernehmen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll(".room-shape")).toHaveLength(5);
    button(card, "Rückgängig").click(); await flush(card); expect(card.shadowRoot!.querySelectorAll(".room-shape")).toHaveLength(4);
    expect(card.shadowRoot!.querySelector(".room-title")!.textContent).toBe("Wohnzimmer"); expect(card.shadowRoot!.textContent).toContain("sensor.removed");
    button(card, "Wiederholen").click(); await flush(card); button(card, "Änderungen speichern").click(); await flush(card);
    const rooms = saved().plan!.floors[0].rooms, created = rooms.find((room) => room.name === "Wohnen rechts")!;
    expect(rooms.find((room) => room.id === "eg_wohnzimmer")!).toMatchObject({ name: "Wohnen links", area_m2: null }); expect(created.area_m2).toBeNull();
    expect(saved().bindings.eg_wohnzimmer).toEqual(["sensor.a"]); expect(saved().bindings[created.id]).toEqual(["sensor.a", "sensor.removed"]);
    const message = callWS.mock.calls.find(([value]) => value.type === "heizlast_ha/save_project")![0];
    expect(message.confirmed_removed_room_ids).toEqual([]);
    expect(message.room_operations).toEqual([expect.objectContaining({ kind: "split", source_room_id: "eg_wohnzimmer", created_room_id: created.id })]);
  });

  it("never reuses a deleted split child's ID in a later split operation", async () => {
    const { card, saved, callWS } = await mount(); await openEditor(card);
    button(card, "Raum teilen").click(); await flush(card); await drawing(card, [[300, 110], [300, 690]]); button(card, "Teilung prüfen").click(); await flush(card);
    await field(card, "Name zweiter Teilraum", "Temporärer Teil", "input"); button(card, "Teilung übernehmen").click(); await flush(card);
    button(card, "Temporärer Teil").click(); await flush(card); button(card, "Raum löschen").click(); await flush(card);
    expect(card.shadowRoot!.querySelectorAll(".room-shape")).toHaveLength(4);
    button(card, "Wohnzimmer").click(); await flush(card); button(card, "Raum teilen").click(); await flush(card);
    await drawing(card, [[445, 110], [445, 690]]); button(card, "Teilung prüfen").click(); await flush(card);
    await field(card, "Name zweiter Teilraum", "Zweiter Teil", "input"); button(card, "Teilung übernehmen").click(); await flush(card);
    button(card, "Änderungen speichern").click(); await flush(card);
    const message = callWS.mock.calls.find(([value]) => value.type === "heizlast_ha/save_project")![0];
    const operations = message.room_operations as { kind: string; source_room_id: string; created_room_id: string }[];
    expect(operations).toHaveLength(2); expect(operations.map((operation) => operation.kind)).toEqual(["split", "split"]);
    expect(operations.map((operation) => operation.source_room_id)).toEqual(["eg_wohnzimmer", "eg_wohnzimmer"]);
    expect(new Set(operations.map((operation) => operation.created_room_id)).size).toBe(2);
    const rooms = saved().plan!.floors[0].rooms;
    expect(rooms.some((room) => room.id === operations[0].created_room_id)).toBe(false);
    expect(rooms.find((room) => room.id === operations[1].created_room_id)!.name).toBe("Zweiter Teil");
    expect(saved().bindings.eg_wohnzimmer).toEqual(existing().bindings.eg_wohnzimmer);
    expect(message.confirmed_removed_room_ids).toEqual([]);
  });

  it("keeps all four rapidly entered split coordinates before blur and previews the valid cut", async () => {
    const { card, saved, callWS } = await mount(); await openEditor(card);
    button(card, "Raum teilen").click(); await flush(card);
    button(card, "Punkt hinzufügen").click(); await flush(card); button(card, "Punkt hinzufügen").click(); await flush(card);
    const entries = [["Zeichenpunkt 1 x", "320"], ["Zeichenpunkt 1 y", "110"], ["Zeichenpunkt 2 x", "320"], ["Zeichenpunkt 2 y", "690"]];
    for (const [label, value] of entries) {
      const input = card.shadowRoot!.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await flush(card);
    for (const [label, value] of entries) expect(card.shadowRoot!.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.value).toBe(value);
    expect(card.shadowRoot!.querySelectorAll(".split-preview")).toHaveLength(2);
    expect(card.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    button(card, "Teilung übernehmen").click(); await flush(card); button(card, "Änderungen speichern").click(); await flush(card);
    const rooms = saved().plan!.floors[0].rooms;
    expect(rooms).toHaveLength(5);
    expect(rooms.find((room) => room.id === "eg_wohnzimmer")!.polygon).toEqual([[320, 110], [590, 110], [590, 690], [320, 690]]);
    const message = callWS.mock.calls.find(([value]) => value.type === "heizlast_ha/save_project")![0];
    expect(message.room_operations).toEqual([expect.objectContaining({ kind: "split", source_room_id: "eg_wohnzimmer", retained_polygon: [[320, 110], [590, 110], [590, 690], [320, 690]] })]);
  });

  it("keeps the sensor picker collapsed in room editing and opens it in the sensor step", async () => {
    const { card, callWS } = await mount(); await openEditor(card);
    const summary = [...card.shadowRoot!.querySelectorAll("summary")].find((element) => element.textContent === "Temperatursensoren zuordnen")!;
    expect(summary.closest("details")!.open).toBe(false);
    await openDetails(card, "Temperatursensoren zuordnen"); expect(summary.closest("details")!.open).toBe(true);
    summary.click(); await flush(card); expect(summary.closest("details")!.open).toBe(false);
    await step(card, 3);
    expect([...card.shadowRoot!.querySelectorAll("summary")].find((element) => element.textContent === "Temperatursensoren zuordnen")!.closest("details")!.open).toBe(true);
    expect(sensorCheckbox(card, "sensor.a").checked).toBe(true);
    await step(card, 2);
    expect([...card.shadowRoot!.querySelectorAll("summary")].find((element) => element.textContent === "Temperatursensoren zuordnen")!.closest("details")!.open).toBe(false);
    expect(callWS.mock.calls.map(([message]) => message.type)).toEqual(["heizlast_ha/get_project"]);
  });

  it("filters new temperature choices while preserving assigned missing and changed entities", async () => {
    const { card, hass, saved } = await mount(); await openEditor(card);
    card.hass = { ...hass, states: { "sensor.a": { ...state(), attributes: { friendly_name: "Geänderter Sensor", device_class: "humidity", unit_of_measurement: "%" } }, "sensor.other": { ...state("19.2"), entity_id: "sensor.other", attributes: { friendly_name: "Küchensensor", device_class: "temperature", unit_of_measurement: "°C" } }, "sensor.humidity": { ...state("40"), entity_id: "sensor.humidity", attributes: { device_class: "humidity", unit_of_measurement: "%" } } } }; await flush(card);
    await openDetails(card, "Temperatursensoren zuordnen");
    await field(card, "Temperatursensor suchen", "Küche", "input");
    const labels = [...card.shadowRoot!.querySelectorAll(".sensor-select label")];
    expect(labels).toHaveLength(3); expect(labels.map((label) => label.textContent).join(" ")).toContain("sensor.other"); expect(labels.map((label) => label.textContent).join(" ")).not.toContain("sensor.humidity");
    const added = labels.find((label) => label.textContent?.includes("sensor.other"))!.querySelector<HTMLInputElement>("input")!; added.checked = true; added.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    button(card, "Rückgängig").click(); await flush(card);
    const undone = [...card.shadowRoot!.querySelectorAll(".sensor-select label")];
    expect(undone.find((label) => label.textContent?.includes("sensor.a"))!.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    expect(undone.find((label) => label.textContent?.includes("sensor.other"))!.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
    button(card, "Wiederholen").click(); await flush(card); button(card, "Änderungen speichern").click(); await flush(card);
    expect(saved().bindings.eg_wohnzimmer).toEqual(["sensor.a", "sensor.removed", "sensor.other"]);
  });
});
