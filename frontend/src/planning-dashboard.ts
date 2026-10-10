import { LitElement, html, svg, nothing, type PropertyValues } from "lit";
import { planningStyles } from "./planning-styles";
import { planningData, floorLoad, floorName, polygonPoints, shapesForZone, zonesForFloor, type PlanningFloor, type PlanShape } from "./planning-types";
import { bindingFor, clone, entityName, formatNumber, measuredTemperatureLabel, outdoorTemperatureLabel, roleSensor, solarRadiationLabel, temperatureSensors, type CardConfig, type HomeAssistant, type Project } from "./types";
import { estimatedHeatLoadW, solarGainsW } from "./heat-load";
import { defaultSimulationParameters, defaultSimulationScenario, HEATING_CALIBRATION, SIMULATION_RANGES, simulateBuilding, type SimulationParameters, type SimulationResult, type SimulationScenario, type ZoneSimulationResult } from "./simulation-core";

type ScenarioField = Exclude<keyof SimulationScenario, "weather" | "month">;
type SimulationField = ScenarioField | keyof SimulationParameters;
const initialScenario = defaultSimulationScenario(planningData);
const initialParameters = defaultSimulationParameters(planningData);
const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const scenarioFields: { key: ScenarioField; label: string; step: number }[] = [
  { key: "supplyTemperatureC", label: "Vorlauf (°C)", step: 0.5 },
  { key: "indoorTemperatureC", label: "Gewünschte Innentemperatur (°C)", step: 0.5 },
  { key: "outdoorTemperatureC", label: "Außentemperatur (°C)", step: 0.5 },
];
const heatingFields: { key: keyof SimulationParameters; label: string; step: number }[] = [
  { key: "returnDropK", label: "Spreizung am Referenzpunkt (K)", step: 0.5 },
  { key: "activeFloorFraction", label: "Aktiver Flächenanteil (0–1)", step: 0.05 },
  { key: "referenceHeatFluxWPerM2", label: "Referenzleistung (W/m²)", step: 1 },
  { key: "referenceIndoorTemperatureC", label: "Referenz-Innentemperatur (°C)", step: 0.5 },
  { key: "emissionExponent", label: "Kennlinienexponent", step: 0.05 },
  { key: "maxFloorSurfaceTemperatureC", label: "Maximale Bodenoberfläche (°C)", step: 0.5 },
];
const weatherFields: typeof heatingFields = [
  { key: "sunnyDirectNormalWPerM2", label: "Referenz-Direktstrahlung sonnig bei 45° (W/m²)", step: 10 },
  { key: "sunnyDiffuseWPerM2", label: "Referenz-Diffusstrahlung sonnig bei 45° (W/m²)", step: 10 },
  { key: "cloudyDiffuseWPerM2", label: "Referenz-Diffusstrahlung bewölkt bei 45° (W/m²)", step: 10 },
  { key: "groundReflectance", label: "Bodenreflexion (0–1)", step: 0.05 },
];

export class HeizlastGrundrissCard extends LitElement {
  static styles = planningStyles;
  static properties = {
    hass: { attribute: false }, config: { state: true }, selectedFloor: { state: true }, selectedZone: { state: true },
    project: { state: true }, bindings: { state: true }, loading: { state: true }, busy: { state: true },
    error: { state: true }, conflict: { state: true }, notice: { state: true }, sensorSearch: { state: true },
    selectedView: { state: true }, scenarioInputs: { state: true }, parameterInputs: { state: true }, weather: { state: true }, month: { state: true }, latitudeInput: { state: true },
  };
  hass?: HomeAssistant;
  private config: CardConfig = { type: "custom:heizlast-grundriss-card" };
  private selectedFloor: PlanningFloor = "EG";
  private selectedZone = 5;
  private selectedView: "live" | "simulation" = "live";
  private scenarioInputs: Record<ScenarioField, string> = { supplyTemperatureC: String(initialScenario.supplyTemperatureC), indoorTemperatureC: String(initialScenario.indoorTemperatureC), outdoorTemperatureC: String(initialScenario.outdoorTemperatureC) };
  private parameterInputs = Object.fromEntries(Object.entries(initialParameters).map(([key, value]) => [key, String(value)])) as Record<keyof SimulationParameters, string>;
  private weather: SimulationScenario["weather"] = initialScenario.weather;
  private month = String(initialScenario.month);
  private latitudeInput = "";
  private simulationCache?: { scenario: Record<ScenarioField, string>; parameters: Record<keyof SimulationParameters, string>; weather: SimulationScenario["weather"]; month: string; latitude: string; result: SimulationResult };
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
  private readings(id: number) {
    const sensors = bindingFor(this.bindings, String(id));
    const zone = planningData.zones.find((zone) => zone.id === id)!;
    const room = !this.loading && sensors.length === 1 ? this.hass?.states[sensors[0]] : undefined;
    const losses = estimatedHeatLoadW(zone, room, roleSensor(this.hass, "outdoor_temperature"), planningData.building.design_outdoor_temperature_c);
    const solar = solarGainsW(zone, roleSensor(this.hass, "solar_radiation"), planningData.solar_assumptions);
    const current = losses === null ? null : Math.max(0, losses - (solar ?? 0));
    return {
      temperature: measuredTemperatureLabel(room, this.hass),
      calculated: Number.isFinite(zone.load) ? `${this.number(zone.load)} W` : "?",
      current: current === null ? "?" : `≈ ${this.number(current, 0)} W`,
      solar: solar === null ? "?" : `≈ ${this.number(solar, 0)} W`,
      solarIncluded: losses !== null && solar !== null,
    };
  }

