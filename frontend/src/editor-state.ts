import { type Floor, type Floorplan, type Point, type Room, clone } from "./types";
import { reconcileBindings, validatePlan } from "./validation";

export type EditorResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface EditorSnapshot {
  plan: Floorplan | null;
  bindings: Record<string, string[]>;
  selectedFloor?: string;
  selectedRoom?: string;
}

export interface EditorHistory<T> {
  past: T[];
  present: T;
  future: T[];
}

export function uniqueId(plan: Floorplan | null, prefix: "room" | "floor" = "room", reservedIds: Iterable<string> = []): string {
  const used = new Set([...reservedIds, ...(plan?.floors.flatMap((floor) => [floor.id, ...floor.rooms.map((room) => room.id)]) ?? [])]);
  let index = 1;
  while (used.has(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}

function checkedPlan(plan: Floorplan): EditorResult<{ plan: Floorplan }> {
  const checked = validatePlan(plan);
  return checked.ok ? { ok: true, plan: checked.plan } : { ok: false, error: checked.errors.join(" ") };
}

export function createFloor(plan: Floorplan | null, name: string, canvas: Floor["canvas"] = { width: 1000, height: 700 }, reservedIds: Iterable<string> = []): EditorResult<{ plan: Floorplan; floor: Floor }> {
  const floor: Floor = { id: uniqueId(plan, "floor", reservedIds), name: name.trim(), canvas: { ...canvas }, rooms: [] };
  const checked = checkedPlan({ schema_version: "1.1", floors: [...(plan?.floors ?? []), floor] });
  return checked.ok ? { ...checked, floor: clone(floor) } : checked;
}

export function renameFloor(plan: Floorplan, id: string, name: string): EditorResult<{ plan: Floorplan }> {
  if (!plan.floors.some((floor) => floor.id === id)) return { ok: false, error: "Das ausgewählte Geschoss existiert nicht mehr." };
  return checkedPlan({ ...plan, floors: plan.floors.map((floor) => floor.id === id ? { ...floor, name: name.trim() } : floor) });
}

export function resizeFloor(plan: Floorplan, id: string, canvas: Floor["canvas"]): EditorResult<{ plan: Floorplan }> {
  if (!plan.floors.some((floor) => floor.id === id)) return { ok: false, error: "Das ausgewählte Geschoss existiert nicht mehr." };
  return checkedPlan({ ...plan, floors: plan.floors.map((floor) => floor.id === id ? { ...floor, canvas: { ...canvas } } : floor) });
}

export function moveFloor(plan: Floorplan, id: string, direction: -1 | 1): EditorResult<{ plan: Floorplan }> {
  const index = plan.floors.findIndex((floor) => floor.id === id);
  if (index < 0) return { ok: false, error: "Das ausgewählte Geschoss existiert nicht mehr." };
  const floors = [...plan.floors], target = index + direction;
  if (target >= 0 && target < floors.length) [floors[index], floors[target]] = [floors[target], floors[index]];
  return checkedPlan({ ...plan, floors });
}

export function createRoom(plan: Floorplan, floorId: string, name: string, polygon: Point[], area_m2: number | null = null, reservedIds: Iterable<string> = []): EditorResult<{ plan: Floorplan; room: Room }> {
  if (!plan.floors.some((floor) => floor.id === floorId)) return { ok: false, error: "Das ausgewählte Geschoss existiert nicht mehr." };
  const room: Room = { id: uniqueId(plan, "room", reservedIds), name: name.trim(), polygon: polygon.map((point) => [...point]), area_m2 };
  const checked = checkedPlan({ ...plan, floors: plan.floors.map((floor) => floor.id === floorId ? { ...floor, rooms: [...floor.rooms, room] } : floor) });
  return checked.ok ? { ...checked, room: clone(room) } : checked;
}

/** Preserve extra snapshot fields such as the operation provenance ledger. */
export function removeFloor<T extends EditorSnapshot>(snapshot: T, id: string): EditorResult<{ snapshot: T }> {
  if (!snapshot.plan?.floors.some((floor) => floor.id === id)) return { ok: false, error: "Das ausgewählte Geschoss existiert nicht mehr." };
  const floors = snapshot.plan.floors.filter((floor) => floor.id !== id);
  const plan: Floorplan | null = floors.length ? { ...snapshot.plan, floors } : null;
  const selectedFloor = floors.find((floor) => floor.id === snapshot.selectedFloor) ?? floors[0];
  const selectedRoom = selectedFloor?.rooms.find((room) => room.id === snapshot.selectedRoom) ?? selectedFloor?.rooms[0];
  return { ok: true, snapshot: clone({ ...snapshot, plan, bindings: plan ? reconcileBindings(plan, snapshot.bindings).bindings : {}, selectedFloor: selectedFloor?.id ?? "", selectedRoom: selectedRoom?.id ?? "" }) };
}

export function createHistory<T>(initial: T): EditorHistory<T> {
  return { past: [], present: clone(initial), future: [] };
}

/** Record an entire completed edit; callers group pointer movement into one edit. */
export function recordHistory<T>(history: EditorHistory<T>, next: T, limit = 50): EditorHistory<T> {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  const bounded = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 50));
  return { past: [...history.past, history.present].slice(-bounded), present: clone(next), future: [] };
}

export function undoHistory<T>(history: EditorHistory<T>): EditorHistory<T> {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: clone(history.past.at(-1)!), future: [history.present, ...history.future] };
}

export function redoHistory<T>(history: EditorHistory<T>): EditorHistory<T> {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: clone(history.future[0]), future: history.future.slice(1) };
}
