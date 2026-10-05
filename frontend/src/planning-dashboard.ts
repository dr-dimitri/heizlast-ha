import { LitElement, html, svg, nothing, type PropertyValues } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { planningStyles } from "./planning-styles";
import { planningData, floorLoad, floorName, polygonPoints, shapesForZone, zonesForFloor, type PlanningFloor, type PlanShape } from "./planning-types";
import { bindingFor, clone, entityName, formatNumber, temperatureLabel, temperatureSensors, type CardConfig, type HomeAssistant, type Project } from "./types";

export class HeizlastGrundrissCard extends LitElement {
  static styles = planningStyles;
  static properties = {
    hass: { attribute: false }, config: { state: true }, selectedFloor: { state: true }, selectedZone: { state: true },
    project: { state: true }, bindings: { state: true }, loading: { state: true }, busy: { state: true },
    error: { state: true }, conflict: { state: true }, notice: { state: true }, sensorSearch: { state: true },
  };
  hass?: HomeAssistant;
  private config: CardConfig = { type: "custom:heizlast-grundriss-card" };
  private selectedFloor: PlanningFloor = "EG";
  private selectedZone = 5;
  private project?: Project;
  private bindings: Record<string, string[]> = {};
  private loading = true;
  private busy = false;
  private error = "";
  private conflict = false;
  private notice = "";
  private sensorSearch = "";
  private loadStarted = false;

  static getStubConfig(): CardConfig { return { type: "custom:heizlast-grundriss-card" }; }
  getCardSize(): number { return 12; }
  setConfig(config: CardConfig): void { this.config = { ...config }; }
  private get admin(): boolean { return this.hass?.user?.is_admin === true; }
  private get zone() { return planningData.zones.find((zone) => zone.id === this.selectedZone)!; }
  private get dirty(): boolean { return JSON.stringify(this.bindings) !== JSON.stringify(this.project?.planning_bindings ?? {}); }
  private number(value: number, decimals = 1): string { return formatNumber(value, this.hass, { maximumFractionDigits: decimals }); }

  protected updated(changed: PropertyValues): void {
    if (changed.has("hass") && this.hass && !this.loadStarted) { this.loadStarted = true; void this.loadProject(); }
  }

  private async loadProject(): Promise<void> {
    if (!this.hass || this.busy) return;
    this.loading = true; this.error = ""; this.notice = "";
    try {
      this.project = await this.hass.callWS<Project>({ type: "heizlast_ha/get_project" });
      this.bindings = clone(this.project.planning_bindings ?? {});
      this.conflict = false;
    } catch { this.error = "Sensorzuordnungen konnten nicht geladen werden. Die Planungsdaten bleiben sichtbar."; }
    finally { this.loading = false; }
  }

  private chooseFloor(floor: PlanningFloor): void {
    this.selectedFloor = floor;
    if (this.zone.floor !== floor) this.selectedZone = floor === "EG" ? 5 : 6;
    this.sensorSearch = "";
  }

  private chooseZone(id: number): void { this.selectedZone = id; this.sensorSearch = ""; }

  private toggleSensor(id: string, checked: boolean): void {
    if (!this.admin || !this.project || this.busy || this.conflict) return;
    const key = String(this.selectedZone), current = bindingFor(this.bindings, key);
    this.bindings = { ...this.bindings, [key]: checked ? [...new Set([...current, id])] : current.filter((value) => value !== id) };
    this.notice = "";
  }

  private async save(): Promise<void> {
    if (!this.hass || !this.admin || !this.project || !this.dirty || this.busy || this.conflict) return;
    this.busy = true; this.error = ""; this.notice = "";
    try {
      const result = await this.hass.callWS<Project>({ type: "heizlast_ha/save_planning_bindings", revision: this.project.revision, bindings: clone(this.bindings) });
      this.project = result; this.bindings = clone(result.planning_bindings ?? {});
      this.notice = "Sensorzuordnungen in Home Assistant gespeichert.";
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      this.conflict = code === "conflict";
      this.error = this.conflict ? "Das Projekt wurde zwischenzeitlich geändert. Laden Sie die aktuellen Zuordnungen und wählen Sie Ihre Änderungen erneut aus." : code === "unauthorized" ? "Zum Speichern sind Administratorrechte erforderlich." : "Sensorzuordnungen konnten nicht gespeichert werden. Bitte erneut versuchen.";
    } finally { this.busy = false; }
  }

