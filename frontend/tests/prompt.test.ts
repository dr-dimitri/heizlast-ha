import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schemas/floorplan-v1.schema.json";
import { validatePlan } from "../src/validation";
import { buildPrompt, copyPrompt, promptRequirements } from "../src/prompt";
import { temperatureLabel, temperatureSensors } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

describe("LLM prompt", () => {
  it("generates a prompt without an image and the exact import schema with no placeholders", () => {
    const prompt = buildPrompt("eg", "Erdgeschoss");
    for (const value of ["1000", "1.1", "Erdgeschoss", '"eg"', JSON.stringify(schema, null, 2)]) expect(prompt).toContain(value);
    expect(prompt).not.toContain("{{"); expect(prompt).toContain("Nur ein Formatbeispiel"); expect(prompt).toContain("area_m2");
    expect(prompt).not.toContain("Die LLM-Antwort ist ein Vorschlag");
    expect(prompt).not.toContain("Prüfe anschließend im Dashboard");
    expect(prompt).not.toContain("Für Anzeige, Korrekturen und Sensorzuordnungen genügt danach das JSON");
  });
  it("escapes interpolated metadata and bounds the generated example IDs", () => {
    const prompt = buildPrompt("a".repeat(64), 'Etage "oben"\nNoch eine Zeile');
    expect(prompt).toContain('"Etage \\"oben\\"\\nNoch eine Zeile"');
    const sampleText = prompt.split("zu ersetzen:\n")[1];
    expect(JSON.parse(sampleText).floors[0].rooms[0].id.length).toBeLessThanOrEqual(64);
  });
  it("produces a schema-valid standalone example without a background", () => {
    const prompt = buildPrompt("eg", "Erdgeschoss");
    const example = JSON.parse(prompt.split("zu ersetzen:\n")[1]);
    expect(validatePlan(example).ok).toBe(true);
    expect(example.floors[0]).not.toHaveProperty("background");
    expect(prompt).toContain("ursprüngliche Grundriss");
    expect(prompt).toContain("längere Seite auf 1000");
  });
  it("explains missing or invalid prerequisites before generating a prompt", () => {
    expect(promptRequirements("", " ").length).toBe(2); expect(() => buildPrompt("invalid id", "Etage")).toThrow();
  });
  it("confirms clipboard success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyPrompt("Prompt")).toBe(true); expect(writeText).toHaveBeenCalledWith("Prompt");
  });
  it("supports manual copying when clipboard is absent or denied", async () => {
    vi.stubGlobal("navigator", {}); expect(await copyPrompt("Prompt")).toBe(false);
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } }); expect(await copyPrompt("Prompt")).toBe(false);
  });
});

describe("Temperature display", () => {
  const state = (value: string, unit = "°C") => ({ entity_id: "sensor.temperature", state: value, attributes: { device_class: "temperature", unit_of_measurement: unit } });
  it("renders values independently using their original units", () => { expect(temperatureLabel(state("21.4"))).toBe("21,4 °C"); expect(temperatureLabel(state("70", "°F"))).toBe("70 °F"); });
  it("distinguishes unknown, unavailable, removed, invalid and missing units", () => {
    expect(temperatureLabel(state("unknown"))).toBe("Wert unbekannt"); expect(temperatureLabel(state("unavailable"))).toBe("Nicht verfügbar"); expect(temperatureLabel()).toBe("Entität entfernt"); expect(temperatureLabel(state("n/a"))).toBe("Ungültiger Messwert"); expect(temperatureLabel(state(""))).toBe("Ungültiger Messwert"); expect(temperatureLabel(state("21", ""))).toContain("Einheit fehlt");
  });
  it("offers only actual sensor entities with temperature device class", () => {
    const good = state("21");
    const list = temperatureSensors({ states: { "sensor.temperature": good, "sensor.humidity": { ...good, entity_id: "sensor.humidity", attributes: { device_class: "humidity" } }, "climate.room": { ...good, entity_id: "climate.room" } }, async callWS<T>(): Promise<T> { return {} as T; } });
    expect(list.map((entity) => entity.entity_id)).toEqual(["sensor.temperature"]);
  });
});