  private readingDescription(id: number): string {
    if (this.selectedView === "simulation") {
      const result = this.simulatedZone(id);
      return `Mittlerer Wärmebedarf: ${this.watts(result?.heatDemandW)} / Mögliche FBH-Leistung: ${this.watts(result?.heatingPowerW)} / Mittlere Bilanz: ${result ? `${result.balanceW < 0 ? "−" : "+"}${this.watts(Math.abs(result.balanceW))}` : "?"} / ${this.balanceDescription(result)} / Solare Gewinne im Tagesmittel: ${this.watts(result?.solarGainsW)} / Solarüberschuss im Tagesmittel: ${this.watts(result?.solarSurplusW)}`;
    }
    const values = this.readings(id);
    return `Aktuelle Temperatur: ${values.temperature} / Berechnete Heizlast: ${values.calculated} / Aktuelle Heizlast: ${values.current}`;
  }

  private get simulation(): SimulationResult {
    const latitudeDeg = this.hassLatitude ?? this.simulationNumber(this.latitudeInput);
    const latitude = String(latitudeDeg);
    if (this.simulationCache?.scenario === this.scenarioInputs && this.simulationCache.parameters === this.parameterInputs && this.simulationCache.weather === this.weather && this.simulationCache.month === this.month && this.simulationCache.latitude === latitude) return this.simulationCache.result;
    const scenario: SimulationScenario = { supplyTemperatureC: this.simulationNumber(this.scenarioInputs.supplyTemperatureC), indoorTemperatureC: this.simulationNumber(this.scenarioInputs.indoorTemperatureC), outdoorTemperatureC: this.simulationNumber(this.scenarioInputs.outdoorTemperatureC), weather: this.weather, month: this.simulationNumber(this.month) };
    const parameters = Object.fromEntries(Object.entries(this.parameterInputs).map(([key, value]) => [key, this.simulationNumber(value)])) as unknown as SimulationParameters;
    const result = simulateBuilding(planningData, scenario, parameters, { latitudeDeg });
    this.simulationCache = { scenario: this.scenarioInputs, parameters: this.parameterInputs, weather: this.weather, month: this.month, latitude, result };
    return result;
  }

  private simulationNumber(value: string): number { return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN; }
  private get hassLatitude(): number | undefined {
    const latitude = this.hass?.config?.latitude;
    return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : undefined;
  }

  private simulatedZone(id: number): ZoneSimulationResult | undefined { return this.simulation.zones.find((zone) => zone.id === id); }
  private watts(value?: number): string { return value === undefined ? "?" : `≈ ${this.number(value, 0)} W`; }
  private simulationClass(id: number): string {
    if (this.selectedView !== "simulation") return "";
    const result = this.simulatedZone(id);
    return result ? result.peakDeficitW > 0 ? "simulated-deficit" : "simulated-covered" : "simulated-invalid";
  }
  private balanceDescription(result?: ZoneSimulationResult, compact = false): string { return result ? result.peakDeficitW > 0 ? `${compact ? "Spitzen-Defizit" : "Größtes Defizit (ohne Speicher)"}: ${this.watts(result.peakDeficitW)}` : compact ? "Spitze gedeckt" : "Spitzenbedarf gedeckt" : "Leistungsbilanz: ?"; }

  private simulationInput(key: SimulationField, value: string): void {
    if (Object.hasOwn(this.scenarioInputs, key)) this.scenarioInputs = { ...this.scenarioInputs, [key]: value };
    else this.parameterInputs = { ...this.parameterInputs, [key]: value };
  }

  private renderSimulationInput(field: { key: SimulationField; label: string; step: number }) {
    const value = Object.hasOwn(this.scenarioInputs, field.key) ? this.scenarioInputs[field.key as ScenarioField] : this.parameterInputs[field.key as keyof SimulationParameters];
    const [min, max] = SIMULATION_RANGES[field.key];
    return html`<label>${field.label}<input type="number" aria-label=${field.label} aria-invalid=${this.simulation.errors.includes(field.key)} min=${min} max=${max} step=${field.step} .value=${value} @input=${(event: Event) => this.simulationInput(field.key, (event.target as HTMLInputElement).value)}/></label>`;
  }