  protected render() {
    const floorZones = zonesForFloor(this.selectedFloor);
    return html`<article class="dashboard">
      <header class="heading"><div><div class="eyebrow">Heizlast HA · Wohnhaus</div><h1>${this.config.title ?? "Heizlast im Grundriss"}</h1><p class="subtitle">Raum auswählen · Planungswerte prüfen · echte Sensoren zuordnen</p></div><span class="chip">Planungsdaten</span></header>
      <section class="metrics" aria-label="Gebäude und Planung"><div class="metric"><div class="metric-label">Gebäudeheizlast</div><strong>${this.number(planningData.building.heat_load_w, 0)} <small>W</small></strong><p>Heizlastberechnung · S. ${planningData.sources.building.page} / ${planningData.sources.building.sheet}</p></div><div class="metric"><div class="metric-label">Summe der Raumheizlasten</div><strong>${this.number(planningData.room_heat_load_sum_w)} <small>W</small></strong><p>${planningData.zones.length} gemeinsame oder einzelne Rechenzonen</p></div><div class="metric"><div class="metric-label">Beheizte Nettofläche</div><strong>${this.number(planningData.building.heated_net_floor_area_m2)} <small>m²</small></strong><p>EG + OG · Flächen aus der Berechnung</p></div></section>
      ${this.error ? html`<div class="notice error" role="alert">${this.error}${this.conflict || !this.project ? html`<br/><button ?disabled=${this.loading || this.busy} @click=${() => void this.loadProject()}>${this.conflict ? "Aktuelle Zuordnungen laden" : "Erneut laden"}</button>` : nothing}</div>` : nothing}
      ${this.notice ? html`<div class="notice" role="status">${this.notice}</div>` : nothing}
      <div class="toolbar"><nav class="floor-tabs" aria-label="Geschosse">${(["EG", "OG"] as PlanningFloor[]).map((floor) => html`<button aria-pressed=${this.selectedFloor === floor} @click=${() => this.chooseFloor(floor)}>${floorName(floor)}</button>`)}</nav><span class="floor-total">Summe Raumheizlasten ${this.selectedFloor}<strong>${this.number(floorLoad(this.selectedFloor))} W</strong></span></div>
      <div class="workspace"><section><div class="map-card"><div class="plan-heading"><strong>${floorName(this.selectedFloor)}</strong><span>Raumkonturen aus ${planningData.sources.plans[this.selectedFloor].document}</span></div>${this.renderPlan()}<div class="legend"><span><i class="dot"></i>Raum anklicken</span><span><i class="dot selected"></i>Ausgewählte Rechenzone</span><span><i class="dot uncertain"></i>? Zuordnung prüfen</span></div></div><div class="zone-heading"><span>Rechenzonen · ${floorZones.length} im ${this.selectedFloor}</span><span>Normheizlast</span></div><nav class="zone-list" aria-label="Rechenzonen">${floorZones.map((zone) => html`<button class="zone-button" data-zone=${zone.id} aria-pressed=${zone.id === this.selectedZone} @click=${() => this.chooseZone(zone.id)}><span class="zone-number">${zone.id}</span>${zone.name}${zone.uncertain ? " ?" : ""}<span>${this.number(zone.load)} W</span></button>`)}</nav></section><aside class="details" aria-label="Details der Rechenzone">${this.renderDetails()}</aside></div>
      <footer class="footer"><span>${planningData.notes.geometry}</span><span>Heizlastberechnung · ${formatNumber(Number(planningData.calculation_date.slice(8, 10)), this.hass)}.${planningData.calculation_date.slice(5, 7)}.${planningData.calculation_date.slice(0, 4)}</span></footer>
    </article>`;
  }

