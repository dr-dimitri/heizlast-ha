import schema from "../../schemas/floorplan-v1.schema.json";
import { type ImageMetadata } from "./types";

export function promptRequirements(image: ImageMetadata | undefined, floorId: string, floorName: string): string[] {
  const missing = [];
  if (!image) missing.push("Bitte zuerst ein Grundrissbild auswählen oder hochladen.");
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(floorId)) missing.push("Etagen-ID: 1–64 Zeichen, beginnend mit einem Kleinbuchstaben; anschließend Kleinbuchstaben, Zahlen, _ oder -.");
  if (!floorName.trim()) missing.push("Bitte einen Etagenname eintragen.");
  if (floorName.length > 120) missing.push("Der Etagenname darf höchstens 120 Zeichen lang sein.");
  return missing;
}

export function buildPrompt(image: ImageMetadata, floorId: string, floorName: string): string {
  const missing = promptRequirements(image, floorId, floorName);
  if (missing.length) throw new Error(missing.join(" "));
  const sample = {
    schema_version: "1.0",
    floors: [{
      id: floorId, name: floorName.trim(), background: image.background,
      canvas: { width: image.width, height: image.height },
      rooms: [{ id: `${floorId.slice(0, 50)}_raum_1`, name: "Raum 1", polygon: [[image.width * 0.1, image.height * 0.1], [image.width * 0.4, image.height * 0.1], [image.width * 0.4, image.height * 0.4], [image.width * 0.1, image.height * 0.4]], area_m2: null }],
    }],
  };
  return `Analysiere den beigefügten Grundriss und beschreibe die sichtbaren Räume der Etage als JSON entsprechend dem vollständigen Schema unten.

Verbindliche Angaben (exakt übernehmen):
- schema_version: 1.0
- Etagen-ID: ${JSON.stringify(floorId)}
- Etagenname: ${JSON.stringify(floorName.trim())}
- Hintergrundreferenz: ${JSON.stringify(image.background)}
- Bildbreite: ${image.width} Pixel
- Bildhöhe: ${image.height} Pixel

Regeln:
1. Verwende exakt die angegebenen Etagen- und Bildangaben und beschreibe nur diese Etage.
2. Jeder Raum erhält eine stabile, eindeutige ID, Name, Polygon und area_m2. Alle Etagen- und Raum-IDs müssen gemeinsam über alle Etagen eindeutig sein. IDs beginnen mit einem Kleinbuchstaben und enthalten nur Kleinbuchstaben, Zahlen, _ und - (höchstens 64 Zeichen).
3. Koordinaten beziehen sich auf das unveränderte Originalbild: Ursprung oben links, x nach rechts, y nach unten. Verändere weder Ausschnitt noch Ausrichtung. Alle Zahlen müssen endlich und alle Punkte innerhalb der angegebenen Bildabmessungen sein.
4. Zeichne Raumflächen entlang ihrer inneren Begrenzungen. Polygone haben mindestens drei unterschiedliche Punkte und werden implizit geschlossen: den ersten Punkt am Ende NICHT wiederholen. Sie dürfen sich nicht selbst überschneiden oder selbst berühren. Verschiedene Raumflächen dürfen sich nicht flächig überlappen.
5. Übernimm lesbare Raumnamen. Fehlt ein Name, verwende eine neutrale Bezeichnung wie "Raum 1". Erfinde keine verdeckten Räume oder Bauteile.
6. Übernimm area_m2 ausschließlich aus einer eindeutig lesbaren, diesem Raum zugeordneten positiven Flächenangabe. Andernfalls null. Ohne bestätigten Maßstab keine Quadratmeter aus Pixelkoordinaten berechnen.
7. Erzeuge keine Sensor-IDs, Temperaturen oder Heizlastwerte.
8. Antworte ausschließlich mit einem JSON-Objekt, ohne Markdown-Codeblock, Kommentare oder Erklärungstext.

Verbindliches vollständiges JSON-Schema:
${JSON.stringify(schema, null, 2)}

Nur ein Formatbeispiel – keine erkannten Räume oder realen Raumgrenzen. Die Beispielpunkte und der Beispielraum sind durch die tatsächlichen Räume des beigefügten Bildes zu ersetzen:
${JSON.stringify(sample, null, 2)}

Die LLM-Antwort ist ein Vorschlag und muss anschließend im Dashboard über dem Originalbild visuell geprüft werden.`;
}

export async function copyPrompt(prompt: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try { await navigator.clipboard.writeText(prompt); return true; }
  catch { return false; }
}
