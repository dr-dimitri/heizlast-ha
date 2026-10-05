import { describe, expect, it } from "vitest";
import polygonClipping from "polygon-clipping";
import { createFloor, createHistory, createRoom, moveFloor, recordHistory, redoHistory, removeFloor, renameFloor, resizeFloor, undoHistory, uniqueId, type EditorSnapshot } from "../src/editor-state";
import { nearestBoundaryPoint, rectanglePolygon, splitRoom } from "../src/room-operations";
import { clone, type Floorplan, type Point, type Room } from "../src/types";
import { geometryError, overlap, polygonArea, validatePlan } from "../src/validation";

const source = (): Room => ({ id: "living", name: "Wohnzimmer", area_m2: 50, polygon: [[10, 10], [210, 10], [210, 110], [10, 110]] });
const plan = (): Floorplan => ({ schema_version: "1.1", floors: [{ id: "floor_1", name: "Erdgeschoss", canvas: { width: 1000, height: 700 }, rooms: [source()] }] });
const snapshot = (): EditorSnapshot => ({ plan: plan(), bindings: { living: ["sensor.old"] }, selectedFloor: "floor_1", selectedRoom: "living" });

describe("Safe room splitting", () => {
  it("partitions the entire source and retains the larger room's identity by default", () => {
    const original = source(), before = clone(original), result = splitRoom(original, [60, 10], [60, 110], "new_room");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const [retained, created] = result.rooms;
      expect(retained.id).toBe("living"); expect(retained.name).toBe("Wohnzimmer"); expect(created.id).toBe("new_room");
      expect(polygonArea(retained.polygon)).toBe(15000); expect(polygonArea(created.polygon)).toBe(5000);
      expect(overlap(retained.polygon, created.polygon)).toBe(false);
      expect(polygonClipping.xor([original.polygon], polygonClipping.union([retained.polygon], [created.polygon]))).toEqual([]);
      expect(result.originalArea).toBe(50); expect(retained.area_m2).toBeNull(); expect(created.area_m2).toBeNull();
      const value = plan(); value.floors[0].rooms = result.rooms; expect(validatePlan(value).ok).toBe(true);
      retained.polygon[0][0] = 99;
    }
    expect(original).toEqual(before);
  });
  it("lets the user keep the smaller piece's identity and sensors", () => {
    const result = splitRoom(source(), [60, 10], [60, 110], "new_room", "smaller");
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.rooms[0].id).toBe("living"); expect(polygonArea(result.rooms[0].polygon)).toBe(5000); }
  });
  it("supports cuts through existing vertices and reversed winding", () => {
    const a = source(), b = clone(a); b.polygon.reverse();
    for (const room of [a, b]) {
      const result = splitRoom(room, [10, 10], [210, 110], "new_room"); expect(result.ok).toBe(true);
      if (result.ok) { expect(result.rooms.map((part) => polygonArea(part.polygon))).toEqual([10000, 10000]); result.rooms.forEach((part) => expect(geometryError(part.polygon)).toBeNull()); }
    }
  });
  it("splits a concave U-shaped room where a single interior chord makes two rooms", () => {
    const room: Room = { ...source(), polygon: [[0, 0], [300, 0], [300, 300], [200, 300], [200, 100], [100, 100], [100, 300], [0, 300]] };
    const result = splitRoom(room, [0, 50], [300, 50], "new_room"); expect(result.ok).toBe(true);
    if (result.ok) { expect(result.rooms.reduce((sum, part) => sum + polygonArea(part.polygon), 0)).toBe(polygonArea(room.polygon)); expect(result.rooms[0].polygon.length).toBeGreaterThan(4); }
  });
  it("rejects a concave cut that crosses the empty notch or creates more than two pieces", () => {
    const room: Room = { ...source(), polygon: [[0, 0], [300, 0], [300, 300], [200, 300], [200, 100], [100, 100], [100, 300], [0, 300]] };
    expect(splitRoom(room, [0, 200], [300, 200], "new_room").ok).toBe(false);
  });
  it("rejects a cut that merely touches an additional concave boundary vertex", () => {
    const room: Room = { ...source(), polygon: [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]] };
    expect(splitRoom(room, [0, 200], [200, 0], "new_room").ok).toBe(false);
  });
  it.each([
    { start: [10, 10], end: [210, 10] },
    { start: [60, 10], end: [100, 10] },
    { start: [60, 10], end: [60, 10] },
    { start: [60, 50], end: [60, 110] },
    { start: [Infinity, 10], end: [60, 110] },
  ])("rejects boundary-following, repeated, interior and non-finite cut points: $start -> $end", ({ start, end }) => {
    expect(splitRoom(source(), start as Point, end as Point, "new_room").ok).toBe(false);
  });
  it("requires a valid distinct new room ID and caps each output contour", () => {
    for (const id of ["living", "123", "UPPER", "a".repeat(65)]) expect(splitRoom(source(), [60, 10], [60, 110], id).ok).toBe(false);
    const room = source(); room.name = "a".repeat(120);
    const result = splitRoom(room, [60, 10], [60, 110], "new_room"); expect(result.ok).toBe(true);
    if (result.ok) expect(result.rooms[1].name.length).toBe(120);
    room.polygon = Array.from({ length: 500 }, (_, index): Point => [500 + 100 * Math.cos(index * Math.PI / 250), 500 + 100 * Math.sin(index * Math.PI / 250)]);
    const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    expect(splitRoom(room, midpoint(room.polygon[0], room.polygon[1]), midpoint(room.polygon[1], room.polygon[2]), "new_room").ok).toBe(false);
  });
  it("projects a pointer onto the nearest edge, including rotated edges and vertices", () => {
    const polygon: Point[] = [[100, 0], [200, 100], [100, 200], [0, 100]], before = clone(polygon);
    expect(nearestBoundaryPoint(polygon, [180, 20])).toEqual([150, 50]);
    expect(nearestBoundaryPoint(polygon, [100, -10])).toEqual([100, 0]); expect(polygon).toEqual(before);
  });
});

