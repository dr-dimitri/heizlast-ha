import { describe, expect, it } from "vitest";
import sample from "../../examples/ground-floor.json";
import { geometryError, overlap, parseImport, reconcileBindings, validatePlan } from "../src/validation";
import { bindingFor, clone, type Floorplan, type Point } from "../src/types";

const plan = () => clone(sample) as Floorplan;
const valid = (value: unknown) => validatePlan(value);
const square: Point[] = [[10, 10], [30, 10], [30, 30], [10, 30]];

describe("Import validation", () => {
  it("accepts the hand-checked example without mutating the source", () => {
    const input = plan(), result = valid(input);
    expect(result.ok).toBe(true);
    if (result.ok) { result.plan.floors[0].rooms[0].name = "Changed"; expect(input.floors[0].rooms[0].name).not.toBe("Changed"); }
  });
  it("accepts and preserves every floor without any images", () => {
    const input = plan(), second = clone(input.floors[0]);
    second.id = "og"; second.rooms.forEach((room) => room.id = `og_${room.id}`); input.floors.push(second);
    const result = valid(input); expect(result.ok).toBe(true); if (result.ok) expect(result.plan.floors).toHaveLength(2);
  });
  it.each(["invalid", "```json\n{}\n```", "{}", '{"schema_version":"2.0","floors":[]}'])("rejects invalid/unsupported data: %s", (text) => { expect(parseImport(text).ok).toBe(false); });
  it("rejects non-finite metric areas instead of silently converting them to null", () => {
    const input = plan(); input.floors[0].rooms[0].area_m2 = Infinity;
    expect(valid(input).ok).toBe(false);
    expect(parseImport(JSON.stringify(plan()).replace('"area_m2":null', '"area_m2":1e309')).ok).toBe(false);
  });
  it("rejects blank names, duplicated global IDs and negative metric areas", () => {
    const input = plan(); input.floors[0].rooms[0].name = "  "; expect(valid(input).ok).toBe(false);
    const duplicate = plan(); duplicate.floors[0].rooms[0].id = duplicate.floors[0].id; expect(valid(duplicate).ok).toBe(false);
    const ids = plan(); ids.floors[0].rooms[1].id = ids.floors[0].rooms[0].id; expect(valid(ids).ok).toBe(false);
    const area = plan(); area.floors[0].rooms[0].area_m2 = -1; expect(valid(area).ok).toBe(false);
  });
  it("rejects source image references and out-of-bounds canvas coordinates", () => {
    const background = plan(); Object.assign(background.floors[0], { background: "https://example.com/unsafe.png" }); expect(valid(background).ok).toBe(false);
    const dimensions = plan(); dimensions.floors[0].canvas.width = 1089; expect(valid(dimensions).ok).toBe(false);
    const bounds = plan(); bounds.floors[0].rooms[0].polygon[0] = [1201, 10]; expect(valid(bounds).ok).toBe(false);
  });
  it("returns meaningful room names for polygon errors", () => {
    const input = plan(); input.floors[0].rooms[0].polygon = [[10, 10], [30, 30], [30, 10], [10, 30]];
    const result = valid(input); expect(result.ok).toBe(false); if (!result.ok) expect(result.errors.join(" ")).toContain(input.floors[0].rooms[0].name);
  });
  it("rejects oversized imports", () => { expect(parseImport(" ".repeat(2 * 1024 * 1024 + 1)).ok).toBe(false); });
  it("keeps bindings of stable IDs and reports assigned removed IDs", () => {
    const input = plan(), id = input.floors[0].rooms[0].id;
    const result = reconcileBindings(input, { [id]: ["sensor.a", "sensor.b"], deleted: ["sensor.c"], empty: [] });
    expect(result.bindings).toEqual({ [id]: ["sensor.a", "sensor.b"] }); expect(result.removed).toEqual(["deleted"]);
  });
  it("supports schema-valid room IDs matching Object prototype names", () => { expect(bindingFor({}, "constructor")).toEqual([]); expect(bindingFor({ constructor: ["sensor.a"] }, "constructor")).toEqual(["sensor.a"]); });
});

describe("Polygon geometry", () => {
  it("accepts a simple rectangle", () => { expect(geometryError(square)).toBeNull(); });
  it("rejects an area exactly at the shared backend tolerance", () => { expect(geometryError([[0, 0], [1, 0], [0, 2e-7]])).not.toBeNull(); });
  it.each([
    [[0, 0], [10, 10], [10, 0], [0, 10]],
    [[0, 0], [10, 0], [5, 0], [5, 10], [0, 10]],
    [[0, 0], [10, 0], [20, 0]],
    [[0, 0], [10, 0], [10, 10], [0, 0]],
    [[0, 0], [Infinity, 0], [0, 10]],
  ].map((points) => ({ points: points as Point[] })))("rejects invalid polygon: $points", ({ points }) => { expect(geometryError(points)).not.toBeNull(); });
  it("allows shared edges and vertices without positive overlap", () => {
    expect(overlap(square, [[30, 10], [50, 10], [50, 30], [30, 30]])).toBe(false);
    expect(overlap(square, [[30, 30], [50, 30], [50, 50], [30, 50]])).toBe(false);
  });
  it("detects containment and identical polygons", () => {
    expect(overlap(square, [[12, 12], [20, 12], [20, 20], [12, 20]])).toBe(true); expect(overlap(square, square)).toBe(true);
  });
  it("checks concave outlines without rejecting rooms in their empty notch", () => {
    const concave: Point[] = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]];
    expect(overlap(concave, [[30, 30], [50, 30], [50, 50], [30, 50]])).toBe(false);
    expect(overlap(concave, [[10, 30], [30, 30], [30, 50], [10, 50]])).toBe(true);
  });
});
