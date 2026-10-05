import { LitElement, css, html, svg, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { styles } from "./styles";
import { editorStyles } from "./editor-styles";
import { buildPrompt, copyPrompt, promptRequirements } from "./prompt";
import { parseImport, reconcileBindings, validatePlan } from "./validation";
import { interiorLabelPoint, mergeRooms, nearestBoundaryPoint, rectanglePolygon, splitRoom } from "./room-operations";
import { createFloor, createRoom, moveFloor, renameFloor, uniqueId } from "./editor-state";
import "./planning-dashboard";
import { type CardConfig, type Floor, type Floorplan, type HomeAssistant, type Point, type Project, type Room, bindingFor, clone, entityName, formatNumber, temperatureLabel, temperatureSensors } from "./types";

const houseIcon = svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/><path d="M15 4V2h3v4"/></svg>`;
const copyIcon = svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></svg>`;
const uploadIcon = svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></svg>`;

function failureMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "Die Verbindung zu Home Assistant ist fehlgeschlagen. Bitte erneut versuchen.";
}

function roomIds(plan: Floorplan | null): string[] {
  return plan?.floors.flatMap((floor) => floor.rooms.map((room) => room.id)) ?? [];
}

interface EditorSnapshot {
  plan: Floorplan | null;
  bindings: Record<string, string[]>;
  operations: RoomOperation[];
  floor: string;
  room: string;
  imported: boolean;
  step: number;
}
interface RoomSplit {
  kind: "split";
  source_room_id: string;
  created_room_id: string;
  floor_id: string;
  source_polygon: Point[];
  retained_polygon: Point[];
  created_polygon: Point[];
}
type RoomOperation = RoomSplit | { kind: "merge"; floor_id: string; source_room_ids: [string, string]; source_polygons: [Point[], Point[]]; result_polygon: Point[] };
type DrawingTool = "select" | "rectangle" | "polygon" | "split" | "pan";

/** A real Lovelace card. All mutations go through the HA authenticated API. */
export class HeizlastHaCard extends LitElement {
  static styles = [styles, editorStyles];
  static properties = {
    hass: { attribute: false }, config: { state: true }, project: { state: true }, draft: { state: true }, bindings: { state: true },
    selectedFloor: { state: true }, selectedRoom: { state: true }, floorId: { state: true }, floorName: { state: true },
    showSetup: { state: true }, editing: { state: true }, imported: { state: true }, dirty: { state: true }, jsonText: { state: true },
    errors: { state: true }, notice: { state: true }, loading: { state: true }, busy: { state: true }, showPrompt: { state: true }, copied: { state: true },
    confirmRemoved: { state: true }, conflict: { state: true }, mergeTarget: { state: true },
    editorOpen: { state: true }, editorStep: { state: true }, tool: { state: true }, drawingPoints: { state: true },
    newRoomName: { state: true }, sensorSearch: { state: true }, undoStack: { state: true }, redoStack: { state: true },
    splitPreview: { state: true }, splitKeep: { state: true }, splitName: { state: true }, splitSensors: { state: true },
    floorDelete: { state: true }, snap: { state: true }, zoom: { state: true }, viewOrigin: { state: true },
    canvasWidth: { state: true },
  };

  hass?: HomeAssistant;
  private config: CardConfig = { type: "custom:heizlast-ha-card" };
  private project?: Project;
  private draft: Floorplan | null = null;
  private bindings: Record<string, string[]> = {};
  private selectedFloor = "";
  private selectedRoom = "";
  private mergeTarget = "";
  private floorId = "eg";
  private floorName = "Erdgeschoss";
  private showSetup = true;
  private editing = false;
  private imported = false;
  private dirty = false;
  private jsonText = "";
  private errors: string[] = [];
  private notice = "";
  private loading = true;
  private busy = false;
  private showPrompt = false;
  private copied = "";
  private confirmRemoved: string[] | null = null;
  private conflict = false;
  private loadStarted = false;
  private drag: { index: number; room: string; pointer: number } | null = null;
  private returnFocus?: HTMLElement;
  private editorOpen = false;
  private editorStep = 0;
  private tool: DrawingTool = "select";
  private drawingPoints: Point[] = [];
  private newRoomName = "Neuer Raum";
  private sensorSearch = "";
  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];
  private operations: RoomOperation[] = [];
  private splitPreview: [Room, Room] | null = null;
  private splitKeep: "larger" | "smaller" = "larger";
  private splitName = "Neuer Teilraum";
  private splitSensors: Record<string, "retained" | "created" | "both"> = {};
  private floorDelete = false;
  private snap = true;
  private zoom = 1;
  private viewOrigin: Point = [0, 0];
  private drawStart: { point: Point; pointer: number; before: Point[]; screen: Point; threshold: number } | null = null;
  private dragBefore: EditorSnapshot | null = null;
  private panStart: { point: Point; origin: Point; pointer: number } | null = null;
  private ignoreCanvasClick = false;
  private canvasWidth = 500;
  private resizeObserver?: ResizeObserver;
  private observedCanvas?: Element;

  disconnectedCallback(): void {
    super.disconnectedCallback(); this.resizeObserver?.disconnect(); this.observedCanvas = undefined;
  }

  private baselineIds(): string[] {
    return [...(this.project?.plan?.floors.flatMap((floor) => [floor.id, ...floor.rooms.map((room) => room.id)]) ?? []), ...this.operations.flatMap((operation) => [operation.floor_id, ...(operation.kind === "split" ? [operation.source_room_id, operation.created_room_id] : operation.source_room_ids)])];
  }

  private startBlank(): void {
    if (!this.admin || this.busy) return;
    this.remember(); this.draft = null; this.bindings = {}; this.operations = [];
    this.selectedFloor = ""; this.selectedRoom = ""; this.dirty = true; this.imported = false;
    this.editorOpen = true; this.setStep(1); this.errors = []; this.notice = "Legen Sie das erste Geschoss an.";
  }

  private addFloor(): void {
    if (!this.admin || this.busy) return;
    const result = createFloor(this.draft, this.floorName.trim(), undefined, this.baselineIds());
    if (!result.ok) { this.errors = [result.error]; return; }
    this.remember(); this.draft = result.plan; this.chooseFloor(result.floor.id);
    this.dirty = true; this.editing = true; this.errors = []; this.notice = "Geschoss angelegt. Zeichnen Sie jetzt seine Räume.";
  }

  private changeFloorName(value: string): void {
    if (!this.admin || this.busy || !this.draft || !this.floor) return;
    const result = renameFloor(this.draft, this.floor.id, value);
    if (!result.ok) { this.errors = [result.error]; return; }
    if (value === this.floor.name) return;
    this.remember(); this.draft = result.plan; this.floorName = value; this.dirty = true; this.errors = [];
  }

  private reorderFloor(direction: -1 | 1): void {
    if (!this.admin || this.busy || !this.draft || !this.floor) return;
    const result = moveFloor(this.draft, this.floor.id, direction);
    if (!result.ok) { this.errors = [result.error]; return; }
    this.remember(); this.draft = result.plan; this.dirty = true;
  }

  private resizeCanvas(axis: "width" | "height", value: number): void {
    if (!this.admin || this.busy || !this.floor || !this.draft) return;
    const result = validatePlan({ ...this.draft, floors: this.draft.floors.map((floor) => floor.id === this.floor!.id ? { ...floor, canvas: { ...floor.canvas, [axis]: value } } : floor) });
    if (!result.ok) {
      this.errors = result.errors;
      const field = this.renderRoot.querySelector<HTMLInputElement>(`input[aria-label="Zeichenfläche ${axis === "width" ? "Breite" : "Höhe"}"]`);
      if (field) field.value = String(this.floor.canvas[axis]);
      return;
    }
    this.remember(); this.draft = result.plan; this.zoom = 1; this.viewOrigin = [0, 0]; this.dirty = true; this.errors = [];
  }

  private deleteFloor(): void {
    if (!this.admin || this.busy || !this.floor || !this.draft) return;
    this.remember();
    const floors = this.draft.floors.filter((floor) => floor.id !== this.floor!.id);
    this.draft = floors.length ? { ...this.draft, floors } : null;
    this.bindings = this.draft ? reconcileBindings(this.draft, this.bindings).bindings : {};
    if (this.draft) this.chooseFloor(this.draft.floors[0].id);
    else { this.selectedFloor = ""; this.selectedRoom = ""; this.setStep(1); }
    this.dirty = true; this.floorDelete = false; this.errors = [];
    this.notice = "Geschoss aus dem Entwurf entfernt. Die Änderung bleibt bis zum Speichern rückgängig machbar.";
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.editor-progress button[aria-current="step"]')?.focus());
  }

  private cancelDrawing(): void {
    this.tool = "select"; this.drawingPoints = []; this.splitPreview = null; this.drawStart = null;
    this.panStart = null; this.drag = null; this.dragBefore = null;
    this.editing = this.editorOpen && this.editorStep === 2;
  }

  private selectTool(tool: DrawingTool): void {
    if (!this.admin || this.busy || !this.floor || (tool === "split" && !this.room)) return;
    this.cancelDrawing(); this.tool = tool; this.editing = tool === "select"; this.editorStep = 2;
    this.errors = []; this.newRoomName = "Neuer Raum"; this.splitKeep = "larger"; this.splitName = `${this.room?.name ?? "Raum"} · Teil 2`.slice(0, 120);
    this.splitSensors = Object.fromEntries(bindingFor(this.bindings, this.room?.id ?? "").map((id) => [id, "retained"]));
  }

  private canvasPoint(event: PointerEvent | MouseEvent): Point | null {
    if (!this.floor) return null;
    const element = event.currentTarget as SVGSVGElement, matrix = element.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    let x = Math.max(0, Math.min(point.x, this.floor.canvas.width)), y = Math.max(0, Math.min(point.y, this.floor.canvas.height));
    if (this.snap && this.tool !== "split") {
      const grid = Math.max(this.floor.canvas.width, this.floor.canvas.height) / 60;
      x = Math.round(x / grid) * grid; y = Math.round(y / grid) * grid;
      const vertices = this.floor.rooms.flatMap((room) => room.polygon);
      const nearX = vertices.find((p) => Math.abs(p[0] - x) < grid / 3), nearY = vertices.find((p) => Math.abs(p[1] - y) < grid / 3);
      x = nearX?.[0] ?? x; y = nearY?.[1] ?? y;
    }
    return [Math.round(Math.min(x, this.floor.canvas.width) * 100) / 100, Math.round(Math.min(y, this.floor.canvas.height) * 100) / 100];
  }

  private canvasDown(event: PointerEvent): void {
    if (!this.admin || this.busy) return;
    if (this.tool === "pan") {
      event.preventDefault(); this.panStart = { point: [event.clientX, event.clientY], origin: [...this.viewOrigin], pointer: event.pointerId };
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    } else if (this.tool === "rectangle") {
      const point = this.canvasPoint(event); if (!point) return;
      this.drawStart = { point, pointer: event.pointerId, before: clone(this.drawingPoints), screen: [event.clientX, event.clientY], threshold: event.pointerType === "touch" ? 10 : 6 };
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    }
  }

  private canvasMove(event: PointerEvent): void {
    if (this.busy || !this.admin || !this.floor) return;
    if (this.drag) { this.moveDrag(event); return; }
    if (this.panStart?.pointer === event.pointerId) {
      const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
      this.panBy((this.panStart.point[0] - event.clientX) * this.floor.canvas.width / this.zoom / rect.width,
        (this.panStart.point[1] - event.clientY) * this.floor.canvas.height / this.zoom / rect.height, this.panStart.origin);
    } else if (this.drawStart?.pointer === event.pointerId) {
      const point = this.canvasPoint(event);
      if (point && Math.hypot(event.clientX - this.drawStart.screen[0], event.clientY - this.drawStart.screen[1]) > this.drawStart.threshold) this.drawingPoints = [this.drawStart.point, point];
    }
  }

  private canvasUp(event: PointerEvent): void {
    if (this.drag) { this.finishDrag(); return; }
    if (this.panStart) { this.panStart = null; this.ignoreCanvasClick = true; return; }
    if (!this.drawStart || this.drawStart.pointer !== event.pointerId) return;
    const point = this.canvasPoint(event), start = this.drawStart.point, before = this.drawStart.before, screen = this.drawStart.screen, threshold = this.drawStart.threshold;
    this.drawStart = null;
    if (point && Math.hypot(event.clientX - screen[0], event.clientY - screen[1]) > threshold) {
      this.drawingPoints = [start, point]; this.ignoreCanvasClick = true;
    } else this.drawingPoints = before;
  }

  private canvasClick(event: MouseEvent): void {
    if (this.ignoreCanvasClick) { this.ignoreCanvasClick = false; return; }
    if (!this.admin || this.busy || ["select", "pan"].includes(this.tool)) return;
    const point = this.canvasPoint(event); if (!point) return;
    if (this.tool === "split" && this.room) {
      this.drawingPoints = [...this.drawingPoints.slice(0, 1), nearestBoundaryPoint(this.room.polygon, point)];
      if (this.drawingPoints.length === 2) this.previewSplit();
    } else if (this.tool === "rectangle") this.drawingPoints = this.drawingPoints.length >= 2 ? [point] : [...this.drawingPoints, point];
    else if (this.drawingPoints.length < 500) this.drawingPoints = [...this.drawingPoints, point];
  }

  private drawingPoint(index: number, axis: 0 | 1, value: number): void {
    if (!this.admin || this.busy || !Number.isFinite(value)) return;
    this.drawingPoints = this.drawingPoints.map((point, i) => i === index ? [axis === 0 ? value : point[0], axis === 1 ? value : point[1]] : point);
    this.splitPreview = null;
    if (this.tool === "split" && this.drawingPoints.length === 2) this.previewSplit();
  }

  private finishRoom(): void {
    if (!this.admin || this.busy || !this.draft || !this.floor || !["rectangle", "polygon"].includes(this.tool)) return;
    const polygon = this.tool === "rectangle" && this.drawingPoints.length === 2 ? rectanglePolygon(this.drawingPoints[0], this.drawingPoints[1]) : this.drawingPoints;
    const result = createRoom(this.draft, this.floor.id, this.newRoomName.trim(), polygon, null, this.baselineIds());
    if (!result.ok) { this.errors = [result.error]; return; }
    this.remember(); this.draft = result.plan; this.selectedRoom = result.room.id; this.dirty = true;
    this.cancelDrawing(); this.editing = true; this.errors = []; this.notice = `„${result.room.name}“ angelegt. Ergänzen Sie bei Bedarf Temperatursensoren.`;
  }

  private previewSplit(): void {
    if (!this.admin || this.busy || !this.room || this.drawingPoints.length !== 2) return;
    const previousName = this.splitPreview?.[0].name;
    const id = this.splitPreview?.[1].id ?? uniqueId(this.draft, "room", this.baselineIds());
    const result = splitRoom(this.room, this.drawingPoints[0], this.drawingPoints[1], id, this.splitKeep);
    if (!result.ok) { this.errors = [result.error]; this.splitPreview = null; return; }
    this.splitPreview = previousName ? [{ ...result.rooms[0], name: previousName }, result.rooms[1]] : result.rooms; this.errors = [];
  }

  private acceptSplit(): void {
    if (!this.admin || this.busy || !this.draft || !this.floor || !this.room || !this.splitPreview) return;
    const source = clone(this.room), retained = this.splitPreview[0], created = { ...this.splitPreview[1], name: this.splitName.trim() };
    const candidate = { ...this.draft, floors: this.draft.floors.map((floor) => floor.id === this.floor!.id ? { ...floor, rooms: floor.rooms.flatMap((room) => room.id === source.id ? [retained, created] : [room]) } : floor) };
    const checked = validatePlan(candidate);
    if (!checked.ok) { this.errors = checked.errors; return; }
    this.remember();
    this.operations = [...this.operations, { kind: "split", floor_id: this.floor.id, source_room_id: source.id, created_room_id: created.id, source_polygon: clone(source.polygon), retained_polygon: clone(retained.polygon), created_polygon: clone(created.polygon) }];
    const sensors = bindingFor(this.bindings, source.id);
    this.bindings = { ...this.bindings, [source.id]: sensors.filter((id) => this.splitSensors[id] !== "created"), [created.id]: sensors.filter((id) => this.splitSensors[id] === "created" || this.splitSensors[id] === "both") };
    this.draft = checked.plan; this.dirty = true; this.cancelDrawing(); this.editing = true;
    this.notice = "Raum im Entwurf geteilt. Die Flächen beider Teile sind noch nicht bestätigt."; this.errors = [];
  }

  private finishDrag(cancel = false): void {
    const before = this.dragBefore;
    this.drag = null; this.dragBefore = null;
    if (!before) return;
    if (cancel) { this.draft = before.plan; this.bindings = before.bindings; this.dirty = JSON.stringify({ plan: this.draft, bindings: this.bindings }) !== JSON.stringify({ plan: this.project?.plan ?? null, bindings: this.project?.bindings ?? {} }); }
    else if (JSON.stringify(before.plan) !== JSON.stringify(this.draft)) this.remember(before);
  }

  private panBy(x: number, y: number, origin = this.viewOrigin): void {
    if (!this.floor) return;
    this.viewOrigin = [Math.max(0, Math.min(this.floor.canvas.width * (1 - 1 / this.zoom), origin[0] + x)), Math.max(0, Math.min(this.floor.canvas.height * (1 - 1 / this.zoom), origin[1] + y))];
  }

  private zoomTo(value: number): void {
    if (!this.floor) return;
    const old = this.zoom; this.zoom = Math.max(1, Math.min(4, value));
    this.panBy(this.floor.canvas.width / old / 2 - this.floor.canvas.width / this.zoom / 2, this.floor.canvas.height / old / 2 - this.floor.canvas.height / this.zoom / 2);
  }

  private snapshot(): EditorSnapshot {
    return clone({ plan: this.draft, bindings: this.bindings, operations: this.operations, floor: this.selectedFloor, room: this.selectedRoom, imported: this.imported, step: this.editorStep });
  }

  private remember(before = this.snapshot()): void {
    this.undoStack = [...this.undoStack.slice(-49), before];
    this.redoStack = [];
  }

  private restore(snapshot: EditorSnapshot): void {
    this.draft = clone(snapshot.plan); this.bindings = clone(snapshot.bindings); this.operations = clone(snapshot.operations);
    this.selectedFloor = snapshot.floor; this.selectedRoom = snapshot.room;
    this.imported = snapshot.imported; this.editorStep = snapshot.step; this.showSetup = snapshot.step === 0;
    this.dirty = JSON.stringify({ plan: this.draft, bindings: this.bindings }) !== JSON.stringify({ plan: this.project?.plan ?? null, bindings: this.project?.bindings ?? {} });
    this.errors = []; this.cancelDrawing(); this.zoom = 1; this.viewOrigin = [0, 0];
  }

  private history(redo = false): void {
    if (!this.admin || this.busy) return;
    const stack = redo ? this.redoStack : this.undoStack, previous = stack.at(-1);
    if (!previous) return;
    const current = this.snapshot();
    if (redo) { this.redoStack = stack.slice(0, -1); this.undoStack = [...this.undoStack, current]; }
    else { this.undoStack = stack.slice(0, -1); this.redoStack = [...this.redoStack, current]; }
    this.restore(previous);
    this.notice = redo ? "Bearbeitung wiederholt." : "Bearbeitung rückgängig gemacht.";
  }

  private openEditor(step = 2): void {
    if (!this.admin || this.busy) return;
    this.editorOpen = true; this.setStep(step);
  }

  private setStep(step: number): void {
    if (!this.admin || this.busy) return;
    this.cancelDrawing(); this.editorStep = step; this.showSetup = step === 0;
    this.editing = step === 2;
  }

  setConfig(config: CardConfig): void {
    if (!config || config.type !== "custom:heizlast-ha-card") throw new Error("Kartentyp muss custom:heizlast-ha-card sein.");
    this.config = config;
  }
  static getStubConfig(): CardConfig { return { type: "custom:heizlast-ha-card", title: "Mein Zuhause" }; }
  static getConfigElement(): HTMLElement { return document.createElement("heizlast-ha-card-editor"); }
  getCardSize(): number { return 9; }
  private get admin(): boolean { return this.hass?.user?.is_admin === true; }
  private get floor(): Floor | undefined { return this.draft?.floors.find((floor) => floor.id === this.selectedFloor) ?? this.draft?.floors[0]; }
  private get room(): Room | undefined { return this.floor?.rooms.find((room) => room.id === this.selectedRoom); }

  protected updated(changed: PropertyValues): void {
    if (changed.has("hass") && this.hass && !this.loadStarted) {
      this.loadStarted = true;
      void this.loadProject();
    }
    if (changed.has("showPrompt") && this.showPrompt) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(".dialog button")?.focus());
    if (changed.has("confirmRemoved") && this.confirmRemoved) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(".dialog button")?.focus());
    if (changed.has("floorDelete") && this.floorDelete) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(".dialog button")?.focus());
    if (changed.has("selectedRoom") || changed.has("selectedFloor")) this.mergeTarget = "";
    const canvas = this.renderRoot.querySelector(".editor .plan-svg");
    if (canvas && canvas !== this.observedCanvas && typeof ResizeObserver !== "undefined") {
      this.resizeObserver?.disconnect(); this.observedCanvas = canvas;
      this.resizeObserver = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && Math.abs(entry.contentRect.width - this.canvasWidth) > 1) this.canvasWidth = entry.contentRect.width; });
      this.resizeObserver.observe(canvas);
    }
  }

  private async loadProject(): Promise<void> {
    if (!this.hass) return;
    this.loading = true;
    this.errors = [];
    try {
      const project = await this.hass.callWS<Project>({ type: "heizlast_ha/get_project" });
      this.project = project;
      this.resetDraft();
      this.showSetup = !project.plan;
      this.editorOpen = !project.plan && this.admin;
      this.editorStep = 0;
      this.conflict = false;
      this.notice = "";
    } catch (error) { this.errors = [`Projekt konnte nicht geladen werden. ${failureMessage(error)}`]; }
    finally { this.loading = false; }
  }

  private resetDraft(): void {
    this.draft = clone(this.project?.plan ?? null);
    this.bindings = clone(this.project?.bindings ?? {});
    this.imported = false;
    this.dirty = false;
    this.editing = false;
    this.confirmRemoved = null;
    this.mergeTarget = "";
    this.drag = null;
    this.operations = []; this.undoStack = []; this.redoStack = []; this.cancelDrawing();
    if (this.draft?.floors.length) this.chooseFloor(this.draft.floors[0].id);
    else { this.selectedFloor = ""; this.selectedRoom = ""; }
  }

  private chooseFloor(id: string): void {
    this.selectedFloor = id;
    const floor = this.draft?.floors.find((floor) => floor.id === id);
    this.selectedRoom = floor?.rooms[0]?.id ?? "";
    if (floor) { this.floorId = floor.id; this.floorName = floor.name; }
    this.editing = false;
    this.mergeTarget = "";
    this.drag = null;
    this.cancelDrawing(); this.zoom = 1; this.viewOrigin = [0, 0];
  }

  private async sample(): Promise<void> {
    if (!this.admin || this.busy) return;
    try {
      const { default: samplePlan } = await import("../../examples/ground-floor.json");
      this.jsonText = JSON.stringify(samplePlan, null, 2);
      this.checkImport();
    } catch (error) { this.errors = [`Beispiel konnte nicht geladen werden. ${failureMessage(error)}`]; }
  }

  private async readJson(file?: File): Promise<void> {
    if (!file || !this.admin || this.busy) return;
    if (file.size > 2 * 1024 * 1024) { this.errors = ["Die JSON-Datei darf höchstens 2 MiB groß sein."]; return; }
    try { this.jsonText = await file.text(); this.checkImport(); }
    catch { this.errors = ["Die JSON-Datei konnte nicht gelesen werden."]; }
  }

  private checkImport(): void {
    if (!this.admin || !this.project || this.busy) return;
    const result = parseImport(this.jsonText);
    if (!result.ok) { this.errors = result.errors; this.notice = ""; return; }
    this.remember();
    this.draft = result.plan;
    this.operations = [];
    this.bindings = reconcileBindings(result.plan, { ...this.project.bindings, ...this.bindings }).bindings;
    this.imported = true;
    this.dirty = true;
    this.editing = false;
    this.chooseFloor(result.plan.floors[0].id);
    this.editorOpen = true; this.editorStep = 1; this.showSetup = false; this.editing = true;
    this.errors = [];
    this.notice = "Import geprüft. Alle Etagen sind in der Vorschau. Prüfen Sie Raumkonturen, Namen und Anordnung. Übernehmen Sie anschließend den Import ausdrücklich.";
  }

  private updateRoom(update: (room: Room) => Room): boolean {
    if (!this.admin || !this.room || !this.draft || this.busy) return false;
    const id = this.room.id;
    const candidate = { ...this.draft, floors: this.draft.floors.map((floor) => ({ ...floor, rooms: floor.rooms.map((room) => room.id === id ? update(room) : room) })) };
    const result = validatePlan(candidate);
    if (!result.ok) { this.errors = result.errors; return false; }
    if (JSON.stringify(result.plan) === JSON.stringify(this.draft)) return true;
    if (!this.drag) this.remember();
    this.draft = result.plan;
    this.dirty = true;
    this.errors = [];
    return true;
  }

  private connectRooms(): void {
    if (!this.admin || this.busy || !this.draft || !this.floor || !this.room) return;
    const source = this.room, target = this.floor.rooms.find((room) => room.id === this.mergeTarget && room.id !== source.id);
    if (!target) return;
    const checked = validatePlan(this.draft);
    if (!checked.ok) { this.errors = checked.errors; return; }
    try {
      const merged = mergeRooms(source, target);
      if (!merged.ok) { this.errors = [merged.error]; return; }
      const draft = { ...this.draft, floors: this.draft.floors.map((floor) => floor.id === this.floor!.id ? { ...floor, rooms: floor.rooms.filter((room) => room.id !== target.id).map((room) => room.id === source.id ? merged.room : room) } : floor) };
      const result = validatePlan(draft);
      if (!result.ok) { this.errors = result.errors; return; }
      const sensors = [...new Set([...bindingFor(this.bindings, source.id), ...bindingFor(this.bindings, target.id)])];
      if (sensors.length > 100) { this.errors = ["Der verbundene Raum darf höchstens 100 Temperatursensoren haben. Entfernen Sie zunächst nicht benötigte Zuordnungen."]; return; }
      this.remember();
      this.operations = [...this.operations, { kind: "merge", floor_id: this.floor.id, source_room_ids: [source.id, target.id], source_polygons: [clone(source.polygon), clone(target.polygon)], result_polygon: clone(merged.room.polygon) }];
      this.draft = result.plan;
      this.bindings = reconcileBindings(result.plan, { ...this.bindings, [source.id]: sensors }).bindings;
      this.mergeTarget = "";
      this.drag = null;
      this.dirty = true;
      this.errors = [];
      this.notice = `„${source.name}“ und „${target.name}“ sind in der Vorschau verbunden. Name und ID von „${source.name}“ bleiben erhalten; die Sensorzuordnungen beider Räume werden übernommen. Speichern Sie die Änderung, um sie zu übernehmen.`;
    } catch (error) { this.errors = [failureMessage(error)]; }
  }

  private deleteRoom(): void {
    if (!this.admin || this.busy || !this.draft || !this.floor || !this.room) return;
    const room = this.room, floorId = this.floor.id;
    this.remember();
    this.draft = { ...this.draft, floors: this.draft.floors.map((floor) => floor.id === floorId ? { ...floor, rooms: floor.rooms.filter((candidate) => candidate.id !== room.id) } : floor) };
    this.bindings = reconcileBindings(this.draft, this.bindings).bindings;
    this.selectedRoom = this.floor!.rooms[0]?.id ?? "";
    this.mergeTarget = "";
    this.editing = false;
    this.drag = null;
    this.dirty = true;
    this.errors = [];
    this.notice = `„${room.name}“ ist aus der Vorschau entfernt. Beim Speichern werden auch seine Sensorzuordnungen entfernt.`;
  }

  private discardChanges(): void {
    if (!this.admin || this.busy) return;
    this.resetDraft();
    if (!this.draft) { this.editorStep = 0; this.showSetup = true; }
    this.editing = this.editorOpen && this.editorStep === 2;
    this.notice = "Änderungen verworfen; gespeicherter Grundriss wiederhergestellt.";
    this.errors = [];
  }

  private setPoint(index: number, axis: 0 | 1, value: number): void {
    if (!Number.isFinite(value)) {
      const field = this.renderRoot.querySelector<HTMLInputElement>(`input[aria-label="Punkt ${index + 1} ${axis === 0 ? "x" : "y"}"]`);
      if (field && this.room) field.value = String(this.room.polygon[index][axis]);
      this.errors = [`Raum „${this.room?.name}“, Punkt ${index + 1}: Bitte eine endliche Zahl eintragen. Die letzte gültige Koordinate bleibt erhalten.`];
      return;
    }
    if (!this.updateRoom((room) => ({ ...room, polygon: room.polygon.map((point, i) => i === index ? [axis === 0 ? value : point[0], axis === 1 ? value : point[1]] : point) }))) {
      const field = this.renderRoot.querySelector<HTMLInputElement>(`input[aria-label="Punkt ${index + 1} ${axis === 0 ? "x" : "y"}"]`);
      if (field && this.room) field.value = String(this.room.polygon[index][axis]);
    }
  }

  private addPoint(index: number): void {
    this.updateRoom((room) => {
      if (room.polygon.length >= 500) { this.errors = ["Ein Raum darf höchstens 500 Polygonpunkte haben."]; return room; }
      const a = room.polygon[index], b = room.polygon[(index + 1) % room.polygon.length];
      const point: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      return { ...room, polygon: [...room.polygon.slice(0, index + 1), point, ...room.polygon.slice(index + 1)] };
    });
  }

  private removePoint(index: number): void {
    this.updateRoom((room) => room.polygon.length > 3 ? { ...room, polygon: room.polygon.filter((_, i) => i !== index) } : room);
  }

  private beginDrag(event: PointerEvent, index: number): void {
    if (!this.editing || !this.room || !this.admin || this.busy) return;
    event.preventDefault(); event.stopPropagation();
    this.dragBefore = this.snapshot();
    this.drag = { index, room: this.room.id, pointer: event.pointerId };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (!this.drag || !this.room || !this.floor || this.drag.room !== this.room.id || this.drag.pointer !== event.pointerId) return;
    const element = event.currentTarget as SVGSVGElement, matrix = element.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const x = Math.round(Math.max(0, Math.min(point.x, this.floor.canvas.width)) * 100) / 100;
    const y = Math.round(Math.max(0, Math.min(point.y, this.floor.canvas.height)) * 100) / 100;
    const index = this.drag.index;
    this.updateRoom((room) => ({ ...room, polygon: room.polygon.map((p, i) => i === index ? [x, y] : p) }));
  }

  private toggleSensor(id: string, checked: boolean): void {
    if (!this.room || !this.admin || this.busy) return;
    const selected = bindingFor(this.bindings, this.room.id);
    if (checked && selected.length >= 100) { this.errors = ["Ein Raum darf höchstens 100 Temperatursensoren haben."]; return; }
    this.remember();
    this.bindings = { ...this.bindings, [this.room.id]: checked ? [...new Set([...selected, id])] : selected.filter((sensor) => sensor !== id) };
    this.dirty = true;
  }

  private async save(confirmed = false): Promise<void> {
    if (!this.project || !this.hass || !this.admin || this.busy || this.drawingPoints.length || this.splitPreview) return;
    const result = this.draft ? validatePlan(this.draft) : { ok: true as const, plan: null };
    if (!result.ok) { this.errors = result.errors; return; }
    const nextIds = new Set(roomIds(result.plan));
    const removed = roomIds(this.project.plan).filter((id) => !nextIds.has(id));
    if (removed.length && !confirmed) { this.returnFocus = this.shadowRoot?.activeElement as HTMLElement | undefined; this.confirmRemoved = removed; return; }
    this.busy = true;
    this.errors = [];
    try {
      const project = await this.hass.callWS<Project>({ type: "heizlast_ha/save_project", revision: this.project.revision, plan: result.plan, bindings: this.bindings, confirmed_removed_room_ids: removed, room_operations: this.operations });
      const floor = this.selectedFloor, room = this.selectedRoom;
      this.project = project;
      this.resetDraft();
      if (this.draft?.floors.some((f) => f.id === floor)) this.chooseFloor(floor);
      if (this.floor?.rooms.some((r) => r.id === room)) this.selectedRoom = room;
      this.showSetup = !project.plan; this.editorOpen = !project.plan; this.editorStep = 0;
      this.notice = "Grundriss und Sensorzuordnungen sind gespeichert.";
      this.conflict = false;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      this.conflict = code === "conflict";
      this.errors = [this.conflict ? "Das Projekt wurde zwischenzeitlich geändert. Ihre Vorschau ist erhalten. Exportieren Sie Ihre Änderungen und laden Sie dann die aktuelle Version neu." : `Speichern fehlgeschlagen. Ihre Änderungen sind erhalten. ${failureMessage(error)}`];
    } finally { this.busy = false; this.confirmRemoved = null; }
  }

  private exportDraft(): void {
    const blob = new Blob([JSON.stringify({ plan: this.draft, bindings: this.bindings, room_operations: this.operations }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "heizlast-ha-aenderungen.json"; anchor.click(); URL.revokeObjectURL(url);
    this.notice = "Änderungen als Sicherung exportiert. Die Sicherung enthält plan und bindings; beim JSON-Import nur den Inhalt von plan verwenden.";
  }

  private openPrompt(): void {
    const missing = promptRequirements(this.floorId, this.floorName);
    if (missing.length) { this.errors = missing; return; }
    this.returnFocus = this.shadowRoot?.activeElement as HTMLElement | undefined;
    this.copied = ""; this.showPrompt = true;
  }

  private closeDialog(): void {
    this.showPrompt = false;
    this.confirmRemoved = null;
    this.floorDelete = false; this.splitPreview = null;
    void this.updateComplete.then(() => this.returnFocus?.focus());
  }

  private dialogKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !this.busy) { event.preventDefault(); this.closeDialog(); return; }
    if (event.key !== "Tab") return;
    const elements = [...this.renderRoot.querySelectorAll<HTMLElement>('.dialog button:not([disabled]), .dialog a[href], .dialog textarea, .dialog input:not([disabled]), .dialog select:not([disabled])')];
    const first = elements[0], last = elements.at(-1), current = this.shadowRoot?.activeElement;
    if (event.shiftKey && current === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && current === last) { event.preventDefault(); first?.focus(); }
  }

  private async copy(): Promise<void> {
    const success = await copyPrompt(buildPrompt(this.floorId, this.floorName));
    this.copied = success ? "Prompt kopiert." : "Zwischenablage nicht verfügbar. Der Prompt ist markiert; bitte manuell kopieren (Strg/Cmd+C).";
    if (!success) { const field = this.renderRoot.querySelector<HTMLTextAreaElement>(".prompt-text"); field?.focus(); field?.select(); }
  }

  protected render() {
    return html`<div class=${`card ${this.editorOpen && this.admin ? "editor" : ""}`}>
      <header class="editor-header"><div class="brand"><div class="brand-icon">${houseIcon}</div><div><h1>${this.config.title ?? "Mein Zuhause"}</h1><p class="subline">${this.editorOpen ? "Grundriss bearbeiten" : "Grundriss & Raumtemperaturen"}</p></div></div><span class="badge">${this.dirty ? "Ungespeicherte Änderungen" : "Heizlast HA"}</span></header>
      ${this.loading ? html`<div class="empty"><p>Projekt wird aus Home Assistant geladen …</p></div>` : html`
        <div class="toolbar"><div class="floor-tabs" aria-label="Etagen">${!this.editorOpen ? this.draft?.floors.map((floor) => html`<button class=${floor.id === this.floor?.id ? "active" : ""} @click=${() => this.chooseFloor(floor.id)} aria-pressed=${floor.id === this.floor?.id}>${floor.name}</button>`) : html`<span>Zeicheneditor</span>`}</div>
          <div class="actions">${this.admin && this.project ? html`${!this.editorOpen && this.draft ? html`<button @click=${() => this.openEditor()}>Grundriss bearbeiten</button>` : nothing}<button ?disabled=${this.busy} @click=${() => { if (this.editorOpen && this.editorStep === 0 && this.draft) { this.editorOpen = false; this.showSetup = false; } else this.openEditor(0); }}>${this.showSetup && this.draft ? "Einrichtung schließen" : "Grundriss einrichten"}</button>${this.dirty ? html`${!this.imported ? html`<button ?disabled=${this.busy} @click=${() => this.discardChanges()}>Änderungen verwerfen</button>` : nothing}<button class="primary" ?disabled=${this.busy || this.drawingPoints.length > 0 || !!this.splitPreview} @click=${() => void this.save()}>${this.busy ? "Wird gespeichert …" : this.imported ? "Import übernehmen" : "Änderungen speichern"}</button>` : nothing}` : nothing}</div>
        </div>
        ${!this.admin ? html`<div class="notice warning">Ansicht ohne Bearbeitungsrechte. Grundriss, Räume und Sensorwerte sind sichtbar; für Import, Korrekturen und Zuordnungen benötigt Ihr Konto Administratorrechte.</div>` : nothing}
        ${this.errors.length ? html`<div class="notice error" role="alert"><strong>Bitte prüfen</strong><ul>${this.errors.map((error) => html`<li>${error}</li>`)}</ul>${this.conflict ? html`<div class="actions" style="margin-top:10px"><button @click=${() => this.exportDraft()}>Änderungen sichern</button><button @click=${() => void this.loadProject()}>Aktuelle Version laden</button></div>` : !this.project ? html`<button @click=${() => void this.loadProject()}>Erneut laden</button>` : nothing}</div>` : nothing}
        ${this.notice ? html`<div class="notice" role="status">${this.notice}</div>` : nothing}
        ${this.imported ? html`<div class="notice warning"><strong>Vorschau · noch nicht gespeichert</strong><p>Prüfen Sie alle ${this.draft?.floors.length} Etage(n) und Raumgrenzen. Gleiche Raum-IDs behalten ihre Sensorzuordnungen.</p><button ?disabled=${this.busy} @click=${() => this.discardChanges()}>Vorschau verwerfen</button></div>` : nothing}
        ${this.editorOpen && this.admin && this.project ? this.renderEditor() : html`${this.showSetup && this.admin && this.project ? this.renderSetup() : nothing}${this.floor ? this.renderFloor(this.floor) : html`<div class="empty"><div class="empty-symbol">${houseIcon}</div><h2>Räume sichtbar machen</h2><p>${this.admin ? "Erstellen Sie einen neuen Grundriss oder importieren Sie die JSON-Antwort Ihres LLM." : "Ein Administrator kann den ersten Grundriss anlegen."}</p></div>`}`}
      `}
      <div class="footer"><span>Digitaler Grundriss · auswählbare Räume</span><span>Temperaturanzeige · Wärmebedarfsberechnung folgt später</span></div>
    </div>${this.showPrompt ? this.renderPrompt() : nothing}${this.confirmRemoved ? this.renderConfirmation() : nothing}${this.floorDelete ? this.renderFloorDelete() : nothing}`;
  }

  private renderEditor() {
    const steps = ["Quelle", "Geschosse", "Räume", "Sensoren", "Prüfen"];
    return html`<nav class="editor-progress" aria-label="Grundriss erstellen">${steps.map((name, index) => html`<button ?disabled=${this.busy || (index > 1 && !this.draft)} aria-current=${this.editorStep === index ? "step" : nothing} @click=${() => this.setStep(index)}><span class="step-number">${index + 1}</span> ${name}</button>${index < 4 ? html`<span class="step-separator" aria-hidden="true">—</span>` : nothing}`)}</nav>
      ${this.editorStep === 0 ? html`<section class="editor-step"><div class="editor-step-heading"><h2>Wie möchten Sie beginnen?</h2><p class="hint">JSON-Import und Neuanlage führen in denselben Editor.</p></div><div class="editor-source-options"><div class="editor-source-option"><h3>Neuer Grundriss</h3><p>Geschosse und Räume direkt zeichnen.</p><button class="primary" ?disabled=${this.busy} @click=${() => this.startBlank()}>Neuen Grundriss erstellen</button></div><div class="editor-source-option"><h3>LLM-JSON</h3><p>Vorhandene Konturen importieren und weiterbearbeiten.</p><p class="hint">Originaldokumente bleiben lokal. Für externe LLM nur vollständig anonymisierte Pläne verwenden.</p></div></div></section>${this.renderSetup()}` : nothing}
      ${this.editorStep === 4 ? this.renderReview() : nothing}
      ${this.editorStep === 3 ? html`<section class="editor-step"><h2>Temperatursensoren prüfen</h2><div class="editor-room-group">${this.draft?.floors.map((floor) => html`<h3>${floor.name}</h3>${floor.rooms.map((room) => html`<button ?disabled=${this.busy} @click=${() => { this.chooseFloor(floor.id); this.selectedRoom = room.id; }} aria-pressed=${this.selectedRoom === room.id}>${room.name} · ${bindingFor(this.bindings, room.id).length ? `${bindingFor(this.bindings, room.id).length} Sensor(en)` : "Kein Sensor zugeordnet"}</button>`)}`)}</div></section>` : nothing}
      <div class="editor-layout"><nav class="editor-rail" aria-label="Geschosse und Räume"><div class="editor-rail-heading"><h3>Geschosse</h3><button aria-label="Geschoss hinzufügen" ?disabled=${this.busy} @click=${() => { this.floorName = `Geschoss ${(this.draft?.floors.length ?? 0) + 1}`; this.addFloor(); this.setStep(1); }}>+</button></div>${this.draft?.floors.map((floor) => html`<div class="editor-floor-group"><button class="editor-floor" aria-pressed=${floor.id === this.floor?.id} ?disabled=${this.busy} @click=${() => { this.chooseFloor(floor.id); this.editing = this.editorStep === 2; }}>${floor.name}</button>${floor.id === this.floor?.id ? html`<div class="editor-room-group">${floor.rooms.map((room) => html`<button class="editor-room" aria-pressed=${room.id === this.selectedRoom} ?disabled=${this.busy} @click=${() => { this.cancelDrawing(); this.selectedRoom = room.id; this.editing = this.editorStep === 2; }}>${room.name}</button>`)}</div>` : nothing}</div>`) ?? html`<p class="hint">Noch kein Geschoss.</p>`}<div class="editor-rail-actions"><button ?disabled=${this.busy || !this.floor} @click=${() => this.selectTool("rectangle")}>+ Raum hinzufügen</button></div></nav>
      <section class="editor-canvas" aria-label="Grundriss zeichnen"><div class="editor-tools" role="toolbar" aria-label="Zeichenwerkzeuge">${([["select", "Auswahl"], ["rectangle", "Rechteck"], ["polygon", "Polygon"], ["split", "Teilen"], ["pan", "Verschieben"]] as [DrawingTool, string][]).map(([tool, label]) => html`<button class="editor-tool" aria-pressed=${this.tool === tool} ?disabled=${this.busy || !this.floor || (tool === "split" && !this.room)} @click=${() => this.selectTool(tool)}>${label}</button>`)}<button ?disabled=${this.busy || !this.room || (this.floor?.rooms.length ?? 0) < 2} @click=${() => { this.setStep(2); void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLSelectElement>('select[aria-label="Mit Raum verbinden"]')?.focus()); }}>Verbinden</button></div>
      ${this.floor ? this.renderEditorCanvas(this.floor) : html`<div class="empty"><h2>Erstes Geschoss anlegen</h2><p>Geben Sie rechts einen Namen ein und wählen Sie „Geschoss anlegen“.</p></div>`}</section>
      <aside class="editor-inspector" aria-label="Eigenschaften">${this.editorStep === 1 || !this.floor ? this.renderFloorProperties() : ["rectangle", "polygon", "split"].includes(this.tool) ? this.renderDrawingProperties() : this.room ? this.renderEditorRoom(this.room) : html`<h3>Raum anlegen</h3><p class="hint">Zeichnen Sie ein Rechteck oder Polygon. Für ein Rechteck können Sie zwei gegenüberliegende Eckpunkte antippen.</p><button ?disabled=${this.busy} @click=${() => this.selectTool("rectangle")}>Raum hinzufügen</button>`}</aside></div>
      <div class="editor-footer"><div class="actions"><button ?disabled=${this.busy || !this.undoStack.length} @click=${() => this.history()}>Rückgängig</button><button ?disabled=${this.busy || !this.redoStack.length} @click=${() => this.history(true)}>Wiederholen</button></div><span role="status">${this.dirty ? "Entwurf · noch nicht gespeichert" : "Gespeicherter Stand"}</span></div>
      <div class="editor-step-actions"><button ?disabled=${this.busy || this.editorStep === 0} @click=${() => this.setStep(this.editorStep - 1)}>Zurück</button><button class="primary" ?disabled=${this.busy || this.editorStep === 4 || (!this.draft && this.editorStep >= 1)} @click=${() => this.setStep(this.editorStep + 1)}>Weiter${this.editorStep < 4 ? ` zu ${steps[this.editorStep + 1]}` : ""}</button></div>`;
  }

  private renderFloorProperties() {
    const index = this.draft?.floors.findIndex((floor) => floor.id === this.floor?.id) ?? -1;
    return html`<h3>${this.floor ? "Geschoss bearbeiten" : "Geschoss anlegen"}</h3><label class="field"><span>Geschossname</span><input aria-label="Geschossname" maxlength="120" .value=${this.floor?.name ?? this.floorName} ?disabled=${this.busy} @change=${(event: Event) => { const value = (event.target as HTMLInputElement).value; if (this.floor) { this.changeFloorName(value); (event.target as HTMLInputElement).value = this.floor.name; } else this.floorName = value; }}/></label>${this.floor ? html`<div class="field-row">${(["width", "height"] as const).map((axis) => html`<label><span>${axis === "width" ? "Breite" : "Höhe"}</span><input type="number" aria-label=${`Zeichenfläche ${axis === "width" ? "Breite" : "Höhe"}`} min="1" max="8192" .value=${String(this.floor!.canvas[axis])} ?disabled=${this.busy} @change=${(event: Event) => this.resizeCanvas(axis, (event.target as HTMLInputElement).valueAsNumber)}/></label>`)}</div><p class="hint">Zeicheneinheiten sind kein metrischer Maßstab.</p><div class="actions"><button ?disabled=${this.busy || index <= 0} @click=${() => this.reorderFloor(-1)}>Nach oben</button><button ?disabled=${this.busy || index >= (this.draft?.floors.length ?? 0) - 1} @click=${() => this.reorderFloor(1)}>Nach unten</button></div><button class="danger" ?disabled=${this.busy} @click=${() => { this.returnFocus = this.shadowRoot?.activeElement as HTMLElement; this.floorDelete = true; }}>Geschoss löschen</button><button class="primary" ?disabled=${this.busy} @click=${() => this.setStep(2)}>Räume bearbeiten</button>` : html`<button class="primary" ?disabled=${this.busy} @click=${() => this.addFloor()}>Geschoss anlegen</button>`}`;
  }

  private renderEditorCanvas(floor: Floor) {
    const grid = Math.max(floor.canvas.width, floor.canvas.height) / 60;
    const preview = this.tool === "rectangle" && this.drawingPoints.length === 2 ? rectanglePolygon(this.drawingPoints[0], this.drawingPoints[1]) : this.drawingPoints;
    return html`<div class="editor-canvas-heading plan-heading"><strong>${floor.name} · ${floor.rooms.length} Räume</strong><span>${floor.canvas.width} × ${floor.canvas.height}</span></div><div class="plan-frame"><svg class="plan-svg editing" viewBox=${`${this.viewOrigin[0]} ${this.viewOrigin[1]} ${floor.canvas.width / this.zoom} ${floor.canvas.height / this.zoom}`} style=${`aspect-ratio:${floor.canvas.width}/${floor.canvas.height}`} role="group" aria-label=${`Grundriss ${floor.name}`} @pointerdown=${(event: PointerEvent) => this.canvasDown(event)} @pointermove=${(event: PointerEvent) => this.canvasMove(event)} @pointerup=${(event: PointerEvent) => this.canvasUp(event)} @pointercancel=${() => { this.finishDrag(true); this.drawStart = null; this.panStart = null; }} @click=${(event: MouseEvent) => this.canvasClick(event)}>
        <defs><pattern id="editor-grid" width=${grid} height=${grid} patternUnits="userSpaceOnUse"><path class="grid-line" d=${`M ${grid} 0 L 0 0 0 ${grid}`} fill="none"/></pattern></defs>${this.snap ? svg`<rect x="0" y="0" width=${floor.canvas.width} height=${floor.canvas.height} fill="url(#editor-grid)"/>` : nothing}
        ${floor.rooms.map((room) => svg`<polygon class=${`room-shape ${room.id === this.selectedRoom ? "selected" : ""}`} points=${room.polygon.map((point) => point.join(",")).join(" ")} tabindex="0" role="button" aria-label=${`${room.name} auswählen`} aria-pressed=${room.id === this.selectedRoom} @click=${(event: MouseEvent) => { if (this.tool === "select") { event.stopPropagation(); this.selectedRoom = room.id; } }} @keydown=${(event: KeyboardEvent) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); this.cancelDrawing(); this.selectedRoom = room.id; this.editing = this.editorOpen && this.editorStep === 2; } }}/>`)}
        ${floor.rooms.map((room, index) => { if (this.splitPreview && room.id === this.selectedRoom) return nothing; const [x, y] = interiorLabelPoint(room.polygon); return svg`<defs><clipPath id=${`label-clip-${index}`}><path d=${`M${room.polygon.map((point) => point.join(",")).join("L")}Z`}/></clipPath></defs><text class="room-label" style=${`font-size:${13 * floor.canvas.width / this.zoom / this.canvasWidth}px`} clip-path=${`url(#label-clip-${index})`} x=${x} y=${y}>${room.name.length > 24 ? `${room.name.slice(0, 23)}…` : room.name}</text>`; })}
        ${this.editing && this.tool === "select" && this.room ? this.room.polygon.map((point, index) => svg`<circle class="vertex" cx=${point[0]} cy=${point[1]} r=${Math.max(floor.canvas.width / 110 / this.zoom, 4)} @pointerdown=${(event: PointerEvent) => this.beginDrag(event, index)}/>`): nothing}
        ${this.splitPreview ? this.splitPreview.map((room, index) => svg`<path class=${`split-preview part-${index}`} d=${`M${room.polygon.map((point) => point.join(",")).join("L")}Z`}/>`): preview.length ? svg`<path class=${this.tool === "split" ? "split-line" : "drawing-preview"} d=${`M${preview.map((point) => point.join(",")).join("L")}${this.tool === "rectangle" || (this.tool === "polygon" && preview.length >= 3) ? "Z" : ""}`}/>` : nothing}
        ${this.splitPreview ? this.splitPreview.map((room, index) => { const [x, y] = interiorLabelPoint(room.polygon); return svg`<text class="room-label" style=${`font-size:${13 * floor.canvas.width / this.zoom / this.canvasWidth}px`} x=${x} y=${y}>${index === 0 ? room.name : this.splitName}</text>`; }) : nothing}
        ${this.drawingPoints.map((point) => svg`<circle class="draft-point" cx=${point[0]} cy=${point[1]} r=${Math.max(floor.canvas.width / 140 / this.zoom, 3)}/>`)}
      </svg></div><div class="editor-canvas-footer"><span>${this.tool === "split" ? "Zwei Grenzpunkte für die Teilung wählen" : this.tool === "rectangle" ? "Rechteck ziehen oder zwei Eckpunkte antippen" : this.tool === "polygon" ? "Eckpunkte setzen, dann Raum fertigstellen" : this.tool === "pan" ? "Zeichenfläche ziehen oder Pfeile verwenden" : "Raum auswählen · Eckpunkte bearbeiten"}</span><label><input type="checkbox" .checked=${this.snap} @change=${(event: Event) => this.snap = (event.target as HTMLInputElement).checked}/> Raster</label><div class="actions"><button aria-label="Verkleinern" ?disabled=${this.zoom <= 1} @click=${() => this.zoomTo(this.zoom / 1.25)}>−</button><span>${Math.round(this.zoom * 100)} %</span><button aria-label="Vergrößern" ?disabled=${this.zoom >= 4} @click=${() => this.zoomTo(this.zoom * 1.25)}>+</button><button @click=${() => { this.zoom = 1; this.viewOrigin = [0, 0]; }}>Alles anzeigen</button></div>${this.zoom > 1 ? html`<div class="actions">${([["Links", -1, 0], ["Rechts", 1, 0], ["Oben", 0, -1], ["Unten", 0, 1]] as [string, number, number][]).map(([label, x, y]) => html`<button aria-label=${`Ansicht nach ${label}`} @click=${() => this.panBy(x * floor.canvas.width / this.zoom / 5, y * floor.canvas.height / this.zoom / 5)}>${label}</button>`)}</div>` : nothing}</div>`;
  }

  private renderDrawingProperties() {
    const split = this.tool === "split", maximum = this.tool === "polygon" ? 500 : 2;
    return html`<h3>${split ? "Raum teilen" : "Raum anlegen"}</h3>${!split ? html`<label class="field"><span>Raumname</span><input aria-label="Name des neuen Raums" maxlength="120" .value=${this.newRoomName} ?disabled=${this.busy} @input=${(event: Event) => this.newRoomName = (event.target as HTMLInputElement).value}/></label>` : html`<p class="hint">Wählen Sie zwei Punkte auf der Grenze von „${this.room?.name}“. Die Schnittlinie muss innerhalb des Raums verlaufen.</p>`}
      <p class="hint">Punkte im Plan setzen oder über die folgenden Koordinaten eingeben.</p><div class="points">${this.drawingPoints.map(([x, y], index) => html`<div class="point"><span>${index + 1}</span><input type="number" aria-label=${`Zeichenpunkt ${index + 1} x`} .value=${live(String(x))} ?disabled=${this.busy} @input=${(event: Event) => this.drawingPoint(index, 0, (event.target as HTMLInputElement).valueAsNumber)}/><input type="number" aria-label=${`Zeichenpunkt ${index + 1} y`} .value=${live(String(y))} ?disabled=${this.busy} @input=${(event: Event) => this.drawingPoint(index, 1, (event.target as HTMLInputElement).valueAsNumber)}/><button aria-label=${`Zeichenpunkt ${index + 1} entfernen`} ?disabled=${this.busy} @click=${() => { this.drawingPoints = this.drawingPoints.filter((_, i) => i !== index); this.splitPreview = null; }}>−</button></div>`)}</div>
      <button ?disabled=${this.busy || this.drawingPoints.length >= maximum} @click=${() => { const index = this.drawingPoints.length; this.drawingPoints = [...this.drawingPoints, [100 + index * 100, 100 + index * 100]]; }}>Punkt hinzufügen</button>
      ${split ? html`<button ?disabled=${this.busy || this.drawingPoints.length !== 2} @click=${() => this.previewSplit()}>Teilung prüfen</button>${this.splitPreview ? html`<div class="section"><h3>Teilungsvorschau</h3><p class="hint">Bisherige Fläche: ${this.room?.area_m2 === null ? "nicht bestätigt" : `${this.room?.area_m2} m²`}. Beide Teilflächen bleiben bis zu Ihrer Bestätigung offen.</p><label class="field"><span>Teil mit ursprünglicher ID und Sensoren</span><select aria-label="Ursprüngliche ID behalten" .value=${this.splitKeep} ?disabled=${this.busy} @change=${(event: Event) => { this.splitKeep = (event.target as HTMLSelectElement).value as "larger" | "smaller"; this.previewSplit(); }}><option value="larger">Größerer Teil</option><option value="smaller">Kleinerer Teil</option></select></label><label class="field"><span>Name mit bisheriger ID</span><input aria-label="Name erster Teilraum" maxlength="120" .value=${this.splitPreview[0].name} ?disabled=${this.busy} @input=${(event: Event) => { this.splitPreview = [{ ...this.splitPreview![0], name: (event.target as HTMLInputElement).value }, this.splitPreview![1]]; }}/></label><p class="hint">ID: ${this.splitPreview[0].id}</p><label class="field"><span>Name des neuen Teils</span><input aria-label="Name zweiter Teilraum" maxlength="120" .value=${this.splitName} ?disabled=${this.busy} @input=${(event: Event) => this.splitName = (event.target as HTMLInputElement).value}/></label><p class="hint">Neue ID: ${this.splitPreview[1].id}</p><h3>Sensorverteilung</h3>${bindingFor(this.bindings, this.room?.id ?? "").map((id) => html`<label class="field"><span>${entityName(this.hass?.states[id], this.hass) ?? id}</span><select aria-label=${`Sensorverteilung ${id}`} .value=${this.splitSensors[id] ?? "retained"} ?disabled=${this.busy} @change=${(event: Event) => this.splitSensors = { ...this.splitSensors, [id]: (event.target as HTMLSelectElement).value as "retained" | "created" | "both" }}><option value="retained">Teil mit bisheriger ID</option><option value="created">Neuer Teilraum</option><option value="both">Beide Teile</option></select></label>`)}<button class="primary" ?disabled=${this.busy} @click=${() => this.acceptSplit()}>Teilung übernehmen</button></div>` : nothing}` : html`<button class="primary" ?disabled=${this.busy || !this.newRoomName.trim() || (this.tool === "rectangle" ? this.drawingPoints.length !== 2 : this.drawingPoints.length < 3)} @click=${() => this.finishRoom()}>Raum fertigstellen</button>`}<button ?disabled=${this.busy} @click=${() => this.cancelDrawing()}>Abbrechen</button>`;
  }

  private renderEditorRoom(room: Room) {
    const selected = bindingFor(this.bindings, room.id), sensors = this.hass ? temperatureSensors(this.hass) : [];
    const filter = this.sensorSearch.trim().toLocaleLowerCase();
    const allSensors = [...sensors.filter((state) => selected.includes(state.entity_id) || `${state.entity_id} ${entityName(state, this.hass) ?? ""}`.toLocaleLowerCase().includes(filter)).map((state) => state.entity_id), ...selected.filter((id) => !sensors.some((state) => state.entity_id === id))];
    const others = this.floor!.rooms.filter((candidate) => candidate.id !== room.id);
    return html`<h2 class="room-title">${room.name}</h2><label class="field"><span>Raumname</span><input aria-label="Raumname" maxlength="120" .value=${room.name} ?disabled=${this.busy} @input=${(event: Event) => this.updateRoom((room) => ({ ...room, name: (event.target as HTMLInputElement).value }))}/></label><label class="field"><span>Fläche in m²</span><input aria-label="Fläche in m²" type="number" min="0.001" step="any" .value=${room.area_m2 === null ? "" : String(room.area_m2)} ?disabled=${this.busy} @change=${(event: Event) => { const input = event.target as HTMLInputElement; if (!this.updateRoom((room) => ({ ...room, area_m2: input.value === "" ? null : input.valueAsNumber }))) input.value = this.room?.area_m2 === null ? "" : String(this.room?.area_m2); }}/></label><p class="hint">${room.area_m2 === null ? "Fläche nicht bestätigt" : `${formatNumber(room.area_m2, this.hass)} m²`} · ID: ${room.id}</p>
      <div class="section"><h3>Raumtemperatur</h3>${selected.length ? selected.map((id) => html`<div class="sensor-reading"><span><span class="sensor-name">${entityName(this.hass?.states[id], this.hass) ?? id}</span><span class="sensor-id">${id}</span></span><strong>${temperatureLabel(this.hass?.states[id], this.hass)}</strong></div>`) : html`<p class="hint">Kein Sensor zugeordnet</p>`}</div>
      <details class="section" ?open=${this.editorStep === 3}><summary>Temperatursensoren zuordnen</summary><label class="field"><span>Sensor suchen</span><input aria-label="Temperatursensor suchen" type="search" .value=${this.sensorSearch} @input=${(event: Event) => this.sensorSearch = (event.target as HTMLInputElement).value}/></label><div class="sensor-select">${allSensors.map((id) => html`<label><input type="checkbox" .checked=${selected.includes(id)} ?disabled=${this.busy} @change=${(event: Event) => this.toggleSensor(id, (event.target as HTMLInputElement).checked)}/><span>${entityName(this.hass?.states[id], this.hass) ?? id}<br/><span class="sensor-id">${id} · ${temperatureLabel(this.hass?.states[id], this.hass)}${this.hass?.states[id] && this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</span></span></label>`)}</div><p class="hint">Ein oder mehrere Sensoren; Werte werden einzeln angezeigt.</p></details>
      <div class="section"><h3>Räume bearbeiten</h3><button ?disabled=${this.busy} @click=${() => this.selectTool("split")}>Raum teilen</button><label class="field"><span>Mit Raum verbinden</span><select aria-label="Mit Raum verbinden" .value=${this.mergeTarget} ?disabled=${this.busy || !others.length} @change=${(event: Event) => this.mergeTarget = (event.target as HTMLSelectElement).value}><option value="">Raum auswählen</option>${others.map((candidate) => html`<option value=${candidate.id}>${candidate.name}</option>`)}</select></label><button ?disabled=${this.busy || !others.some((candidate) => candidate.id === this.mergeTarget)} @click=${() => this.connectRooms()}>Räume verbinden</button><button class="danger" ?disabled=${this.busy} @click=${() => this.deleteRoom()}>Raum löschen</button></div>
      <details class="section"><summary>Raumgrenzen korrigieren</summary><p class="hint">Punkte ziehen oder Koordinaten ändern.</p><div class="points">${room.polygon.map(([x, y], index) => html`<div class="point"><span>${index + 1}</span>${([0, 1] as const).map((axis) => html`<input type="number" aria-label=${`Punkt ${index + 1} ${axis === 0 ? "x" : "y"}`} .value=${String(axis === 0 ? x : y)} ?disabled=${this.busy} @change=${(event: Event) => this.setPoint(index, axis, (event.target as HTMLInputElement).valueAsNumber)}/>`)}<button aria-label=${`Nach Punkt ${index + 1} hinzufügen`} ?disabled=${this.busy || room.polygon.length >= 500} @click=${() => this.addPoint(index)}>+</button><button aria-label=${`Punkt ${index + 1} entfernen`} ?disabled=${this.busy || room.polygon.length <= 3} @click=${() => this.removePoint(index)}>−</button></div>`)}</div></details>`;
  }

  private renderReview() {
    const result = this.draft ? validatePlan(this.draft) : { ok: true };
    return html`<section class="editor-step"><h2>Grundriss prüfen und speichern</h2><p>${this.draft?.floors.length ?? 0} Geschosse · ${roomIds(this.draft).length} Räume · ${Object.values(this.bindings).reduce((sum, values) => sum + values.length, 0)} Sensorzuordnungen</p><p class="hint">${result.ok ? "Alle Raumkonturen gültig." : "Bitte korrigieren Sie die angezeigten Fehler vor dem Speichern."} ${!this.draft ? "Das Projekt wird vollständig geleert." : "Konturen, Namen und Sensorzuordnungen werden gemeinsam gespeichert."}</p>${this.draft?.floors.map((floor) => html`<h3>${floor.name}</h3>${floor.rooms.map((room) => html`<button ?disabled=${this.busy} @click=${() => { this.chooseFloor(floor.id); this.selectedRoom = room.id; this.setStep(2); }}>${room.name} · ${room.area_m2 === null ? "Fläche nicht bestätigt" : `${room.area_m2} m²`} · ${bindingFor(this.bindings, room.id).length ? `${bindingFor(this.bindings, room.id).length} Sensor(en)` : "Kein Sensor zugeordnet"}</button>`)}`)}<p class="hint">Wählen Sie oben „${this.imported ? "Import übernehmen" : "Änderungen speichern"}“, um den Entwurf zu übernehmen.</p></section>`;
  }

  private renderFloorDelete() {
    return html`<div class="dialog-backdrop" @keydown=${(event: KeyboardEvent) => this.dialogKey(event)}><section class="dialog" role="dialog" aria-modal="true" aria-label="Geschoss löschen"><h2>„${this.floor?.name}“ löschen?</h2><p>Alle ${this.floor?.rooms.length ?? 0} Räume dieses Geschosses und ihre Sensorzuordnungen werden aus dem Entwurf entfernt.${this.draft?.floors.length === 1 ? " Danach ist das Projekt leer." : ""} Sie können die Änderung vor dem Speichern rückgängig machen.</p><div class="dialog-actions"><button ?disabled=${this.busy} @click=${() => this.closeDialog()}>Abbrechen</button><button class="danger" ?disabled=${this.busy} @click=${() => this.deleteFloor()}>Geschoss entfernen</button></div></section></div>`;
  }

  private renderSetup() {
    const missing = promptRequirements(this.floorId, this.floorName);
    return html`<section class="setup" aria-label="Grundriss einrichten"><div class="steps">
      <div class="step"><div class="step-heading"><span class="step-number">1</span><h2>LLM-Prompt vorbereiten</h2></div>
        <p class="hint">Originalpläne bleiben lokal. Verwenden Sie den Prompt mit einem lokalen LLM oder ausschließlich mit vollständig anonymisierten Plänen.</p>
        <div class="field-row"><label><span>Etagen-ID</span><input aria-label="Etagen-ID" .value=${this.floorId} maxlength="64" @input=${(event: Event) => this.floorId = (event.target as HTMLInputElement).value}/></label><label><span>Etagenname</span><input aria-label="Etagenname" .value=${this.floorName} maxlength="120" @input=${(event: Event) => this.floorName = (event.target as HTMLInputElement).value}/></label></div>
        <button class="primary" @click=${() => this.openPrompt()} ?disabled=${missing.length > 0 || this.busy}>${copyIcon} LLM-Prompt anzeigen</button>
        ${missing.length ? html`<p class="hint">${missing.join(" ")}</p>` : html`<p class="hint">Das LLM liefert einen digitalen Grundriss, der später ohne das Original nutzbar ist.</p>`}
      </div>
      <div class="step"><div class="step-heading"><span class="step-number">2</span><h2>JSON importieren & Räume prüfen</h2></div>
        <label class=${`file-button ${this.busy ? "disabled" : ""}`}>${uploadIcon} JSON-Datei auswählen<input type="file" accept=".json,application/json" aria-label="JSON-Datei importieren" ?disabled=${this.busy} @change=${(event: Event) => { const input = event.target as HTMLInputElement; void this.readJson(input.files?.[0]); input.value = ""; }}/></label>
        <label><span style="margin-top:12px">Oder LLM-Antwort einfügen</span><textarea class="json" aria-label="Grundriss-JSON" .value=${this.jsonText} placeholder='{"schema_version": "1.1", "floors": […]}' @input=${(event: Event) => this.jsonText = (event.target as HTMLTextAreaElement).value}></textarea></label>
        <button ?disabled=${!this.jsonText.trim() || this.busy} @click=${() => this.checkImport()}>Import prüfen</button><button ?disabled=${this.busy} @click=${() => void this.sample()}>Beispiel laden</button><p class="hint">Der Import erzeugt zunächst eine Vorschau. Alle Etagen bleiben erhalten. Raumkonturen und Zeichenfläche stehen vollständig im JSON; ein Hintergrundbild ist nicht erforderlich.</p>
      </div>
    </div></section>`;
  }

  private renderFloor(floor: Floor) {
    return html`<div class="content"><div><section class="plan-area"><div class="plan-heading"><strong>${floor.name} <span class="muted">· ${floor.rooms.length} Räume</span></strong><span class="muted">${floor.canvas.width} × ${floor.canvas.height} Einheiten</span></div><div class="plan-frame">
      <svg class=${`plan-svg ${this.editing ? "editing" : ""}`} viewBox=${`0 0 ${floor.canvas.width} ${floor.canvas.height}`} style=${`aspect-ratio:${floor.canvas.width}/${floor.canvas.height}`} role="group" aria-label=${`Grundriss ${floor.name}`} @pointermove=${(event: PointerEvent) => this.moveDrag(event)} @pointerup=${() => this.finishDrag()} @pointercancel=${() => this.finishDrag(true)}>
        ${floor.rooms.map((room) => svg`<polygon class=${`room-shape ${room.id === this.selectedRoom ? "selected" : ""}`} points=${room.polygon.map((point) => point.join(",")).join(" ")} tabindex="0" role="button" aria-label=${`${room.name} auswählen`} aria-pressed=${room.id === this.selectedRoom} @click=${() => this.selectedRoom = room.id} @keydown=${(event: KeyboardEvent) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); this.cancelDrawing(); this.selectedRoom = room.id; this.editing = this.editorOpen && this.editorStep === 2; } }}/>`)}
        ${floor.rooms.map((room) => {
          const [x, y] = interiorLabelPoint(room.polygon);
          const width = Math.min(room.name.length * 12 + 32, floor.canvas.width * .8);
          return svg`<g class="label-group"><rect class="label-bg" x=${x - width / 2} y=${y - 20} width=${width} height="40" rx="8"/><text class="room-label" x=${x} y=${y}>${room.name.length > 40 ? `${room.name.slice(0, 39)}…` : room.name}</text></g>`;
        })}
        ${this.editing && this.room ? this.room.polygon.map((point, index) => svg`<circle class="vertex" cx=${point[0]} cy=${point[1]} r=${Math.max(floor.canvas.width / 110, 4)} aria-label=${`Punkt ${index + 1} verschieben`} @pointerdown=${(event: PointerEvent) => this.beginDrag(event, index)}/>`): nothing}
      </svg>${floor.rooms.length ? nothing : html`<p class="hint empty-floor" role="status">Diese Etage enthält keine Räume. Über die Einrichtung können Sie einen Grundriss importieren.</p>`}</div><div class="legend"><span><i class="dot"></i> Raum anklicken</span><span><i class="dot selected"></i> Ausgewählter Raum</span>${this.editing ? html`<span>Punkte ziehen oder rechts numerisch ändern</span>` : nothing}</div>
      </section><nav class="room-list" aria-label="Räume">${floor.rooms.map((room) => html`<button class=${room.id === this.selectedRoom ? "active" : ""} aria-pressed=${room.id === this.selectedRoom} @click=${() => this.selectedRoom = room.id}>${room.name}</button>`)}</nav></div><aside>${this.room ? this.renderRoom(this.room) : html`<p class="muted">Wählen Sie einen Raum im Grundriss.</p>`}</aside></div>`;
  }

  private renderRoom(room: Room) {
    const selected = bindingFor(this.bindings, room.id), sensors = this.hass ? temperatureSensors(this.hass) : [];
    const allSensors = [...sensors.map((state) => state.entity_id), ...selected.filter((id) => !sensors.some((state) => state.entity_id === id))];
    const otherRooms = this.floor!.rooms.filter((candidate) => candidate.id !== room.id);
    return html`<div class="eyebrow">Ausgewählter Raum</div><h2 class="room-title">${room.name}</h2><div class="muted"><code>${room.id}</code></div><p class="hint">${room.area_m2 === null ? "Fläche nicht bestätigt" : `${formatNumber(room.area_m2, this.hass)} m² · Flächenangabe`}</p>
      ${this.admin ? html`<div class="section"><h3>Räume bearbeiten</h3><label class="field"><span>Mit Raum verbinden</span><select aria-label="Mit Raum verbinden" .value=${this.mergeTarget} ?disabled=${this.busy || !otherRooms.length} @change=${(event: Event) => this.mergeTarget = (event.target as HTMLSelectElement).value}><option value="">Raum auswählen</option>${otherRooms.map((candidate) => html`<option value=${candidate.id}>${candidate.name}</option>`)}</select></label><div class="actions"><button ?disabled=${this.busy || !otherRooms.some((candidate) => candidate.id === this.mergeTarget)} @click=${() => this.connectRooms()}>Räume verbinden</button><button class="danger" ?disabled=${this.busy} @click=${() => this.deleteRoom()}>Raum löschen</button></div><p class="hint">Verbinden Sie benachbarte Räume derselben Etage. Schmale Zwischenräume entlang paralleler Grenzen werden geschlossen. Name und ID dieses Raums bleiben erhalten; Sensorzuordnungen werden zusammengeführt. Bekannte Flächen werden addiert, sonst bleibt die Fläche unbestätigt. Änderungen werden erst beim Speichern übernommen.</p></div>` : nothing}
      <div class="section"><h3>Raumtemperatur</h3>${selected.length ? selected.map((id) => {
        const state = this.hass?.states[id], label = temperatureLabel(state, this.hass);
        return html`<div class="sensor-reading"><span><span class="sensor-name">${entityName(state, this.hass) ?? id}</span><span class="sensor-id">${id}</span></span><strong class=${!state || ["unknown", "unavailable"].includes(state.state) || !Number.isFinite(Number(state.state)) ? "status" : ""}>${label}</strong></div>`;
      }) : html`<p class="hint">Noch kein Temperatursensor zugeordnet.</p>`}<p class="hint">Sensoren werden einzeln mit ihrer Einheit angezeigt.</p></div>
      ${this.admin ? html`<div class="section"><h3>Temperatursensoren zuordnen</h3><div class="sensor-select">${allSensors.length ? allSensors.map((id) => html`<label><input type="checkbox" .checked=${selected.includes(id)} ?disabled=${this.busy} @change=${(event: Event) => this.toggleSensor(id, (event.target as HTMLInputElement).checked)}/><span>${entityName(this.hass?.states[id], this.hass) ?? id}<br/><span class="sensor-id">${id}${!this.hass?.states[id] ? " · entfernt" : this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</span></span></label>`) : html`<p class="hint">Keine vorhandenen Sensoren mit Geräteklasse „temperature“ gefunden.</p>`}</div></div>
      <div class="section"><button ?disabled=${this.busy} aria-pressed=${this.editing} @click=${() => this.editing = !this.editing}>${this.editing ? "Korrekturmodus beenden" : "Raumgrenzen korrigieren"}</button>${this.editing ? html`<label class="field"><span>Raumname</span><input .value=${room.name} maxlength="120" ?disabled=${this.busy} @input=${(event: Event) => this.updateRoom((room) => ({ ...room, name: (event.target as HTMLInputElement).value }))}/></label><p class="edit-note">Zeichenfläche: x nach rechts, y nach unten. Punkte am Plan ziehen oder Koordinaten ändern. + fügt einen Punkt auf der folgenden Kante ein.</p><div class="points">${room.polygon.map(([x, y], index) => html`<div class="point"><span>${index + 1}</span><input type="number" aria-label=${`Punkt ${index + 1} x`} min="0" max=${this.floor!.canvas.width} step="any" ?disabled=${this.busy} .value=${String(x)} @change=${(event: Event) => this.setPoint(index, 0, (event.target as HTMLInputElement).valueAsNumber)}/><input type="number" aria-label=${`Punkt ${index + 1} y`} min="0" max=${this.floor!.canvas.height} step="any" ?disabled=${this.busy} .value=${String(y)} @change=${(event: Event) => this.setPoint(index, 1, (event.target as HTMLInputElement).valueAsNumber)}/><button class="icon" title="Punkt nach diesem Punkt hinzufügen" aria-label=${`Nach Punkt ${index + 1} hinzufügen`} ?disabled=${this.busy || room.polygon.length >= 500} @click=${() => this.addPoint(index)}>+</button><button class="icon danger" title="Punkt entfernen" aria-label=${`Punkt ${index + 1} entfernen`} ?disabled=${this.busy || room.polygon.length <= 3} @click=${() => this.removePoint(index)}>−</button></div>`)}</div>` : nothing}</div>` : nothing}`;
  }

  private renderPrompt() {
    const prompt = buildPrompt(this.floorId, this.floorName);
    return html`<div class="dialog-backdrop" @click=${(event: Event) => { if (event.target === event.currentTarget) this.closeDialog(); }} @keydown=${(event: KeyboardEvent) => this.dialogKey(event)}><section class="dialog" role="dialog" aria-modal="true" aria-label="LLM-Prompt"><div class="dialog-top"><div><h2>LLM-Prompt</h2><p class="hint">${this.floorName} · eigenständiger digitaler Grundriss</p></div><button aria-label="Dialog schließen" class="icon" @click=${() => this.closeDialog()}>✕</button></div><div class="notice">Kopieren Sie den Prompt und verwenden Sie Originalpläne ausschließlich lokal. Für externe LLM müssen Pläne vorher vollständig anonymisiert sein. Übernehmen Sie keine Namen, Orte, Anschriften oder persönlichen Dateipfade in das JSON. Importieren Sie anschließend die JSON-Antwort. Die Anwendung lädt keine Dokumente hoch und führt selbst keinen LLM-Aufruf aus.</div><textarea class="prompt-text" aria-label="Vollständiger LLM-Prompt" readonly .value=${prompt}></textarea>${this.copied ? html`<p class="hint" role="status">${this.copied}</p>` : nothing}<div class="dialog-actions"><button @click=${() => { const field = this.renderRoot.querySelector<HTMLTextAreaElement>(".prompt-text"); field?.focus(); field?.select(); }}>Alles markieren</button><button class="primary" @click=${() => void this.copy()}>${copyIcon} Prompt kopieren</button></div></section></div>`;
  }

  private renderConfirmation() {
    const oldRooms = this.project?.plan?.floors.flatMap((floor) => floor.rooms) ?? [];
    const nextRooms = this.draft?.floors.flatMap((floor) => floor.rooms) ?? [];
    return html`<div class="dialog-backdrop" @keydown=${(event: KeyboardEvent) => this.dialogKey(event)}><section class="dialog" role="dialog" aria-modal="true" aria-label="Entfernte Räume bestätigen"><h2>Entfernte Raum-IDs prüfen</h2><p>Diese Raum-IDs kommen im neuen Grundriss nicht mehr vor. Ihre bisherigen Zuordnungen entfallen. Beim Verbinden übernommene Sensoren bleiben dem verbleibenden Raum zugeordnet. Eine geänderte ID gilt als neuer Raum.</p><div class="removed">${this.confirmRemoved?.map((id) => {
      const sensors = bindingFor(this.project?.bindings ?? {}, id);
      return html`<p><strong>${oldRooms.find((room) => room.id === id)?.name ?? id}</strong> · <code>${id}</code><br/>${sensors.length ? sensors.map((sensor) => {
        const assigned = nextRooms.filter((room) => bindingFor(this.bindings, room.id).includes(sensor)).map((room) => room.name);
        return html`<span class="removed-sensor">${sensor} · ${assigned.length ? `Weiterhin zugeordnet: ${assigned.join(", ")}` : "Zuordnung wird entfernt"}</span>`;
      }) : "Keine Sensorzuordnung"}</p>`;
    })}</div><div class="dialog-actions"><button ?disabled=${this.busy} @click=${() => this.closeDialog()}>Abbrechen</button><button class="primary" ?disabled=${this.busy} @click=${() => void this.save(true)}>Entfernung bestätigen & speichern</button></div></section></div>`;
  }
}

class HeizlastHaCardEditor extends LitElement {
  static properties = { config: { state: true } };
  private config: CardConfig = HeizlastHaCard.getStubConfig();
  setConfig(config: CardConfig): void { this.config = config; }
  protected render() {
    return html`<label style="display:block;padding:15px">Kartentitel<input style="display:block;width:100%;padding:10px;margin-top:8px" .value=${this.config.title ?? "Mein Zuhause"} @input=${(event: Event) => { this.config = { ...this.config, title: (event.target as HTMLInputElement).value }; this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this.config }, bubbles: true, composed: true })); }}/></label><p style="padding:0 15px">Grundriss und Sensorzuordnungen werden direkt in der Karte eingerichtet und zentral in Home Assistant gespeichert.</p>`;
  }
}

/** Both dashboard modes use Home Assistant's authenticated state and API. */
export class HeizlastHaPanel extends LitElement {
  static properties = { hass: { attribute: false }, narrow: { type: Boolean }, legacy: { state: true }, legacyOpened: { state: true } };
  static styles = css`
    :host { display: block; height: 100%; overflow: auto; background: var(--primary-background-color); color: var(--primary-text-color); }
    header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; height: var(--header-height, 56px); padding: 0 16px; background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, white); }
    h1 { margin: 0 0 0 16px; font-size: 20px; font-weight: 400; }
    main { max-width: 1600px; margin: 0 auto; padding: 24px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    nav button { font: inherit; cursor: pointer; background: var(--card-background-color); color: var(--primary-text-color); border: 1px solid var(--divider-color); border-radius: 9px; padding: 10px 14px; }
    nav button[aria-pressed=true] { color: var(--primary-color); border-color: var(--primary-color); }
    nav button:focus-visible { outline: 3px solid var(--primary-color); outline-offset: 3px; }
    [hidden] { display: none; }
    @media (max-width: 600px) { main { padding: 12px; } }
  `;
  hass?: HomeAssistant;
  narrow = false;
  private legacy = false;
  private legacyOpened = false;

  protected render() {
    return html`<header><hass-menu-button .hass=${this.hass} .narrow=${this.narrow}></hass-menu-button><h1>Heizlast HA</h1></header><main><nav aria-label="Dashboard-Ansicht"><button aria-pressed=${!this.legacy} @click=${() => this.legacy = false}>Heizlast-Grundriss</button><button aria-pressed=${this.legacy} @click=${() => { this.legacy = true; this.legacyOpened = true; }}>Eigene Grundrisse</button></nav><div ?hidden=${this.legacy}><heizlast-grundriss-card .hass=${this.hass}></heizlast-grundriss-card></div>${this.legacyOpened ? html`<div ?hidden=${!this.legacy}><heizlast-ha-card .hass=${this.hass}></heizlast-ha-card></div>` : nothing}</main>`;
  }
}

if (!customElements.get("heizlast-ha-card")) customElements.define("heizlast-ha-card", HeizlastHaCard);
if (!customElements.get("heizlast-ha-card-editor")) customElements.define("heizlast-ha-card-editor", HeizlastHaCardEditor);
if (!customElements.get("heizlast-ha-panel")) customElements.define("heizlast-ha-panel", HeizlastHaPanel);
const registry = window as Window & { customCards?: Array<{ type: string; name: string; description: string; preview: boolean }> };
registry.customCards ??= [];
if (!registry.customCards.some((card) => card.type === "heizlast-ha-card")) registry.customCards.push({ type: "heizlast-ha-card", name: "Heizlast HA", description: "Interaktiver Grundriss mit Raumtemperaturen und LLM-Prompt", preview: false });