describe("Shared floor and room creation", () => {
  it("creates a valid empty first floor from the blank project without mutating input", () => {
    const canvas = { width: 1200, height: 800 }, result = createFloor(null, "  Obergeschoss  ", canvas);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.floor.name).toBe("Obergeschoss"); expect(result.floor.rooms).toEqual([]); expect(validatePlan(result.plan).ok).toBe(true); result.floor.canvas.width = 5; expect(result.plan.floors[0].canvas.width).toBe(1200); }
    expect(canvas).toEqual({ width: 1200, height: 800 });
  });
  it("generates IDs unique across floors, rooms and removed saved IDs", () => {
    const value = plan(); value.floors[0].rooms[0].id = "floor_2";
    expect(uniqueId(value, "floor", ["floor_3"])).toBe("floor_4");
    expect(uniqueId(value, "room", ["room_1", "room_2"])).toBe("room_3");
    const result = createRoom(plan(), "floor_1", "Neu", rectanglePolygon([300, 100], [400, 200]), null, ["room_1"]);
    expect(result.ok).toBe(true); if (result.ok) expect(result.room.id).toBe("room_2");
  });
  it("normalizes a rectangle drawn in any direction and creates a room with unknown metric area", () => {
    const value = plan(), before = clone(value), start: Point = [400, 300], end: Point = [300, 200];
    const polygon = rectanglePolygon(start, end); expect(polygon).toEqual([[300, 200], [400, 200], [400, 300], [300, 300]]);
    const result = createRoom(value, "floor_1", "  Küche  ", polygon);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.room.name).toBe("Küche"); expect(result.room.area_m2).toBeNull(); expect(result.plan.floors[0].rooms).toHaveLength(2); result.room.polygon[0][0] = 1; expect(result.plan.floors[0].rooms[1].polygon[0][0]).toBe(300); }
    expect(value).toEqual(before); expect(start).toEqual([400, 300]); expect(end).toEqual([300, 200]);
  });
  it("validates new rooms against existing rooms and the canvas before applying them", () => {
    const value = plan(), before = clone(value);
    expect(createRoom(value, "floor_1", "Überlappung", rectanglePolygon([100, 20], [300, 120])).ok).toBe(false);
    expect(createRoom(value, "floor_1", "Außerhalb", rectanglePolygon([990, 600], [1100, 710])).ok).toBe(false);
    expect(createRoom(value, "floor_1", "Ungültig", [[300, 100], [400, 200], [400, 100], [300, 200]]).ok).toBe(false);
    expect(createRoom(value, "floor_1", "Leer", rectanglePolygon([300, 200], [300, 300])).ok).toBe(false);
    expect(createRoom(value, "floor_1", " ", rectanglePolygon([300, 200], [400, 300])).ok).toBe(false);
    expect(createRoom(value, "floor_1", "Negativ", rectanglePolygon([300, 200], [400, 300]), -1).ok).toBe(false);
    expect(createRoom(value, "missing", "Neu", rectanglePolygon([300, 200], [400, 300])).ok).toBe(false);
    expect(value).toEqual(before);
  });
  it("renames, reorders and resizes a floor without changing stable IDs or coordinates", () => {
    const first = plan(), added = createFloor(first, "OG"); expect(added.ok).toBe(true); if (!added.ok) return;
    const renamed = renameFloor(added.plan, "floor_1", "Wohnetage"); expect(renamed.ok).toBe(true); if (!renamed.ok) return;
    const moved = moveFloor(renamed.plan, "floor_1", 1); expect(moved.ok).toBe(true); if (!moved.ok) return;
    expect(moved.plan.floors.map((floor) => floor.id)).toEqual([added.floor.id, "floor_1"]);
    const resized = resizeFloor(moved.plan, "floor_1", { width: 1200, height: 800 }); expect(resized.ok).toBe(true);
    if (resized.ok) expect(resized.plan.floors[1].rooms[0]).toEqual(source());
    expect(resizeFloor(moved.plan, "floor_1", { width: 100, height: 100 }).ok).toBe(false);
    expect(renameFloor(first, "floor_1", "  ").ok).toBe(false); expect(moveFloor(first, "missing", 1).ok).toBe(false);
    expect(first).toEqual(plan());
  });
  it("enforces floor count and canvas requirements", () => {
    expect(createFloor(null, "", { width: 1000, height: 700 }).ok).toBe(false);
    expect(createFloor(null, "EG", { width: 0, height: 700 }).ok).toBe(false);
    expect(createFloor(null, "EG", { width: 1000.5, height: 700 }).ok).toBe(false);
    const value = plan(); value.floors = Array.from({ length: 32 }, (_, index) => ({ id: `f_${index}`, name: `Etage ${index}`, canvas: { width: 1000, height: 700 }, rooms: [] }));
    expect(createFloor(value, "Zu viel").ok).toBe(false);
  });
  it("deletes a floor and only its room bindings, selecting a surviving room", () => {
    const value = snapshot(); value.plan!.floors.push({ id: "og", name: "OG", canvas: { width: 1000, height: 700 }, rooms: [{ ...source(), id: "bedroom", name: "Schlafen" }] }); value.bindings.bedroom = ["sensor.new"];
    const before = clone(value), result = removeFloor(value, "floor_1"); expect(result.ok).toBe(true);
    if (result.ok) { expect(result.snapshot.plan!.floors.map((floor) => floor.id)).toEqual(["og"]); expect(result.snapshot.bindings).toEqual({ bedroom: ["sensor.new"] }); expect(result.snapshot.selectedFloor).toBe("og"); expect(result.snapshot.selectedRoom).toBe("bedroom"); }
    expect(value).toEqual(before);
  });
  it("resets the last floor to plan:null while preserving operation provenance for history", () => {
    const value = { ...snapshot(), room_operations: [{ kind: "split", source_room_id: "living" }] }, result = removeFloor(value, "floor_1"); expect(result.ok).toBe(true);
    if (result.ok) { expect(result.snapshot.plan).toBeNull(); expect(result.snapshot.bindings).toEqual({}); expect(result.snapshot.selectedFloor).toBe(""); expect(result.snapshot.selectedRoom).toBe(""); expect(result.snapshot.room_operations).toEqual(value.room_operations); }
    expect(removeFloor(value, "missing").ok).toBe(false);
  });
});