  private renderSimulationControls() {
    const fields = [...scenarioFields, ...heatingFields, ...weatherFields];
    const monthName = monthNames[Number(this.month) - 1];
    return html`<section class="scenario" aria-label="Simulationsszenario">
      <h2>Szenario</h2><p class="hint">24h-Tagesmittel für den 15. des gewählten Monats. Die Außentemperatur bleibt über diesen Referenztag konstant; solare Tagesüberschüsse werden ohne Speicher nicht in die Nacht übertragen.</p>
      <div class="scenario-grid"><label>Monat<select aria-label="Monat" aria-invalid=${this.simulation.errors.includes("month")} .value=${this.month} @change=${(event: Event) => this.month = (event.target as HTMLSelectElement).value}>${monthNames.map((name, index) => html`<option value=${index + 1} .selected=${String(index + 1) === this.month}>${name}</option>`)}</select></label>${scenarioFields.map((field) => this.renderSimulationInput(field))}<label>Wetter<select aria-label="Wetter" .value=${this.weather} @change=${(event: Event) => this.weather = (event.target as HTMLSelectElement).value as SimulationScenario["weather"]}><option value="sunny">Sonnig</option><option value="cloudy">Bewölkt</option></select></label></div>
      ${this.hassLatitude !== undefined ? html`<p class="hint">Standortbreite aus Home Assistant: ${this.number(this.hassLatitude, 2)}°. Monat und Breitengrad bestimmen das Solar-Tagesprofil.</p>` : html`<div class="scenario-grid"><label>Breitengrad für das Szenario (°)<input type="number" aria-label="Breitengrad für das Szenario (°)" aria-invalid=${this.simulation.errors.some((key) => key === "latitudeDeg" || key === "site.latitudeDeg")} min="-90" max="90" step="0.1" .value=${this.latitudeInput} @input=${(event: Event) => this.latitudeInput = (event.target as HTMLInputElement).value}/></label></div><p class="hint">Kein gültiger Home-Assistant-Standort verfügbar. Einen Breitengrad als eigene Szenarioannahme eingeben; der Wert bleibt nur in dieser Ansicht.</p>`}
      <p class="hint">Solarer Referenztag: 15. ${monthName ?? "?"} · Tageslänge ${this.simulation.solarProfile ? `${this.number(this.simulation.solarProfile.daylightHours)} h` : "?"} · berechnete Werte sind Näherungen.</p>
      <details class="scenario-assumptions"><summary>FBH-Annahmen einstellen</summary><p class="hint">Belegter EnEV-Planungsansatz: Vorlauf ${this.number(planningData.underfloor_heating.design_supply_temperature_c, 0)} °C / Rücklauf ${this.number(planningData.underfloor_heating.design_return_temperature_c, 0)} °C · ${planningData.sources.heating.document}, S. ${planningData.sources.heating.pages.join(" / ")}.</p><p class="hint">Einstellbare Modellannahmen: aktive Fläche, Referenzleistung und Raumtemperatur, Kennlinie und Oberflächengrenze. Startwerte: ${this.number(initialParameters.activeFloorFraction * 100, 0)} % aktive Fläche und ${this.number(initialParameters.referenceHeatFluxWPerM2, 0)} W/m² bei ${this.number(planningData.underfloor_heating.design_supply_temperature_c, 0)}/${this.number(planningData.underfloor_heating.design_return_temperature_c, 0)} °C und ${this.number(initialParameters.referenceIndoorTemperatureC, 0)} °C innen. Die Raumflächen stammen aus der Heizlastberechnung; die tatsächlichen Heizflächen und die raumbezogene FBH-Auslegung sind nicht belegt.</p><p class="hint">Kalibrierannahme für die Startwerte: ${this.number(HEATING_CALIBRATION.indoorTemperatureC, 0)} °C innen bei ${this.number(HEATING_CALIBRATION.outdoorTemperatureC, 0)} °C außen und ${this.number(planningData.underfloor_heating.design_supply_temperature_c, 0)} °C Vorlauf ohne solare Gewinne in allen Räumen halten. Die gemeinsame Referenzleistung folgt dem Raum mit dem höchsten Bedarf je aktiver Heizfläche, auf volle W/m² aufgerundet. Dies ist eine Annahme, keine Messung. Geänderte Eingaben werden nicht automatisch nachkalibriert.</p><p class="hint">Die Spreizung gilt am Referenzpunkt; dessen Rücklauf muss über der Referenz-Innentemperatur liegen. Die logarithmische Wasserkennlinie setzt einen angenommenen konstanten spezifischen Durchfluss voraus.</p><div class="scenario-grid">${heatingFields.map((field) => this.renderSimulationInput(field))}</div></details>
      <details class="scenario-assumptions"><summary>Wetterannahmen einstellen</summary><p class="hint">Einstellbare Strahlungsreferenzen bei 45° Sonnenhöhe. Das Monats-/Breitengradprofil berücksichtigt den ganzen Tag einschließlich Nacht. Sonnig nutzt ein angenähertes Klarhimmelprofil; bewölkt setzt die Direktstrahlung auf 0. Für ein Szenario ohne solare Gewinne Bewölkt wählen und dessen Referenz-Diffusstrahlung auf 0 setzen. Diese Werte sind Szenarioannahmen, keine gemessenen Monatsmittel. Die solaren Planungsfaktoren aus dem EnEV-Nachweis bleiben Grundlage.</p><div class="scenario-grid">${weatherFields.map((field) => this.renderSimulationInput(field))}</div></details>
      ${!this.simulation.valid ? html`<div class="notice error scenario-errors" role="alert"><strong>Szenario unvollständig oder ungültig.</strong>${this.simulation.errors.map((key) => {
        if (key === "latitudeDeg" || key === "site.latitudeDeg") return html`<p>Für dieses Szenario ist ein Breitengrad zwischen −90° und 90° erforderlich.</p>`;
        if (key === "month") return html`<p>Einen Monat von Januar bis Dezember auswählen.</p>`;
        const field = fields.find((field) => field.key === key);
        if (!field) return html`<p>${key === "weather" ? "Wetterzustand prüfen." : "Die Planungsdaten reichen für dieses Szenario nicht aus."}</p>`;
        const [min, max] = SIMULATION_RANGES[field.key];
        return html`<p>${field.label} prüfen · zulässiger Bereich: ${this.number(min, 2)} bis ${this.number(max, 2)}.</p>`;
      })}${this.simulation.errors.some((key) => key === "returnDropK" || key === "referenceIndoorTemperatureC" || key === "referenceHeatFluxWPerM2") ? html`<p>Referenzleistung, Referenzspreizung und Referenz-Innentemperatur müssen zusammenpassen. Die Referenz-Bodenoberfläche darf nicht über der Heizmitteltemperatur liegen.</p><p>Der Referenzrücklauf muss über der Referenz-Innentemperatur liegen.</p>` : nothing}</div>` : nothing}
    </section>${this.renderSimulationMetrics()}`;
  }

