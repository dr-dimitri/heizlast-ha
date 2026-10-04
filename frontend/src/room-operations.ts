import polygonClipping from "polygon-clipping";
import { type Point, type Room } from "./types";
import { geometryError, overlap, polygonArea } from "./validation";

const EPSILON = 1e-7;
// Only close wall gaps: their depth must be small relative to both room areas,
// and the facing boundary must be at least twice as long as the gap is deep.
const MAX_GAP_RATIO = 0.15;
const MAX_EDGE_SLOPE = 0.05;
const MERGE_ERROR = "Diese Räume haben keine gemeinsame Grenze oder keinen schmalen Wandabstand. Korrigieren Sie bei Bedarf zuerst ihre Konturen.";

export type MergeRoomsResult = { ok: true; room: Room } | { ok: false; error: string };

interface Bridge {
  polygon: Point[];
  gap: number;
  width: number;
}

function singleOutline(result: polygonClipping.MultiPolygon): Point[] | null {
  if (result.length !== 1 || result[0].length !== 1) return null;
  const ring = result[0][0];
  const closed = ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1];
  const points: Point[] = ring.slice(0, closed ? -1 : undefined).map(([x, y]) => [x, y]);
  return points.length <= 500 && !geometryError(points) ? points : null;
}

function interpolate(start: Point, end: Point, ratio: number): Point {
  if (Math.abs(ratio) < EPSILON) return [...start];
  if (Math.abs(ratio - 1) < EPSILON) return [...end];
  return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
}

function wallBridges(first: Point[], second: Point[]): Bridge[] {
  const maxGap = MAX_GAP_RATIO * Math.sqrt(Math.min(polygonArea(first), polygonArea(second)));
  const candidates: Bridge[] = [];
  for (let i = 0; i < first.length; i++) {
    const a = first[i], b = first[(i + 1) % first.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= EPSILON) continue;
    const axis: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const projection = (point: Point) => (point[0] - a[0]) * axis[0] + (point[1] - a[1]) * axis[1];
    const distance = (point: Point) => axis[0] * (point[1] - a[1]) - axis[1] * (point[0] - a[0]);
    for (let j = 0; j < second.length; j++) {
      const c = second[j], d = second[(j + 1) % second.length];
      const cProjection = projection(c), dProjection = projection(d);
      const projectedLength = dProjection - cProjection;
      if (Math.abs(projectedLength) <= EPSILON || Math.abs((distance(d) - distance(c)) / projectedLength) > MAX_EDGE_SLOPE) continue;
      const start = Math.max(0, Math.min(cProjection, dProjection));
      const end = Math.min(length, Math.max(cProjection, dProjection));
      if (end - start <= EPSILON) continue;
      const cStart = interpolate(c, d, (start - cProjection) / projectedLength);
      const cEnd = interpolate(c, d, (end - cProjection) / projectedLength);
      const startDistance = distance(cStart), endDistance = distance(cEnd);
      const gap = Math.max(Math.abs(startDistance), Math.abs(endDistance));
      if (Math.abs(startDistance) <= EPSILON || Math.abs(endDistance) <= EPSILON || startDistance * endDistance < 0 || gap > maxGap || end - start < 2 * gap) continue;
      candidates.push({
        polygon: [interpolate(a, b, start / length), interpolate(a, b, end / length), cEnd, cStart],
        gap,
        width: end - start,
      });
    }
  }
  return candidates.sort((a, b) => a.gap - b.gap || b.width - a.width);
}

/** Merge two rooms on the same floor. The caller must validate the whole plan
 * afterward so a wall bridge cannot cross any unselected room. */
export function mergeRooms(first: Room, second: Room): MergeRoomsResult {
  if (first.id === second.id) return { ok: false, error: "Wählen Sie zwei unterschiedliche Räume aus." };
  if (geometryError(first.polygon) || geometryError(second.polygon)) return { ok: false, error: "Korrigieren Sie zuerst die ungültigen Raumkonturen." };
  const area = first.area_m2 === null || second.area_m2 === null ? null : first.area_m2 + second.area_m2;
  if (area !== null && (!Number.isFinite(area) || area <= 0)) return { ok: false, error: "Die addierte Raumfläche ist ungültig." };
  try {
    if (overlap(first.polygon, second.polygon)) return { ok: false, error: "Die Räume überlappen sich. Korrigieren Sie zuerst ihre Konturen." };
    const combined = polygonClipping.union([first.polygon], [second.polygon]);
    let polygon = singleOutline(combined);
    if (!polygon && combined.length === 1 && combined[0].length > 1) return { ok: false, error: "Die verbundenen Räume würden eine Aussparung einschließen. Das Grundrissformat unterstützt solche Raumkonturen nicht." };
    if (!polygon) {
      for (const bridge of wallBridges(first.polygon, second.polygon)) {
        if (geometryError(bridge.polygon) || overlap(bridge.polygon, first.polygon) || overlap(bridge.polygon, second.polygon)) continue;
        polygon = singleOutline(polygonClipping.union([first.polygon], [second.polygon], [bridge.polygon]));
        if (polygon) break;
      }
    }
    return polygon ? { ok: true, room: { ...first, polygon, area_m2: area } } : { ok: false, error: MERGE_ERROR };
  } catch {
    return { ok: false, error: "Die Raumkonturen lassen sich nicht sicher verbinden. Korrigieren Sie zuerst ihre Grenzen." };
  }
}

function pointInside(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

function boundaryDistanceSquared(point: Point, polygon: Point[]): number {
  let distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0;
    distance = Math.min(distance, (point[0] - a[0] - ratio * dx) ** 2 + (point[1] - a[1] - ratio * dy) ** 2);
  }
  return distance;
}

/** Keep existing label placement when inside a validated simple polygon.
 * Concave fallbacks examine at most 32 horizontal slices and 16 candidates:
 * O(n) for the common case, O(n log n) for the bounded fallback. */
export function interiorLabelPoint(polygon: Point[]): Point {
  if (!polygon.length) return [0, 0];
  const mean: Point = [polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length, polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length];
  if (pointInside(mean, polygon) && boundaryDistanceSquared(mean, polygon) > EPSILON ** 2) return mean;
  const levels = [...new Set(polygon.map((point) => point[1]))].sort((a, b) => a - b);
  const slices = levels.slice(1).map((level, index) => ({ y: (level + levels[index]) / 2, height: level - levels[index] }))
    .sort((a, b) => b.height - a.height).slice(0, 32);
  const candidates: { point: Point; capacity: number; width: number }[] = [];
  for (const { y, height } of slices) {
    const crossings: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if ((a[1] > y) !== (b[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const width = crossings[i + 1] - crossings[i];
      if (width > 0) candidates.push({ point: [(crossings[i] + crossings[i + 1]) / 2, y], capacity: Math.min(width, height), width });
    }
  }
  const finalists = candidates.sort((a, b) => b.capacity - a.capacity || b.width - a.width).slice(0, 16);
  let best = mean, distance = -1;
  for (const candidate of finalists) {
    const nextDistance = boundaryDistanceSquared(candidate.point, polygon);
    if (nextDistance > distance) { best = candidate.point; distance = nextDistance; }
  }
  return best;
}
