import Ajv from "ajv/dist/2020";
import polygonClipping from "polygon-clipping";
import schema from "../../schemas/floorplan-v1.schema.json";
import { type Floorplan, type Point, clone } from "./types";

const validateSchema = new Ajv({ allErrors: true, strict: false, strictNumbers: true }).compile(schema);
const EPSILON = 1e-7;

function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a, b, p)) < EPSILON && p[0] >= Math.min(a[0], b[0]) - EPSILON && p[0] <= Math.max(a[0], b[0]) + EPSILON && p[1] >= Math.min(a[1], b[1]) - EPSILON && p[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < -EPSILON && cdA * cdB < -EPSILON) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function polygonArea(points: Point[]): number {
  return Math.abs(points.reduce((sum, p, index) => {
    const q = points[(index + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

export function geometryError(points: Point[]): string | null {
  if (points.length < 3 || new Set(points.map((p) => `${p[0]},${p[1]}`)).size !== points.length) return "Mindestens drei unterschiedliche Punkte; den ersten Punkt am Ende nicht wiederholen.";
  if (points.some((p) => p.some((n) => !Number.isFinite(n)))) return "Alle Koordinaten müssen endliche Zahlen sein.";
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length], p = points[i], next = points[(i + 1) % points.length];
    if (Math.abs(cross(prev, p, next)) < EPSILON && ((prev[0] - p[0]) * (next[0] - p[0]) + (prev[1] - p[1]) * (next[1] - p[1])) > EPSILON) return "Polygonkanten dürfen nicht zurücklaufen oder sich überlagern.";
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(p, next, points[j], points[(j + 1) % points.length])) return "Die Raumgrenze überschneidet oder berührt sich selbst.";
    }
  }
  if (polygonArea(points) <= EPSILON) return "Die Raumfläche muss größer als null sein.";
  return null;
}

export function overlap(a: Point[], b: Point[]): boolean {
  const result = polygonClipping.intersection([a], [b]);
  const area = result.reduce((sum, polygon) => sum + polygonArea(polygon[0]) - polygon.slice(1).reduce((holes, ring) => holes + polygonArea(ring), 0), 0);
  return area > EPSILON;
}

export type ValidationResult = { ok: true; plan: Floorplan } | { ok: false; errors: string[] };

/** Schema, prompt and both import paths share the same versioned definition. */
export function validatePlan(input: unknown): ValidationResult {
  if (!validateSchema(input)) {
    const errors = (validateSchema.errors ?? []).slice(0, 12).map((error) => {
      const path = error.instancePath || "/";
      if (error.keyword === "required") return `${path}: Pflichtfeld „${error.params.missingProperty}“ fehlt.`;
      if (error.keyword === "const") return `${path}: Nicht unterstützter Wert; erwartet ${JSON.stringify(error.params.allowedValue)}.`;
      if (error.keyword === "additionalProperties") return `${path}: Unbekanntes Feld „${error.params.additionalProperty}“.`;
      return `${path}: Formatfehler (${error.keyword}); bitte mit dem Schema vergleichen.`;
    });
    return { ok: false, errors };
  }
  const plan = input as unknown as Floorplan;
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const floor of plan.floors) {
    if (ids.has(floor.id)) errors.push(`Etage „${floor.name}“: Doppelte ID „${floor.id}“; Etagen- und Raum-IDs müssen gemeinsam eindeutig sein.`);
    ids.add(floor.id);
  }
  for (const floor of plan.floors) {
    const validRooms: typeof floor.rooms = [];
    for (const room of floor.rooms) {
      const prefix = `Raum „${room.name}“ (${room.id})`;
      if (ids.has(room.id)) errors.push(`${prefix}: Doppelte ID; Etagen- und Raum-IDs müssen über alle Etagen eindeutig sein.`);
      ids.add(room.id);
      const error = geometryError(room.polygon);
      if (error) errors.push(`${prefix}: ${error}`);
      if (room.polygon.some(([x, y]) => x < 0 || y < 0 || x > floor.canvas.width || y > floor.canvas.height)) errors.push(`${prefix}: Koordinaten liegen außerhalb der Zeichenfläche.`);
      if (!error) validRooms.push(room);
    }
    for (let i = 0; i < validRooms.length; i++) {
      for (let j = i + 1; j < validRooms.length; j++) {
        if (overlap(validRooms[i].polygon, validRooms[j].polygon)) errors.push(`Etage „${floor.name}“: Die Räume „${validRooms[i].name}“ und „${validRooms[j].name}“ überlappen sich flächig.`);
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, plan: clone(plan) };
}

export function parseImport(text: string): ValidationResult {
  if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) return { ok: false, errors: ["Die JSON-Datei darf höchstens 2 MiB groß sein."] };
  try { return validatePlan(JSON.parse(text)); }
  catch { return { ok: false, errors: ["Das JSON lässt sich nicht lesen. Bitte ein JSON-Objekt ohne Markdown, Kommentare oder zusätzlichen Text einfügen."] }; }
}

export function reconcileBindings(plan: Floorplan, bindings: Record<string, string[]>): { bindings: Record<string, string[]>; removed: string[] } {
  const ids = new Set(plan.floors.flatMap((floor) => floor.rooms.map((room) => room.id)));
  return {
    bindings: Object.fromEntries(Object.entries(bindings).filter(([id]) => ids.has(id)).map(([id, values]) => [id, [...values]])),
    removed: Object.keys(bindings).filter((id) => !ids.has(id) && bindings[id].length > 0),
  };
}