  private renderSimulationMetrics() {
    const zones = this.simulation.zones.filter((zone) => zonesForFloor(this.selectedFloor).some((planningZone) => planningZone.id === zone.id));
    const total = (key: "heatDemandW" | "heatingPowerW" | "solarGainsW" | "solarSurplusW") => this.simulation.valid ? this.watts(zones.reduce((sum, zone) => sum + zone[key], 0)) : "?";
    return html`<section class="metrics simulation-metrics" aria-label="Szenarioergebnisse">
      <div class="metric"><div class="metric-label">Mittlerer Wärmebedarf ${this.selectedFloor}</div><strong>${total("heatDemandW")}</strong><p>24h-Tagesmittel · nach nutzbarer Solarwärme</p></div>
      <div class="metric"><div class="metric-label">Mögliche FBH-Leistung ${this.selectedFloor}</div><strong>${total("heatingPowerW")}</strong><p>Heizkapazität bei gewählten Temperaturen</p></div>
      <div class="metric"><div class="metric-label">Räume mit Spitzen-Defizit ${this.selectedFloor}</div><strong>${this.simulation.valid ? `${zones.filter((zone) => zone.peakDeficitW > 0).length} / ${zones.length}` : "?"}</strong><p>Größter Bedarf am Referenztag · ohne Speicher</p></div>
      <div class="metric"><div class="metric-label">Solare Gewinne ${this.selectedFloor}</div><strong>${total("solarGainsW")}</strong><p>24h-Tagesmittel · nach EnEV-Annahmen</p></div>
      <div class="metric"><div class="metric-label">Solarüberschuss ${this.selectedFloor}</div><strong>${total("solarSurplusW")}</strong><p>24h-Mittel · nicht als Nachtwärme verrechnet</p></div>
    </section>`;
  }

