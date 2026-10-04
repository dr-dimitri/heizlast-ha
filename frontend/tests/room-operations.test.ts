import { describe, expect, it } from "vitest";
import polygonClipping from "polygon-clipping";
import sample from "../../examples/ground-floor.json";
import { interiorLabelPoint, mergeRooms } from "../src/room-operations";
import { clone, type Floorplan, type Point, type Room } from "../src/types";
import { geometryError, overlap, polygonArea, validatePlan } from "../src/validation";

const room = (id: string, polygon: Point[], area: number | null = null): Room => ({ id, name: id, polygon, area_m2: area });
const rectangle = (id: string, left: number, top: number, right: number, bottom: number, area: number | null = null) => room(id, [[left, top], [right, top], [right, bottom], [left, bottom]], area);
const first = () => rectangle("living", 0, 0, 100, 100, 20);

describe("Room connection", () => {
  it("unites a shared boundary and keeps the first room ID and name", () => {
    const a = first(), b = rectangle("kitchen", 100, 20, 200, 80, 12), before = clone([a, b]);
    const result = mergeRooms(a, b);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.room.id).toBe(a.id); expect(result.room.name).toBe(a.name); expect(result.room.area_m2).toBe(32);
      expect(polygonArea(result.room.polygon)).toBe(16000); expect(geometryError(result.room.polygon)).toBeNull();
      result.room.polygon[0][0] = 50;
    }
    expect([a, b]).toEqual(before);
  });
  it.each([[null, 12], [20, null], [null, null]])("keeps unknown area when either source area is unknown: %s, %s", (a, b) => {
    const result = mergeRooms(rectangle("a", 0, 0, 100, 100, a), rectangle("b", 100, 0, 200, 100, b));
    expect(result.ok).toBe(true); if (result.ok) expect(result.room.area_m2).toBeNull();
  });
  it("preserves a concave notch instead of filling a convex hull", () => {
    const result = mergeRooms(room("a", [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]]), rectangle("b", 60, 0, 100, 20));
    expect(result.ok).toBe(true);
    if (result.ok) { expect(polygonArea(result.room.polygon)).toBe(2800); expect(overlap(result.room.polygon, [[30, 30], [50, 30], [50, 50], [30, 50]])).toBe(false); }
  });
  it("bridges only the facing wall interval across a narrow gap", () => {
    const result = mergeRooms(first(), rectangle("kitchen", 110, 20, 210, 80, 12));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(polygonArea(result.room.polygon)).toBe(16600); expect(result.room.area_m2).toBe(32);
      expect(overlap(result.room.polygon, [[101, 1], [109, 1], [109, 19], [101, 19]])).toBe(false);
    }
  });
  it("connects the example floor's rooms across their wall gap", () => {
    const plan = clone(sample) as Floorplan, floor = plan.floors[0];
    const result = mergeRooms(floor.rooms[0], floor.rooms[1]);
    expect(result.ok).toBe(true);
    if (result.ok) { floor.rooms.splice(0, 2, result.room); expect(validatePlan(plan).ok).toBe(true); }
  });
  it("supports slanted shared boundaries and narrow wall gaps", () => {
    const a = room("a", [[100, 0], [200, 100], [100, 200], [0, 100]]);
    const b = room("b", [[205, 105], [305, 205], [205, 305], [105, 205]]);
    const result = mergeRooms(a, b);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(geometryError(result.room.polygon)).toBeNull(); expect(polygonArea(result.room.polygon)).toBeCloseTo(41000); }
  });
  it("supports slightly skewed facing walls from imported contours", () => {
    const result = mergeRooms(first(), room("b", [[105, 10], [205, 10], [205, 90], [107, 90]]));
    expect(result.ok).toBe(true); if (result.ok) expect(geometryError(result.room.polygon)).toBeNull();
  });
  it("supports reversed contour winding and very small positive wall gaps", () => {
    const a = first(), b = rectangle("b", 100.0001, 20, 200.0001, 80); b.polygon.reverse();
    const result = mergeRooms(a, b);
    expect(result.ok).toBe(true); if (result.ok) expect(polygonArea(result.room.polygon)).toBeCloseTo(16000.006);
  });
  it("lets whole-plan validation reject a bridge through an unselected room", () => {
    const a = first(), b = rectangle("b", 110, 20, 210, 80), obstruction = rectangle("c", 102, 30, 108, 70);
    const result = mergeRooms(a, b);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const plan: Floorplan = { schema_version: "1.1", floors: [{ id: "eg", name: "EG", canvas: { width: 300, height: 200 }, rooms: [result.room, obstruction] }] };
      const validation = validatePlan(plan); expect(validation.ok).toBe(false);
      if (!validation.ok) expect(validation.errors.join(" ")).toContain("überlappen");
    }
  });
  it.each([
    rectangle("b", 100, 100, 200, 200),
    rectangle("b", 200, 0, 300, 100),
    rectangle("b", 110, 95, 210, 195),
  ])("rejects corner-only contact, distant rooms and an overly narrow bridge", (b) => {
    expect(mergeRooms(first(), b).ok).toBe(false);
  });
  it("rejects enclosed holes that one schema polygon cannot represent", () => {
    const a = room("a", [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]]);
    const b = room("b", [[20, 80], [80, 80], [80, 20], [100, 20], [100, 100], [20, 100]]);
    const result = mergeRooms(a, b);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.error).toContain("Aussparung");
  });
  it("rejects repeated room selections, overlapping inputs and invalid contours", () => {
    expect(mergeRooms(first(), first()).ok).toBe(false);
    expect(mergeRooms(first(), rectangle("b", 50, 0, 150, 100)).ok).toBe(false);
    expect(mergeRooms(first(), room("b", [[110, 0], [210, 100], [210, 0], [110, 100]])).ok).toBe(false);
  });
  it("rejects a metric area sum that cannot be represented", () => {
    expect(mergeRooms(rectangle("a", 0, 0, 100, 100, Number.MAX_VALUE), rectangle("b", 100, 0, 200, 100, Number.MAX_VALUE)).ok).toBe(false);
  });
});

