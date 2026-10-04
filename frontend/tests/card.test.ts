import { afterEach, describe, expect, it, vi } from "vitest";
import sample from "../../examples/ground-floor.json";
import { HeizlastHaCard } from "../src/card";
import { clone, type Floorplan, type HomeAssistant, type Project } from "../src/types";

const empty = (): Project => ({ revision: 0, plan: null, bindings: {}, images: [{ background: sample.floors[0].background, name: "ground-floor.png", width: 1200, height: 800, mime: "image/png" }] });
const existing = (): Project => ({ ...empty(), revision: 7, plan: clone(sample) as Floorplan, bindings: { eg_wohnzimmer: ["sensor.a", "sensor.removed"] } });
const state = (value = "21.4") => ({ entity_id: "sensor.a", state: value, attributes: { friendly_name: "Raumsensor", device_class: "temperature", unit_of_measurement: "°C" } });
const flush = async (card: HeizlastHaCard) => { await card.updateComplete; await new Promise((resolve) => setTimeout(resolve, 0)); await card.updateComplete; };

async function mount(project = existing(), admin = true, rejectSave = false, rejectSign = false) {
  let saved = clone(project);
  const callWS = vi.fn(async (message: Record<string, unknown>) => {
    if (message.type === "heizlast_ha/get_project") return clone(saved);
    if (message.type === "auth/sign_path") { if (rejectSign) throw new Error("Offline"); return { path: "/signed/image" }; }
    if (message.type === "heizlast_ha/save_project") {
      if (rejectSave) throw { code: "conflict", message: "Conflict" };
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
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("Home Assistant card workflow", () => {
  it("loads persisted geometry and renders removed entities without crashing", async () => {
    const { card, callWS } = await mount();
    expect(card.shadowRoot!.querySelectorAll("polygon")).toHaveLength(4);
    expect(card.shadowRoot!.textContent).toContain("21,4 °C"); expect(card.shadowRoot!.textContent).toContain("Entität entfernt");
    expect(callWS).toHaveBeenCalledWith({ type: "auth/sign_path", path: sample.floors[0].background, expires: 3600 });
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
  it("rejects a single-floor import referencing a registered but unselected image", async () => {
    const project = existing(), alternative = "/api/heizlast_ha/images/other-image";
    project.images.push({ ...project.images[0], background: alternative, name: "other.png" });
    const { card, saved, callWS } = await mount(project), before = card.shadowRoot!.querySelector("polygon")!.getAttribute("points");
    const input = clone(sample); input.floors[0].background = alternative;
    await editJson(card, JSON.stringify(input));
    expect(card.shadowRoot!.textContent).toContain("passt nicht zum ausgewählten Bild"); expect(card.shadowRoot!.querySelector("polygon")!.getAttribute("points")).toBe(before); expect(saved().revision).toBe(7);
    expect(callWS.mock.calls.filter(([message]) => message.type === "heizlast_ha/save_project")).toHaveLength(0);
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
  });
  it("does not loop signing requests when auth/sign_path fails", async () => {
    const { card, hass, callWS } = await mount(existing(), true, false, true);
    for (let i = 0; i < 4; i++) { card.hass = { ...hass }; await flush(card); }
    expect(callWS.mock.calls.filter(([message]) => message.type === "auth/sign_path")).toHaveLength(1);
    expect(card.shadowRoot!.textContent).toContain("Grundrissbild konnte nicht geladen");
  });
  it("provides the fully populated prompt, normalized image download and clipboard fallback", async () => {
    const { card } = await mount(empty());
    const select = card.shadowRoot!.querySelector<HTMLSelectElement>("select")!; select.value = sample.floors[0].background; select.dispatchEvent(new Event("change", { bubbles: true })); await flush(card);
    button(card, "LLM-Prompt anzeigen").click(); await flush(card);
    const field = card.shadowRoot!.querySelector<HTMLTextAreaElement>(".prompt-text")!;
    expect(field.value).toContain(sample.floors[0].background); expect(field.value).toContain("1200"); expect(card.shadowRoot!.querySelector("a[download]")).not.toBeNull();
    const writeText = vi.fn().mockRejectedValue(new Error("Unavailable")); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    button(card, "Prompt kopieren").click(); await flush(card);
    expect(writeText).toHaveBeenCalledWith(field.value); expect(field.selectionEnd).toBe(field.value.length); expect(card.shadowRoot!.textContent).toContain("manuell kopieren");
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });
  it("renders each imported floor and retains all floors on save", async () => {
    const { card, saved } = await mount(empty()), input = clone(sample), second = clone(input.floors[0]);
    second.id = "og"; second.name = "Obergeschoss"; second.rooms.forEach((room) => room.id = `og_${room.id}`); input.floors.push(second);
    await editJson(card, JSON.stringify(input)); button(card, "Obergeschoss").click(); await flush(card); expect(card.shadowRoot!.querySelector('.plan-heading')!.textContent).toContain("Obergeschoss");
    button(card, "Import übernehmen").click(); await flush(card); expect(saved().plan!.floors).toHaveLength(2);
  });
});