  private renderSimulationDetails() {
    const result = this.simulatedZone(this.zone.id);
    return html`<div class="detail-kicker"><span>${floorName(this.zone.floor)}</span><span>Simulation · Zone ${this.zone.id}</span></div><h2>${this.zone.name}</h2><div class="simulation-results">
      <div class="heat-value">${this.watts(result?.heatDemandW)}</div><p class="heat-caption">Mittlerer Wärmebedarf · 24h-Referenztag</p>
      <div class="loss"><span>Temperaturbezogene Verluste</span><b>${this.watts(result?.heatLossW)}</b></div><div class="loss"><span>Solare Gewinne · Tagesmittel</span><b>${this.watts(result?.solarGainsW)}</b></div><div class="loss"><span>Solarüberschuss · Tagesmittel</span><b>${this.watts(result?.solarSurplusW)}</b></div><div class="loss"><span>Größter Solargewinn am Tag</span><b>${this.watts(result?.peakSolarGainsW)}</b></div><div class="loss"><span>Mögliche FBH-Leistung</span><b>${this.watts(result?.heatingPowerW)}</b></div><div class="loss"><span>Größter Wärmebedarf</span><b>${this.watts(result?.peakHeatDemandW)}</b></div><div class="loss"><span>Größtes Defizit (ohne Speicher)</span><b>${this.watts(result?.peakDeficitW)}</b></div>
      <div class=${`simulation-balance ${result ? result.peakDeficitW > 0 ? "deficit" : "covered" : ""}`} role="status">${this.balanceDescription(result)}${result ? html`<p>${result.peakDeficitW > 0 ? "Die mögliche FBH-Leistung reicht zeitweise nicht für den Wärmebedarf. Solare Tagesüberschüsse werden ohne Speicher nicht in die Nacht übertragen." : "Die mögliche FBH-Leistung deckt auch den größten Bedarf dieses Referenztages."}</p>` : html`<p>Ein gültiges Szenario mit Standort eingeben, um diesen Raum zu vergleichen.</p>`}</div>
      <dl><div><dt>Planfläche des Raumes</dt><dd>${this.number(this.zone.area, 2)} m²</dd></div><div><dt>Angenommene aktive FBH-Fläche</dt><dd>${result ? `${this.number(result.activeFloorAreaM2, 2)} m²` : "?"}</dd></div><div><dt>Geschätzte Bodenoberfläche</dt><dd>${result ? `${this.number(result.floorSurfaceTemperatureC)} °C` : "?"}</dd></div><div><dt>Angenäherter Rücklauf</dt><dd>${result ? `${this.number(result.returnTemperatureC)} °C` : "?"}</dd></div><div><dt>Wärmestromdichte</dt><dd>${result ? `${this.number(result.heatFluxWPerM2)} W/m²` : "?"}</dd></div><div><dt>Gewählte Innentemperatur</dt><dd>${this.simulation.valid ? `${this.number(Number(this.scenarioInputs.indoorTemperatureC))} °C` : "?"}</dd></div></dl>
      <p class="hint">Die FBH-Zahl ist mögliche Heizkapazität; die tatsächlich abgegebene Wärme hängt von Bedarf und Regelung ab. Eine positive mittlere Bilanz kann ein Nachtdefizit nicht ausgleichen. Keine Wärmespeicherung oder Raumtemperaturprognose.</p>
      <details><summary>Planungsdaten & Quellen</summary><div class="source"><p>Normheizlast: ${this.number(this.zone.load)} W · Auslegung innen ${this.number(this.zone.temperature, 0)} °C · Auslegung außen ${this.number(planningData.building.design_outdoor_temperature_c)} °C.</p><p>Heizlastberechnung · S. ${this.zone.page} / R${this.zone.id}. ${planningData.sources.plans[this.zone.floor].document} · S. ${planningData.sources.plans[this.zone.floor].page} / Blatt ${planningData.sources.plans[this.zone.floor].sheet}.</p><p>Fensterbauteilflächen: ${this.zone.solar_windows.length ? this.zone.solar_windows.map((window) => `${({ N: "Nord", E: "Ost", S: "Süd", W: "West" })[window.orientation]} ${this.number(window.area_m2, 3)} m²`).join("; ") : "Für diese Rechenzone sind keine Fensterbauteile zugeordnet."}</p><p>${planningData.sources.solar.document} · S. ${planningData.sources.solar.pages.join(" / ")} / Abschnitt ${planningData.sources.solar.section}. Verglasungs-, Verschattungs- und Einfallsfaktoren stammen aus demselben Planungsansatz.</p></div></details>
    </div>`;
  }

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

