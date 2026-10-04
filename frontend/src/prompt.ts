import schema from "../../schemas/floorplan-v1.schema.json";

export function promptRequirements(floorId: string, floorName: string): string[] {
  const missing = [];
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(floorId)) missing.push("Etagen-ID: 1–64 Zeichen, beginnend mit einem Kleinbuchstaben; anschließend Kleinbuchstaben, Zahlen, _ oder -.");
  if (!floorName.trim()) missing.push("Bitte einen Etagennamen eintragen.");
  if (floorName.length > 120) missing.push("Der Etagenname darf höchstens 120 Zeichen lang sein.");
  return missing;
}

export function buildPrompt(floorId: string, floorName: string): string {
  const missing = promptRequirements(floorId, floorName);
  if (missing.length) throw new Error(missing.join(" "));
  const sample = {
    schema_version: "1.1",
    floors: [{
      id: floorId, name: floorName.trim(),
      canvas: { width: 1000, height: 800 },
      rooms: [{ id: `${floorId.slice(0, 50)}_raum_1`, name: "Raum 1", polygon: [[100, 100], [400, 100], [400, 400], [100, 400]], area_m2: null }],
    }],
  };
  return `Analysiere den beigefügten Grundriss und erstelle daraus einen eigenständigen digitalen Grundriss der sichtbaren Räume als JSON entsprechend dem vollständigen Schema unten. Das JSON muss alle Informationen für die spätere Darstellung enthalten; der ursprüngliche Grundriss wird dafür nicht gespeichert oder als Referenz benötigt.

Verbindliche Angaben (exakt übernehmen):
- schema_version: 1.1
- Etagen-ID: ${JSON.stringify(floorId)}
- Etagenname: ${JSON.stringify(floorName.trim())}

Regeln:
1. Verwende exakt die angegebenen Etagenangaben und beschreibe nur diese Etage.
2. Jeder Raum erhält eine stabile, eindeutige ID, Name, Polygon und area_m2. Alle Etagen- und Raum-IDs müssen gemeinsam über alle Etagen eindeutig sein. IDs beginnen mit einem Kleinbuchstaben und enthalten nur Kleinbuchstaben, Zahlen, _ und - (höchstens 64 Zeichen).
3. Lege eine eigenständige Zeichenfläche in canvas mit ganzzahliger Breite und Höhe an. Setze die längere Seite auf 1000 Einheiten und bestimme die kürzere Seite proportional zum Seitenverhältnis des Grundrisses (mindestens 1). Übertrage alle Raumgrenzen in diese Koordinaten: Ursprung oben links, x nach rechts, y nach unten. Erhalte die sichtbare Anordnung, Proportionen und Ausrichtung der Räume. Alle Zahlen müssen endlich und alle Punkte innerhalb der Zeichenfläche sein. Die Koordinaten sind keine Meterangaben.
4. Zeichne Raumflächen entlang ihrer inneren Begrenzungen. Polygone haben mindestens drei unterschiedliche Punkte und werden implizit geschlossen: den ersten Punkt am Ende NICHT wiederholen. Sie dürfen sich nicht selbst überschneiden oder selbst berühren. Verschiedene Raumflächen dürfen sich nicht flächig überlappen. Die Raumkonturen müssen ohne ein Hintergrundbild verständlich sein.
5. Übernimm lesbare Raumnamen. Fehlt ein Name, verwende eine neutrale Bezeichnung wie "Raum 1". Erfinde keine verdeckten Räume oder Bauteile.
6. Übernimm area_m2 ausschließlich aus einer eindeutig lesbaren, diesem Raum zugeordneten positiven Flächenangabe. Andernfalls null. Ohne bestätigten Maßstab keine Quadratmeter aus den Koordinaten berechnen.
7. Erzeuge keine Bildreferenzen, Dateipfade, URLs, Sensor-IDs, Temperaturen oder Heizlastwerte. Das Format enthält kein background-Feld.
8. Antworte ausschließlich mit einem JSON-Objekt, ohne Markdown-Codeblock, Kommentare oder Erklärungstext.

Verbindliches vollständiges JSON-Schema:
${JSON.stringify(schema, null, 2)}

Nur ein Formatbeispiel – keine erkannten Räume oder realen Raumgrenzen. Die Beispielzeichenfläche, Beispielpunkte und der Beispielraum sind durch die tatsächliche Anordnung der Räume des beigefügten Grundrisses zu ersetzen:
${JSON.stringify(sample, null, 2)}`;
}

export async function copyPrompt(prompt: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try { await navigator.clipboard.writeText(prompt); return true; }
  catch { return false; }
}