describe("Room label placement", () => {
  const labelFits = (polygon: Point[], point: Point, width: number, height: number) => {
    const [x, y] = point;
    const label: Point[] = [[x - width / 2, y - height / 2], [x + width / 2, y - height / 2], [x + width / 2, y + height / 2], [x - width / 2, y + height / 2]];
    expect(polygonClipping.difference([label], [polygon])).toEqual([]);
  };

  it("preserves the existing center for ordinary rectangular rooms", () => {
    const polygon = first().polygon, before = clone(polygon);
    expect(interiorLabelPoint(polygon)).toEqual([50, 50]); expect(polygon).toEqual(before);
  });
  it("places the merged example's label inside instead of in its concave gap", () => {
    const plan = clone(sample) as Floorplan;
    const merged = mergeRooms(plan.floors[0].rooms[0], plan.floors[0].rooms[1]);
    expect(merged.ok).toBe(true);
    if (merged.ok) labelFits(merged.room.polygon, interiorLabelPoint(merged.room.polygon), 180, 40);
  });
  it("finds room for a label in an L-shaped outline whose vertex mean is outside", () => {
    const polygon: Point[] = [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]];
    const point = interiorLabelPoint(polygon); labelFits(polygon, point, 160, 40);
    expect(interiorLabelPoint([...polygon].reverse())).toEqual(point);
  });
  it("finds room for a label in a U-shaped outline whose vertex mean is outside", () => {
    const polygon: Point[] = [[0, 0], [300, 0], [300, 300], [200, 300], [200, 100], [100, 100], [100, 300], [0, 300]];
    const point = interiorLabelPoint(polygon); labelFits(polygon, point, 160, 40);
    expect(point[1]).toBeLessThan(100);
  });
  it("places a C-shaped room's label away from the empty notch", () => {
    const polygon: Point[] = [[0, 0], [300, 0], [300, 100], [100, 100], [100, 200], [300, 200], [300, 300], [0, 300]];
    labelFits(polygon, interiorLabelPoint(polygon), 160, 40);
  });
  it("uses an interior fallback when the vertex mean lies exactly on a concave corner", () => {
    const polygon: Point[] = [[0, 0], [300, 0], [300, 150], [150, 150], [150, 300], [0, 300]];
    const point = interiorLabelPoint(polygon); expect(point).not.toEqual([150, 150]);
    labelFits(polygon, point, 160, 40);
  });
  it("handles slanted concave outlines without placing the label on their border", () => {
    const polygon: Point[] = [[0, 0], [300, 0], [300, 80], [110, 100], [80, 300], [0, 300]];
    labelFits(polygon, interiorLabelPoint(polygon), 80, 20);
  });
});