describe("Atomic editor undo and redo", () => {
  it("restores geometry, sensor assignments, selection and provenance together", () => {
    const initial = { ...snapshot(), room_operations: [] as object[] }, history = createHistory(initial);
    const split = splitRoom(source(), [60, 10], [60, 110], "new_room"); expect(split.ok).toBe(true); if (!split.ok) return;
    const next = clone(initial); next.plan!.floors[0].rooms = split.rooms; next.bindings = { living: [], new_room: ["sensor.old"] }; next.selectedRoom = "new_room"; next.room_operations = [{ kind: "split", source_room_id: "living", created_room_id: "new_room" }];
    const edited = recordHistory(history, next), undone = undoHistory(edited), redone = redoHistory(undone);
    expect(undone.present).toEqual(initial); expect(redone.present).toEqual(next); expect(history.present).toEqual(initial);
    next.bindings.new_room.push("sensor.later"); expect(redone.present.bindings.new_room).toEqual(["sensor.old"]);
    undone.present.plan!.floors[0].rooms[0].name = "Changed"; expect(history.present.plan!.floors[0].rooms[0].name).toBe("Wohnzimmer");
  });
  it("records a completed drag once, skips no-op edits and clears redo after a new edit", () => {
    const initial = snapshot(), history = createHistory(initial), dragged = clone(initial); dragged.plan!.floors[0].rooms[0].polygon[0] = [20, 20];
    const edited = recordHistory(history, dragged); expect(edited.past).toHaveLength(1); expect(recordHistory(edited, clone(dragged))).toBe(edited);
    const undone = undoHistory(edited), renamed = clone(initial); renamed.plan!.floors[0].rooms[0].name = "Wohnen";
    const branched = recordHistory(undone, renamed); expect(branched.future).toEqual([]); expect(redoHistory(branched)).toBe(branched);
  });
  it("undoes a complete last-floor reset and bounds the retained history", () => {
    const initial = snapshot(), reset = removeFloor(initial, "floor_1"); expect(reset.ok).toBe(true); if (!reset.ok) return;
    const history = recordHistory(createHistory(initial), reset.snapshot); expect(undoHistory(history).present).toEqual(initial);
    let bounded = createHistory(0); for (let index = 1; index <= 10; index++) bounded = recordHistory(bounded, index, 3);
    expect(bounded.past).toEqual([7, 8, 9]); expect(undoHistory(createHistory(0)).present).toBe(0);
  });
});