  private viewKeydown(event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    this.selectedView = event.key === "Home" ? "live" : event.key === "End" ? "simulation" : this.selectedView === "live" ? "simulation" : "live";
    void this.updateComplete.then(() => this.shadowRoot!.querySelector<HTMLButtonElement>(`#view-${this.selectedView}`)?.focus());
  }

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
      <header class="heading"><div><div class="eyebrow">Heizlast HA · Wohnhaus</div><h1>${this.config.title ?? "Heizlast im Grundriss"}</h1><p class="subtitle">${this.selectedView === "live" ? "Raum auswählen · Planungswerte prüfen · echte Sensoren zuordnen" : "Szenario einstellen · Wärmebedarf und Fußbodenheizung vergleichen"}</p></div><span class="chip">${this.selectedView === "live" ? "Planungsdaten" : "Simulation · Näherung"}</span></header>
      <div class="view-tabs" role="tablist" aria-label="Ansichten">${(["live", "simulation"] as const).map((view) => html`<button id=${`view-${view}`} role="tab" aria-selected=${this.selectedView === view} aria-controls="dashboard-view" tabindex=${this.selectedView === view ? 0 : -1} @click=${() => this.selectedView = view} @keydown=${(event: KeyboardEvent) => this.viewKeydown(event)}>${view === "live" ? "Live" : "Simulation"}</button>`)}</div>
      <div id="dashboard-view" role="tabpanel" aria-labelledby=${`view-${this.selectedView}`}>
      ${this.selectedView === "simulation" ? this.renderSimulationControls() : html`<section class="metrics" aria-label="Gebäude und Planung"><div class="metric"><div class="metric-label">Gebäudeheizlast</div><strong>${this.number(planningData.building.heat_load_w, 0)} <small>W</small></strong><p>Heizlastberechnung · S. ${planningData.sources.building.page} / ${planningData.sources.building.sheet}</p></div><div class="metric"><div class="metric-label">Summe der Raumheizlasten</div><strong>${this.number(planningData.room_heat_load_sum_w)} <small>W</small></strong><p>${planningData.zones.length} gemeinsame oder einzelne Rechenzonen</p></div><div class="metric"><div class="metric-label">Beheizte Nettofläche</div><strong>${this.number(planningData.building.heated_net_floor_area_m2)} <small>m²</small></strong><p>EG + OG · Flächen aus der Berechnung</p></div><div class="metric outdoor-temperature"><div class="metric-label">Außentemperatur</div><strong>${outdoorTemperatureLabel(this.hass)}</strong><p>Standort Home Assistant · <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · 30-Minuten-Abfrage</p></div><div class="metric solar-radiation"><div class="metric-label">Sonneneinstrahlung</div><strong>${solarRadiationLabel(this.hass)}</strong><p>Horizontale Globalstrahlung · Open-Meteo</p></div></section>`}
      ${this.selectedView === "live" && this.error ? html`<div class="notice error" role="alert">${this.error}${this.conflict || !this.project ? html`<br/><button ?disabled=${this.loading || this.busy} @click=${() => void this.loadProject()}>${this.conflict ? "Aktuelle Zuordnungen laden" : "Erneut laden"}</button>` : nothing}</div>` : nothing}
      ${this.selectedView === "live" && this.notice ? html`<div class="notice" role="status">${this.notice}</div>` : nothing}
      <div class="toolbar"><nav class="floor-tabs" aria-label="Geschosse">${(["EG", "OG"] as PlanningFloor[]).map((floor) => html`<button aria-pressed=${this.selectedFloor === floor} @click=${() => this.chooseFloor(floor)}>${floorName(floor)}</button>`)}</nav><span class="floor-total">Summe Normheizlasten ${this.selectedFloor}<strong>${this.number(floorLoad(this.selectedFloor))} W</strong></span></div>
      <div class="workspace"><section><div class="map-card"><div class="plan-heading"><strong>${floorName(this.selectedFloor)}</strong><span>Raumkonturen aus ${planningData.sources.plans[this.selectedFloor].document}</span></div>${this.renderPlan()}${this.selectedView === "simulation" ? html`<p class="readings-legend">Mittlerer Wärmebedarf / mögliche FBH-Leistung / mittlere Bilanz (alle W) · ≈ = Näherung · + = mittlere Reserve · − = mittleres Defizit · ? = ungültiges Szenario</p><div class="legend"><span><i class="dot covered"></i>Spitzenbedarf gedeckt</span><span><i class="dot deficit"></i>Spitzen-Defizit · ohne Speicher</span><span><i class="dot selected"></i>Ausgewählter Raum</span></div>` : html`<p class="readings-legend">Aktuelle Temperatur / berechnete Heizlast / aktuelle Heizlast · ? = Wert nicht verfügbar · ≈ = Schätzung aus Temperaturen und verfügbaren solaren Gewinnen</p><p class="readings-legend">Heizlasten gelten für die gesamte Rechenzone. Mehrere Temperatursensoren werden in den Raumdetails einzeln angezeigt; im Grundriss steht dann ?.</p><div class="legend"><span><i class="dot"></i>Raum anklicken</span><span><i class="dot selected"></i>Ausgewählte Rechenzone</span>${floorZones.some((zone) => zone.uncertain) ? html`<span><i class="dot uncertain"></i>? Zuordnung prüfen</span>` : nothing}</div>`}</div><div class="zone-heading"><span>Rechenzonen · ${floorZones.length} im ${this.selectedFloor}</span><span>${this.selectedView === "simulation" ? "Leistungsbilanz" : "Normheizlast"}</span></div><nav class="zone-list" aria-label="Rechenzonen">${floorZones.map((zone) => html`<button class="zone-button" data-zone=${zone.id} aria-label=${this.selectedView === "simulation" ? `${zone.name} auswählen · ${this.readingDescription(zone.id)}` : `${zone.name} auswählen`} aria-pressed=${zone.id === this.selectedZone} @click=${() => this.chooseZone(zone.id)}><span class="zone-number">${zone.id}</span>${zone.name}${zone.uncertain ? " ?" : ""}<span>${this.selectedView === "simulation" ? this.balanceDescription(this.simulatedZone(zone.id), true) : `${this.number(zone.load)} W`}</span></button>`)}</nav></section><aside class="details" aria-label="Details der Rechenzone">${this.selectedView === "simulation" ? this.renderSimulationDetails() : this.renderDetails()}</aside></div>
      <footer class="footer"><span>${planningData.notes.geometry}</span><span>Heizlastberechnung · ${formatNumber(Number(planningData.calculation_date.slice(8, 10)), this.hass)}.${planningData.calculation_date.slice(5, 7)}.${planningData.calculation_date.slice(0, 4)}</span></footer>
      </div>
    </article>`;
  }

  private renderPlan() {
    const shapes = planningData.shapes.filter((shape) => shape.floor === this.selectedFloor);
    const [x0, y0, x1, y1] = planningData.floors[this.selectedFloor].bounds;
    const stairs = planningData.floors[this.selectedFloor].stairs;
    const [start, end] = [stairs[0], stairs[2]];
    return html`<div class="plan"><svg viewBox=${`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} role="group" aria-label=${`Grundriss ${floorName(this.selectedFloor)}`}><title>${floorName(this.selectedFloor)} · Raumkonturen und Rechenzonen</title>${shapes.filter((shape) => shape.poly).map((shape) => svg`<polygon class=${`room-shape ${this.simulationClass(shape.zone)} ${shape.zone === this.selectedZone ? "selected" : ""} ${planningData.zones.find((zone) => zone.id === shape.zone)!.uncertain ? "uncertain" : ""}`} points=${polygonPoints(shape.poly!)} @click=${() => this.chooseZone(shape.zone)}><title>${shape.name} · Rechenzone ${shape.zone}${this.selectedView === "simulation" ? ` · ${this.readingDescription(shape.zone)}` : ""}</title></polygon>`)}<g aria-label="Treppe"><polygon class="stairs" points=${polygonPoints(stairs)}/>${Array.from({ length: 11 }, (_, i) => svg`<line class="stair-step" x1=${start[0] + (end[0] - start[0]) * (i + 1) / 12} x2=${start[0] + (end[0] - start[0]) * (i + 1) / 12} y1=${start[1]} y2=${end[1]}/>`)}<path class="stair-step" fill="none" d=${`M ${start[0] + 12} ${(start[1] + end[1]) / 2} H ${end[0] - 12} l -6 -4 m 6 4 l -6 4`}/></g>${shapes.map((shape) => this.renderLabel(shape))}</svg></div>`;
  }