  private renderPlan() {
    const shapes = planningData.shapes.filter((shape) => shape.floor === this.selectedFloor);
    const [x0, y0, x1, y1] = planningData.floors[this.selectedFloor].bounds;
    const stairs = planningData.floors[this.selectedFloor].stairs;
    const [start, end] = [stairs[0], stairs[2]];
    return html`<div class="plan"><svg viewBox=${`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} role="group" aria-label=${`Grundriss ${floorName(this.selectedFloor)}`}><title>${floorName(this.selectedFloor)} · Raumkonturen und Rechenzonen</title>${shapes.filter((shape) => shape.poly).map((shape) => svg`<polygon class=${`room-shape ${shape.zone === this.selectedZone ? "selected" : ""} ${planningData.zones.find((zone) => zone.id === shape.zone)!.uncertain ? "uncertain" : ""}`} points=${polygonPoints(shape.poly!)} @click=${() => this.chooseZone(shape.zone)}><title>${shape.name} · Rechenzone ${shape.zone}</title></polygon>`)}<g aria-label="Treppe"><polygon class="stairs" points=${polygonPoints(stairs)}/>${Array.from({ length: 11 }, (_, i) => svg`<line class="stair-step" x1=${start[0] + (end[0] - start[0]) * (i + 1) / 12} x2=${start[0] + (end[0] - start[0]) * (i + 1) / 12} y1=${start[1]} y2=${end[1]}/>`)}<path class="stair-step" fill="none" d=${`M ${start[0] + 12} ${(start[1] + end[1]) / 2} H ${end[0] - 12} l -6 -4 m 6 4 l -6 4`}/></g></svg>${shapes.map((shape) => this.renderLabel(shape))}</div>`;
  }

  private renderLabel(shape: PlanShape) {
    const [x0, y0, x1, y1] = planningData.floors[this.selectedFloor].bounds;
    const zone = planningData.zones.find((zone) => zone.id === shape.zone)!;
    const combined = shapesForZone(shape.zone).length > 1;
    return html`<button class=${`room-label ${shape.zone === this.selectedZone ? "selected" : ""} ${zone.uncertain ? "uncertain" : ""}`} style=${styleMap({ left: `${(shape.center[0] - x0) / (x1 - x0) * 100}%`, top: `${(shape.center[1] - y0) / (y1 - y0) * 100}%` })} data-shape=${shape.key} aria-label=${`${shape.name} auswählen · Rechenzone ${zone.id}${zone.uncertain ? " · Zuordnung unsicher" : ""}`} aria-pressed=${shape.zone === this.selectedZone} @click=${() => this.chooseZone(shape.zone)}><strong>${shape.short}</strong><small>${combined ? `Zone ${zone.id} · gemeinsam` : `${this.number(zone.load)} W`}</small></button>`;
  }

  private renderDetails() {
    const zone = this.zone, shapes = shapesForZone(zone.id), planSource = planningData.sources.plans[zone.floor];
    return html`<div class="detail-kicker"><span>${floorName(zone.floor)}</span><span>Rechenzone ${zone.id}</span></div><h2>${zone.name}${zone.uncertain ? " ?" : ""}</h2><div class="heat-value">${this.number(zone.load)} <small>W</small></div><p class="heat-caption">Normheizlast · aus der Berechnung</p><dl><div><dt>Beheizte Fläche · Berechnung</dt><dd>${this.number(zone.area, 2)} m²</dd></div><div><dt>Auslegung innen</dt><dd>${this.number(zone.temperature, 0)} °C</dd></div></dl><div class="loss"><span>Transmission</span><b>${this.number(zone.transmission)} W</b></div><div class="loss"><span>Lüftung</span><b>${this.number(zone.ventilation)} W</b></div>
      ${zone.uncertain ? html`<div class="note warning">? Bad-Zuordnung prüfen: Der Sanitärraum im Plan OG ist unbeschriftet. Heizlast und Fläche stammen aus der Berechnung; die Zuordnung zur Kontur ist abgeleitet und noch zu bestätigen.</div>` : shapes.length > 1 ? html`<div class="note">Gemeinsame Rechenzone für ${shapes.map((shape) => shape.short).join(" + ")}. Fläche und Heizlast gelten für alle Teilräume zusammen.</div>` : nothing}
      ${this.renderSensors()}
      <details><summary>Quellen & Zuordnung</summary><div class="source"><p>Heizlastberechnung · S. ${zone.page} / R${zone.id}. Raumübersicht: S. 4 / Z1 und S. 5 / Z2.</p><p>${planSource.document} · S. ${planSource.page} / Blatt ${planSource.sheet}: ${shapes.map((shape) => `${shape.name}${shape.area === null ? " · Planfläche unbeschriftet" : ` · ${this.number(shape.area, 2)} m²`}`).join("; ")}.</p><p>${planningData.notes.geometry}</p><p>${planningData.notes.room_sum}</p><p>Auslegungstemperaturen sind Planungswerte. Aktuelle Raumtemperaturen stammen ausschließlich aus zugeordneten Home-Assistant-Sensoren.</p></div></details>`;
  }

  private renderSensors() {
    const selected = bindingFor(this.bindings, String(this.zone.id));
    const sensors = this.hass ? temperatureSensors(this.hass) : [];
    const filter = this.sensorSearch.toLocaleLowerCase();
    const candidates = [...sensors.filter((state) => selected.includes(state.entity_id) || `${state.entity_id} ${entityName(state, this.hass)}`.toLocaleLowerCase().includes(filter)).map((state) => state.entity_id), ...selected.filter((id) => !sensors.some((sensor) => sensor.entity_id === id))];
    return html`<section class="sensors"><h3>Aktuelle Raumtemperatur</h3>${this.loading ? html`<p class="hint" role="status">Sensorzuordnungen werden geladen …</p>` : selected.length ? selected.map((id) => html`<div class="sensor-reading"><span class="sensor-name">${entityName(this.hass?.states[id], this.hass) ?? id}<small class="sensor-id">${id}${this.hass?.states[id] && this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</small></span><strong>${this.hass?.states[id] && this.hass.states[id].attributes.device_class !== "temperature" ? "Kein Temperatursensor mehr" : temperatureLabel(this.hass?.states[id], this.hass)}</strong></div>`) : html`<p class="hint">Kein Sensor zugeordnet</p>`}<p class="hint">Planungswerte und Messwerte werden getrennt angezeigt.</p>
      ${this.admin && this.project ? html`<details><summary>Temperatursensoren zuordnen</summary><input class="sensor-filter" aria-label="Temperatursensor suchen" type="search" placeholder="Sensor suchen" .value=${this.sensorSearch} @input=${(event: Event) => this.sensorSearch = (event.target as HTMLInputElement).value}/><div class="sensor-select">${candidates.length ? candidates.map((id) => html`<label><input type="checkbox" .checked=${selected.includes(id)} ?disabled=${this.busy || this.conflict} @change=${(event: Event) => this.toggleSensor(id, (event.target as HTMLInputElement).checked)}/><span>${entityName(this.hass?.states[id], this.hass) ?? id}<small class="sensor-id">${id}${!this.hass?.states[id] ? " · entfernt" : this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</small></span></label>`) : html`<p class="hint">Keine vorhandenen Temperatursensoren gefunden.</p>`}</div><p class="hint">Zuordnung gilt für die gesamte Rechenzone. Mehrere Sensoren werden einzeln angezeigt.</p></details>${this.dirty ? html`<div class="actions"><button class="primary" ?disabled=${this.busy || this.conflict} @click=${() => void this.save()}>${this.busy ? "Wird gespeichert …" : "Zuordnungen speichern"}</button><button ?disabled=${this.busy} @click=${() => { this.bindings = clone(this.project?.planning_bindings ?? {}); this.notice = ""; }}>Änderungen verwerfen</button></div><p class="hint">Ungespeicherte Sensorzuordnungen</p>` : nothing}` : !this.admin ? html`<p class="hint">Ansicht mit Leserechten. Administratoren können Sensoren zuordnen.</p>` : nothing}</section>`;
  }
}

if (!customElements.get("heizlast-grundriss-card")) customElements.define("heizlast-grundriss-card", HeizlastGrundrissCard);
const registry = window as Window & { customCards?: Array<{ type: string; name: string; description: string; preview: boolean }> };
registry.customCards ??= [];
if (!registry.customCards.some((card) => card.type === "heizlast-grundriss-card")) registry.customCards.push({ type: "heizlast-grundriss-card", name: "Heizlast HA · Grundriss", description: "Grundriss von EG und OG mit belegten Heizlasten und echten Raumtemperaturen", preview: false });
