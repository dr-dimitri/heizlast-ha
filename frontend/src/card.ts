import { LitElement, css, html, svg, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { buildPrompt, copyPrompt, promptRequirements } from "./prompt";
import { parseImport, reconcileBindings, validatePlan } from "./validation";
import { interiorLabelPoint, mergeRooms } from "./room-operations";
import { type CardConfig, type Floor, type Floorplan, type HomeAssistant, type Point, type Project, type Room, bindingFor, clone, temperatureLabel, temperatureSensors } from "./types";

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

/** A real Lovelace card. All mutations go through the HA authenticated API. */
export class HeizlastHaCard extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false }, config: { state: true }, project: { state: true }, draft: { state: true }, bindings: { state: true },
    selectedFloor: { state: true }, selectedRoom: { state: true }, floorId: { state: true }, floorName: { state: true },
    showSetup: { state: true }, editing: { state: true }, imported: { state: true }, dirty: { state: true }, jsonText: { state: true },
    errors: { state: true }, notice: { state: true }, loading: { state: true }, busy: { state: true }, showPrompt: { state: true }, copied: { state: true },
    confirmRemoved: { state: true }, conflict: { state: true }, mergeTarget: { state: true },
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
    if (changed.has("selectedRoom") || changed.has("selectedFloor")) this.mergeTarget = "";
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
    this.draft = result.plan;
    this.bindings = reconcileBindings(result.plan, { ...this.project.bindings, ...this.bindings }).bindings;
    this.imported = true;
    this.dirty = true;
    this.editing = false;
    this.chooseFloor(result.plan.floors[0].id);
    this.errors = [];
    this.notice = "Import geprüft. Alle Etagen sind in der Vorschau. Prüfen Sie Raumkonturen, Namen und Anordnung. Übernehmen Sie anschließend den Import ausdrücklich.";
  }

  private updateRoom(update: (room: Room) => Room): void {
    if (!this.admin || !this.room || !this.draft || this.busy) return;
    const id = this.room.id;
    this.draft = { ...this.draft, floors: this.draft.floors.map((floor) => ({ ...floor, rooms: floor.rooms.map((room) => room.id === id ? update(room) : room) })) };
    this.dirty = true;
    this.errors = [];
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
    this.updateRoom((room) => ({ ...room, polygon: room.polygon.map((point, i) => i === index ? [axis === 0 ? value : point[0], axis === 1 ? value : point[1]] : point) }));
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
    this.bindings = { ...this.bindings, [this.room.id]: checked ? [...new Set([...selected, id])] : selected.filter((sensor) => sensor !== id) };
    this.dirty = true;
  }

  private async save(confirmed = false): Promise<void> {
    if (!this.draft || !this.project || !this.hass || !this.admin || this.busy) return;
    const result = validatePlan(this.draft);
    if (!result.ok) { this.errors = result.errors; return; }
    const nextIds = new Set(roomIds(result.plan));
    const removed = roomIds(this.project.plan).filter((id) => !nextIds.has(id));
    if (removed.length && !confirmed) { this.returnFocus = this.shadowRoot?.activeElement as HTMLElement | undefined; this.confirmRemoved = removed; return; }
    this.busy = true;
    this.errors = [];
    try {
      const project = await this.hass.callWS<Project>({ type: "heizlast_ha/save_project", revision: this.project.revision, plan: result.plan, bindings: this.bindings, confirmed_removed_room_ids: removed });
      const floor = this.selectedFloor, room = this.selectedRoom;
      this.project = project;
      this.resetDraft();
      if (this.draft?.floors.some((f) => f.id === floor)) this.chooseFloor(floor);
      if (this.floor?.rooms.some((r) => r.id === room)) this.selectedRoom = room;
      this.showSetup = false;
      this.notice = "Grundriss und Sensorzuordnungen sind gespeichert.";
      this.conflict = false;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      this.conflict = code === "conflict";
      this.errors = [this.conflict ? "Das Projekt wurde zwischenzeitlich geändert. Ihre Vorschau ist erhalten. Exportieren Sie Ihre Änderungen und laden Sie dann die aktuelle Version neu." : `Speichern fehlgeschlagen. Ihre Änderungen sind erhalten. ${failureMessage(error)}`];
    } finally { this.busy = false; this.confirmRemoved = null; }
  }

  private exportDraft(): void {
    if (!this.draft) return;
    const blob = new Blob([JSON.stringify({ plan: this.draft, bindings: this.bindings }, null, 2)], { type: "application/json" });
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
    void this.updateComplete.then(() => this.returnFocus?.focus());
  }

  private dialogKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !this.busy) { event.preventDefault(); this.closeDialog(); return; }
    if (event.key !== "Tab") return;
    const elements = [...this.renderRoot.querySelectorAll<HTMLElement>('.dialog button:not([disabled]), .dialog a[href], .dialog textarea')];
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
    return html`<div class="card">
      <header><div class="brand"><div class="brand-icon">${houseIcon}</div><div><h1>${this.config.title ?? "Mein Zuhause"}</h1><p class="subline">Grundriss & Raumtemperaturen</p></div></div><span class="badge">Prototyp</span></header>
      ${this.loading ? html`<div class="empty"><p>Projekt wird aus Home Assistant geladen …</p></div>` : html`
        <div class="toolbar"><div class="floor-tabs" aria-label="Etagen">${this.draft?.floors.map((floor) => html`<button class=${floor.id === this.floor?.id ? "active" : ""} @click=${() => this.chooseFloor(floor.id)} aria-pressed=${floor.id === this.floor?.id}>${floor.name}</button>`) ?? html`<strong style="font-size:13px">Ihr erster Grundriss</strong>`}</div>
          <div class="actions">${this.admin && this.project ? html`<button @click=${() => this.showSetup = !this.showSetup}>${this.showSetup ? "Einrichtung schließen" : "Grundriss einrichten"}</button>${this.dirty ? html`${!this.imported ? html`<button ?disabled=${this.busy} @click=${() => this.discardChanges()}>Änderungen verwerfen</button>` : nothing}<button class="primary" ?disabled=${this.busy} @click=${() => void this.save()}>${this.busy ? "Wird gespeichert …" : this.imported ? "Import übernehmen" : "Änderungen speichern"}</button>` : nothing}` : nothing}</div>
        </div>
        ${!this.admin ? html`<div class="notice warning">Ansicht ohne Bearbeitungsrechte. Grundriss, Räume und Sensorwerte sind sichtbar; für Import, Korrekturen und Zuordnungen benötigt Ihr Konto Administratorrechte.</div>` : nothing}
        ${this.errors.length ? html`<div class="notice error" role="alert"><strong>Bitte prüfen</strong><ul>${this.errors.map((error) => html`<li>${error}</li>`)}</ul>${this.conflict ? html`<div class="actions" style="margin-top:10px"><button @click=${() => this.exportDraft()}>Änderungen sichern</button><button @click=${() => void this.loadProject()}>Aktuelle Version laden</button></div>` : !this.project ? html`<button @click=${() => void this.loadProject()}>Erneut laden</button>` : nothing}</div>` : nothing}
        ${this.notice ? html`<div class="notice" role="status">${this.notice}</div>` : nothing}
        ${this.imported ? html`<div class="notice warning"><strong>Vorschau · noch nicht gespeichert</strong><p>Prüfen Sie alle ${this.draft?.floors.length} Etage(n) und Raumgrenzen. Gleiche Raum-IDs behalten ihre Sensorzuordnungen.</p><button ?disabled=${this.busy} @click=${() => this.discardChanges()}>Vorschau verwerfen</button></div>` : nothing}
        ${this.showSetup && this.admin && this.project ? this.renderSetup() : nothing}
        ${this.floor ? this.renderFloor(this.floor) : html`<div class="empty"><div class="empty-symbol">${houseIcon}</div><h2>Räume sichtbar machen</h2><p>Kopieren Sie den vorbereiteten Prompt und geben Sie Ihren Grundriss direkt an Ihr LLM weiter. Importieren Sie die JSON-Antwort und prüfen Sie die Räume vor dem Speichern.</p>${this.admin && this.project ? html`<button @click=${() => void this.sample()} ?disabled=${this.busy}>Mit Beispielgrundriss starten</button>` : nothing}</div>`}
      `}
      <div class="footer"><span>Digitaler Grundriss · auswählbare Räume</span><span>Temperaturanzeige · Wärmebedarfsberechnung folgt später</span></div>
    </div>${this.showPrompt ? this.renderPrompt() : nothing}${this.confirmRemoved ? this.renderConfirmation() : nothing}`;
  }

  private renderSetup() {
    const missing = promptRequirements(this.floorId, this.floorName);
    return html`<section class="setup" aria-label="Grundriss einrichten"><div class="steps">
      <div class="step"><div class="step-heading"><span class="step-number">1</span><h2>LLM-Prompt vorbereiten</h2></div>
        <p class="hint">Kein Bild-Upload nötig. Geben Sie Ihren Grundriss zusammen mit dem Prompt direkt an Ihr LLM weiter.</p>
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
      <svg class=${`plan-svg ${this.editing ? "editing" : ""}`} viewBox=${`0 0 ${floor.canvas.width} ${floor.canvas.height}`} style=${`aspect-ratio:${floor.canvas.width}/${floor.canvas.height}`} role="group" aria-label=${`Grundriss ${floor.name}`} @pointermove=${(event: PointerEvent) => this.moveDrag(event)} @pointerup=${() => this.drag = null} @pointercancel=${() => this.drag = null}>
        ${floor.rooms.map((room) => svg`<polygon class=${`room-shape ${room.id === this.selectedRoom ? "selected" : ""}`} points=${room.polygon.map((point) => point.join(",")).join(" ")} tabindex="0" role="button" aria-label=${`${room.name} auswählen`} aria-pressed=${room.id === this.selectedRoom} @click=${() => this.selectedRoom = room.id} @keydown=${(event: KeyboardEvent) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); this.selectedRoom = room.id; } }}/>`)}
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
    return html`<div class="eyebrow">Ausgewählter Raum</div><h2 class="room-title">${room.name}</h2><div class="muted"><code>${room.id}</code></div><p class="hint">${room.area_m2 === null ? "Fläche nicht bestätigt" : `${new Intl.NumberFormat("de-DE").format(room.area_m2)} m² · Flächenangabe`}</p>
      ${this.admin ? html`<div class="section"><h3>Räume bearbeiten</h3><label class="field"><span>Mit Raum verbinden</span><select aria-label="Mit Raum verbinden" .value=${this.mergeTarget} ?disabled=${this.busy || !otherRooms.length} @change=${(event: Event) => this.mergeTarget = (event.target as HTMLSelectElement).value}><option value="">Raum auswählen</option>${otherRooms.map((candidate) => html`<option value=${candidate.id}>${candidate.name}</option>`)}</select></label><div class="actions"><button ?disabled=${this.busy || !otherRooms.some((candidate) => candidate.id === this.mergeTarget)} @click=${() => this.connectRooms()}>Räume verbinden</button><button class="danger" ?disabled=${this.busy} @click=${() => this.deleteRoom()}>Raum löschen</button></div><p class="hint">Verbinden Sie benachbarte Räume derselben Etage. Schmale Zwischenräume entlang paralleler Grenzen werden geschlossen. Name und ID dieses Raums bleiben erhalten; Sensorzuordnungen werden zusammengeführt. Bekannte Flächen werden addiert, sonst bleibt die Fläche unbestätigt. Änderungen werden erst beim Speichern übernommen.</p></div>` : nothing}
      <div class="section"><h3>Raumtemperatur</h3>${selected.length ? selected.map((id) => {
        const state = this.hass?.states[id], label = temperatureLabel(state);
        return html`<div class="sensor-reading"><span><span class="sensor-name">${state?.attributes.friendly_name ?? id}</span><span class="sensor-id">${id}</span></span><strong class=${!state || ["unknown", "unavailable"].includes(state.state) || !Number.isFinite(Number(state.state)) ? "status" : ""}>${label}</strong></div>`;
      }) : html`<p class="hint">Noch kein Temperatursensor zugeordnet.</p>`}<p class="hint">Sensoren werden einzeln mit ihrer Einheit angezeigt.</p></div>
      ${this.admin ? html`<div class="section"><h3>Temperatursensoren zuordnen</h3><div class="sensor-select">${allSensors.length ? allSensors.map((id) => html`<label><input type="checkbox" .checked=${selected.includes(id)} ?disabled=${this.busy} @change=${(event: Event) => this.toggleSensor(id, (event.target as HTMLInputElement).checked)}/><span>${this.hass?.states[id]?.attributes.friendly_name ?? id}<br/><span class="sensor-id">${id}${!this.hass?.states[id] ? " · entfernt" : this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</span></span></label>`) : html`<p class="hint">Keine vorhandenen Sensoren mit Geräteklasse „temperature“ gefunden.</p>`}</div></div>
      <div class="section"><button ?disabled=${this.busy} aria-pressed=${this.editing} @click=${() => this.editing = !this.editing}>${this.editing ? "Korrekturmodus beenden" : "Raumgrenzen korrigieren"}</button>${this.editing ? html`<label class="field"><span>Raumname</span><input .value=${room.name} maxlength="120" ?disabled=${this.busy} @input=${(event: Event) => this.updateRoom((room) => ({ ...room, name: (event.target as HTMLInputElement).value }))}/></label><p class="edit-note">Zeichenfläche: x nach rechts, y nach unten. Punkte am Plan ziehen oder Koordinaten ändern. + fügt einen Punkt auf der folgenden Kante ein.</p><div class="points">${room.polygon.map(([x, y], index) => html`<div class="point"><span>${index + 1}</span><input type="number" aria-label=${`Punkt ${index + 1} x`} min="0" max=${this.floor!.canvas.width} step="any" ?disabled=${this.busy} .value=${String(x)} @change=${(event: Event) => this.setPoint(index, 0, (event.target as HTMLInputElement).valueAsNumber)}/><input type="number" aria-label=${`Punkt ${index + 1} y`} min="0" max=${this.floor!.canvas.height} step="any" ?disabled=${this.busy} .value=${String(y)} @change=${(event: Event) => this.setPoint(index, 1, (event.target as HTMLInputElement).valueAsNumber)}/><button class="icon" title="Punkt nach diesem Punkt hinzufügen" aria-label=${`Nach Punkt ${index + 1} hinzufügen`} ?disabled=${this.busy || room.polygon.length >= 500} @click=${() => this.addPoint(index)}>+</button><button class="icon danger" title="Punkt entfernen" aria-label=${`Punkt ${index + 1} entfernen`} ?disabled=${this.busy || room.polygon.length <= 3} @click=${() => this.removePoint(index)}>−</button></div>`)}</div>` : nothing}</div>` : nothing}`;
  }

  private renderPrompt() {
    const prompt = buildPrompt(this.floorId, this.floorName);
    return html`<div class="dialog-backdrop" @click=${(event: Event) => { if (event.target === event.currentTarget) this.closeDialog(); }} @keydown=${(event: KeyboardEvent) => this.dialogKey(event)}><section class="dialog" role="dialog" aria-modal="true" aria-label="LLM-Prompt"><div class="dialog-top"><div><h2>LLM-Prompt</h2><p class="hint">${this.floorName} · eigenständiger digitaler Grundriss</p></div><button aria-label="Dialog schließen" class="icon" @click=${() => this.closeDialog()}>✕</button></div><div class="notice">Kopieren Sie den Prompt und fügen Sie Ihren Grundriss direkt im gewünschten LLM bei, etwa als Bild oder PDF. Hier wird kein Bild hochgeladen. Importieren Sie anschließend die JSON-Antwort. Für die spätere Anzeige und Bearbeitung wird der ursprüngliche Plan nicht benötigt. Die Anwendung führt selbst keinen LLM-Aufruf aus.</div><textarea class="prompt-text" aria-label="Vollständiger LLM-Prompt" readonly .value=${prompt}></textarea>${this.copied ? html`<p class="hint" role="status">${this.copied}</p>` : nothing}<div class="dialog-actions"><button @click=${() => { const field = this.renderRoot.querySelector<HTMLTextAreaElement>(".prompt-text"); field?.focus(); field?.select(); }}>Alles markieren</button><button class="primary" @click=${() => void this.copy()}>${copyIcon} Prompt kopieren</button></div></section></div>`;
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

/** The integration's sidebar dashboard uses the same card and authenticated API. */
export class HeizlastHaPanel extends LitElement {
  static properties = { hass: { attribute: false }, narrow: { type: Boolean } };
  static styles = css`
    :host { display: block; height: 100%; overflow: auto; background: var(--primary-background-color); color: var(--primary-text-color); }
    header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; height: var(--header-height, 56px); padding: 0 16px; background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, white); }
    h1 { margin: 0 0 0 16px; font-size: 20px; font-weight: 400; }
    main { max-width: 1600px; margin: 0 auto; padding: 24px; }
    @media (max-width: 600px) { main { padding: 12px; } }
  `;
  hass?: HomeAssistant;
  narrow = false;

  protected render() {
    return html`<header><hass-menu-button .hass=${this.hass} .narrow=${this.narrow}></hass-menu-button><h1>Heizlast HA</h1></header><main><heizlast-ha-card .hass=${this.hass}></heizlast-ha-card></main>`;
  }
}

if (!customElements.get("heizlast-ha-card")) customElements.define("heizlast-ha-card", HeizlastHaCard);
if (!customElements.get("heizlast-ha-card-editor")) customElements.define("heizlast-ha-card-editor", HeizlastHaCardEditor);
if (!customElements.get("heizlast-ha-panel")) customElements.define("heizlast-ha-panel", HeizlastHaPanel);
const registry = window as Window & { customCards?: Array<{ type: string; name: string; description: string; preview: boolean }> };
registry.customCards ??= [];
if (!registry.customCards.some((card) => card.type === "heizlast-ha-card")) registry.customCards.push({ type: "heizlast-ha-card", name: "Heizlast HA", description: "Interaktiver Grundriss mit Raumtemperaturen und LLM-Prompt", preview: false });