  private renderLabel(shape: PlanShape) {
    const zone = planningData.zones.find((zone) => zone.id === shape.zone)!;
    const [width, height] = shape.label_box;
    let row: string;
    if (this.selectedView === "simulation") {
      const result = this.simulatedZone(zone.id);
      row = result ? `≈ ${this.number(result.heatDemandW, 0)} / ${this.number(result.heatingPowerW, 0)} / ${result.balanceW < 0 ? "−" : "+"}${this.number(Math.abs(result.balanceW), 0)} W` : "? / ? / ?";
    } else {
      const values = this.readings(zone.id);
      row = `${values.temperature} / ${values.calculated} / ${values.current}`;
    }
    const name = `${shape.short}${zone.uncertain ? " ?" : ""}`;
    const description = this.readingDescription(zone.id);
    return svg`<foreignObject class="room-label-box" x=${shape.center[0] - width / 2} y=${shape.center[1] - height / 2} width=${width} height=${height}><button xmlns="http://www.w3.org/1999/xhtml" class=${`room-label ${shape.zone === this.selectedZone ? "selected" : ""} ${zone.uncertain ? "uncertain" : ""}`} data-shape=${shape.key} title=${`${shape.name} · ${description}`} aria-label=${`${shape.name} auswählen · Rechenzone ${zone.id}${zone.uncertain ? " · Zuordnung unsicher" : ""} · ${description}`} aria-pressed=${shape.zone === this.selectedZone} @click=${() => this.chooseZone(shape.zone)}><svg viewBox=${`0 0 ${width} ${height}`} aria-hidden="true"><text class="room-name" x=${width / 2} y="12" text-anchor="middle">${name}</text><text class="room-readings" x=${width / 2} y="25" text-anchor="middle">${row}</text></svg></button></foreignObject>`;
  }

  private renderDetails() {
    const zone = this.zone, shapes = shapesForZone(zone.id), planSource = planningData.sources.plans[zone.floor];
    return html`<div class="detail-kicker"><span>${floorName(zone.floor)}</span><span>Rechenzone ${zone.id}</span></div><h2>${zone.name}${zone.uncertain ? " ?" : ""}</h2><div class="heat-value">${this.number(zone.load)} <small>W</small></div><p class="heat-caption">Normheizlast · aus der Berechnung</p><dl><div><dt>Beheizte Fläche · Berechnung</dt><dd>${this.number(zone.area, 2)} m²</dd></div><div><dt>Auslegung innen</dt><dd>${this.number(zone.temperature, 0)} °C</dd></div></dl><div class="loss"><span>Transmission</span><b>${this.number(zone.transmission)} W</b></div><div class="loss"><span>Lüftung</span><b>${this.number(zone.ventilation)} W</b></div>
      ${zone.uncertain ? html`<div class="note warning">? Bad-Zuordnung prüfen: Der Sanitärraum im Plan OG ist unbeschriftet. Heizlast und Fläche stammen aus der Berechnung; die Zuordnung zur Kontur ist abgeleitet und noch zu bestätigen.</div>` : shapes.length > 1 ? html`<div class="note">Gemeinsame Rechenzone für ${shapes.map((shape) => shape.short).join(" + ")}. Fläche und Heizlast gelten für alle Teilräume zusammen.</div>` : nothing}
      ${this.renderSensors()}
      <details><summary>Quellen & Zuordnung</summary><div class="source"><p>Heizlastberechnung · S. ${zone.page} / R${zone.id}. Raumübersicht: S. 4 / Z1 und S. 5 / Z2.</p><p>${planSource.document} · S. ${planSource.page} / Blatt ${planSource.sheet}: ${shapes.map((shape) => `${shape.name}${shape.area === null ? " · Planfläche unbeschriftet" : ` · ${this.number(shape.area, 2)} m²`}`).join("; ")}.</p><p>${planningData.notes.geometry}</p><p>${planningData.notes.room_sum}</p><p>Aktuelle Heizlast ≈ Normheizlast × max(0, Raumtemperatur − Außentemperatur) / (Auslegung innen − Auslegung außen). Auslegung außen: ${this.number(planningData.building.design_outdoor_temperature_c)} °C · ${planningData.sources.climate.document}, S. ${planningData.sources.climate.page} / ${planningData.sources.climate.sheet}. Davon werden verfügbare solare Gewinne abgezogen, mindestens 0 W. Interne Gewinne, wechselnde Lüftung und Wärmespeicherung werden nicht berücksichtigt.</p><p>Solare Gewinne ≈ Summe(Fensterbauteilfläche × Fassadeneinstrahlung) × ${this.number(planningData.solar_assumptions.glazing_fraction,2)} Rahmenfaktor × ${this.number(planningData.solar_assumptions.g_value,2)} g-Wert × ${this.number(planningData.solar_assumptions.shading_factor,2)} Verschattung × ${this.number(planningData.solar_assumptions.sun_protection_factor,2)} Sonnenschutz × ${this.number(planningData.solar_assumptions.incidence_factor,2)} Einfallsfaktor. ${planningData.sources.solar.document}, S. ${planningData.sources.solar.pages.join("–")} / Abschnitt ${planningData.sources.solar.section}. Diese Planungsfaktoren berücksichtigen keinen aktuellen Rollladenstatus.</p><p>${planningData.notes.solar}</p><p>Auslegungstemperaturen sind Planungswerte. Aktuelle Raumtemperaturen stammen ausschließlich aus zugeordneten Home-Assistant-Sensoren.</p></div></details>`;
  }

  private renderSensors() {
    const selected = bindingFor(this.bindings, String(this.zone.id));
    const sensors = this.hass ? temperatureSensors(this.hass) : [];
    const filter = this.sensorSearch.toLocaleLowerCase();
    const candidates = [...sensors.filter((state) => selected.includes(state.entity_id) || `${state.entity_id} ${entityName(state, this.hass)}`.toLocaleLowerCase().includes(filter)).map((state) => state.entity_id), ...selected.filter((id) => !sensors.some((sensor) => sensor.entity_id === id))];
    return html`<section class="sensors"><h3>Aktuelle Raumtemperatur</h3>${this.loading ? html`<p class="hint" role="status">Sensorzuordnungen werden geladen …</p>` : selected.length ? selected.map((id) => html`<div class="sensor-reading"><span class="sensor-name">${entityName(this.hass?.states[id], this.hass) ?? id}<small class="sensor-id">${id}${!this.hass?.states[id] ? " · entfernt" : this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</small></span><strong>${measuredTemperatureLabel(this.hass?.states[id], this.hass)}</strong></div>`) : html`<p class="hint">Kein Sensor zugeordnet · ?</p>`}<p class="hint solar-gains">Solare Gewinne: ${this.readings(this.zone.id).solar} · Näherung nach EnEV-Annahmen.</p><p class="hint current-heat-load">Aktuelle Heizlast: ${this.readings(this.zone.id).current} · ${this.readings(this.zone.id).solarIncluded ? "Näherung mit solaren Gewinnen nach EnEV-Annahmen." : "Temperaturbasierte Näherung ohne verfügbare Solarkorrektur."}</p>
      ${this.admin && this.project ? html`<details><summary>Temperatursensoren zuordnen</summary><input class="sensor-filter" aria-label="Temperatursensor suchen" type="search" placeholder="Sensor suchen" .value=${this.sensorSearch} @input=${(event: Event) => this.sensorSearch = (event.target as HTMLInputElement).value}/><div class="sensor-select">${candidates.length ? candidates.map((id) => html`<label><input type="checkbox" .checked=${selected.includes(id)} ?disabled=${this.busy || this.conflict} @change=${(event: Event) => this.toggleSensor(id, (event.target as HTMLInputElement).checked)}/><span>${entityName(this.hass?.states[id], this.hass) ?? id}<small class="sensor-id">${id}${!this.hass?.states[id] ? " · entfernt" : this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</small></span></label>`) : html`<p class="hint">Keine vorhandenen Temperatursensoren gefunden.</p>`}</div><p class="hint">Zuordnung gilt für die gesamte Rechenzone. Mehrere Sensoren werden einzeln angezeigt.</p></details>${this.dirty ? html`<div class="actions"><button class="primary" ?disabled=${this.busy || this.conflict} @click=${() => void this.save()}>${this.busy ? "Wird gespeichert …" : "Zuordnungen speichern"}</button><button ?disabled=${this.busy} @click=${() => { this.bindings = clone(this.project?.planning_bindings ?? {}); this.notice = ""; }}>Änderungen verwerfen</button></div><p class="hint">Ungespeicherte Sensorzuordnungen</p>` : nothing}` : !this.admin ? html`<p class="hint">Ansicht mit Leserechten. Administratoren können Sensoren zuordnen.</p>` : nothing}</section>`;
  }
}

if (!customElements.get("heizlast-grundriss-card")) customElements.define("heizlast-grundriss-card", HeizlastGrundrissCard);
const registry = window as Window & { customCards?: Array<{ type: string; name: string; description: string; preview: boolean }> };
registry.customCards ??= [];
if (!registry.customCards.some((card) => card.type === "heizlast-grundriss-card")) registry.customCards.push({ type: "heizlast-grundriss-card", name: "Heizlast HA · Grundriss", description: "Grundriss von EG und OG mit belegten Heizlasten und echten Raumtemperaturen", preview: false });
