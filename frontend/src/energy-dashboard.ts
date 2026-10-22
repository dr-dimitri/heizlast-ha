import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { clone, entityName, formatNumber, type EnergySettings, type HomeAssistant, type Project } from "./types";
import { estimateGasUse, type HeatingDay } from "./simulation-core";
import { estimateHeatPumpDay } from "./heat-pump";
import { compareHeatingElectricity, priceCtPerKWh, tariffIntervalsForHours } from "./energy-comparison";

type Source = { entity_id: string; config_entry_id: string };
type Sources = { pv_forecast: Source[]; electricity_price: Source[]; feed_in_tariff: Source[] };
type PvForecast = { intervals: { start: string; end: string; energy_kwh: number | null }[]; fetched_at: string | null; expires_at?: string | null; status: string; reason?: string | null };
type TariffSlot = { start: string; end: string; price_ct_kwh: number };
const defaults = (): EnergySettings => ({ heat_generator: "gas", pv_forecast_entity_id: null, electricity_price_entity_id: null, feed_in_tariff_entity_id: null });

export class HeizlastEnergyComparison extends LitElement {
  static properties = {
    hass: { attribute: false }, project: { attribute: false }, day: { attribute: false }, selectedHour: { attribute: false }, timezone: {}, gasPriceCtPerKWh: { attribute: false },
    settings: { state: true }, sources: { state: true }, pv: { state: true }, dynamicSlots: { state: true },
    busy: { state: true }, loading: { state: true }, conflict: { state: true }, error: { state: true }, sourceError: { state: true }, notice: { state: true },
  };
  static styles = css`
    :host { display:block; margin-top:22px; border-top:1px solid var(--divider-color,#ddd); padding-top:18px; }
    h3 { font-size:16px; margin:0 0 12px; } p { line-height:1.6; font-size:12px; }
    .hint { color:var(--secondary-text-color,#666); } .error { color:var(--error-color,#b3261e); }
    .fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    label { display:flex; flex-direction:column; gap:7px; font-size:12px; }
    select,button { font:inherit; color:inherit; background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#ccc); border-radius:8px; padding:10px; }
    select { width:100%; min-width:0; } button { cursor:pointer; } :disabled { opacity:.6; cursor:default; }
    .actions { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
    .comparison { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:18px 0; }
    .result { border:1px solid var(--divider-color,#ddd); border-radius:10px; padding:14px; }
    .result strong { display:block; font-size:23px; margin:8px 0; } .result span { font-size:12px; }
    .details { display:flex; flex-wrap:wrap; gap:12px 24px; font-size:13px; margin:12px 0; }
    @media(max-width:600px) { .fields,.comparison { grid-template-columns:1fr; } }
  `;
  hass?: HomeAssistant;
  project?: Project;
  day: HeatingDay = { hours: [], heatEnergyKWh: null, missingZoneIds: [] };
  timezone = "UTC";
  selectedHour = 0;
  gasPriceCtPerKWh: number | null = null;
  private settings = defaults();
  private sources: Sources = { pv_forecast: [], electricity_price: [], feed_in_tariff: [] };
  private pv: PvForecast | null = null;
  private dynamicSlots: TariffSlot[] = [];
  private busy = false;
  private loading = false;
  private conflict = false;
  private error = "";
  private sourceError = "";
  private notice = "";
  private sourcesLoaded = false;
  private request = 0;
  private sourceRequest = 0;
  private contextKey = "";
  private timer?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private get admin() { return this.hass?.user?.is_admin === true; }
  private get dirty() { return JSON.stringify(this.settings) !== JSON.stringify(this.project?.energy_settings ?? defaults()); }
  private get disabled() { return !this.admin || !this.project || this.busy || this.conflict; }
  private get pumpSelected() { return this.settings.heat_generator === "bosch_aw5800_5"; }

  connectedCallback() {
    super.connectedCallback();
    this.timer = setInterval(() => { if (this.pumpSelected) void this.loadContext(); }, 60000);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.timer); clearTimeout(this.expiry); this.request++; this.sourceRequest++;
    this.sourcesLoaded = false; this.contextKey = "";
  }
  protected willUpdate(changed: PropertyValues) {
    if (changed.has("project")) {
      const old = changed.get("project") as Project | undefined;
      if (!old || JSON.stringify(this.settings) === JSON.stringify(old.energy_settings ?? defaults())) {
        this.settings = clone(this.project?.energy_settings ?? defaults());
      }
    }
  }
  protected updated() {
    if (!this.pumpSelected) return;
    if (!this.sourcesLoaded) { this.sourcesLoaded = true; void this.loadSources(); }
    const key = JSON.stringify([this.settings.pv_forecast_entity_id, this.settings.electricity_price_entity_id, this.day.hours.map((hour) => hour.time), this.hass?.states[this.settings.electricity_price_entity_id ?? ""]?.attributes, this.hass?.states[this.settings.pv_forecast_entity_id ?? ""], this.timezone]);
    if (key !== this.contextKey) { this.contextKey = key; void this.loadContext(); }
  }
  private async loadSources() {
    if (!this.hass) return;
    const request = ++this.sourceRequest;
    try {
      const sources = await this.hass.callWS<Sources>({ type: "heizlast_ha/get_energy_sources" });
      if (request !== this.sourceRequest || !this.isConnected) return;
      if (![sources.pv_forecast, sources.electricity_price, sources.feed_in_tariff].every(Array.isArray)) throw new Error("sources");
      this.sources = sources;
      this.contextKey = "";
    } catch { if (request === this.sourceRequest) this.sourceError = "Energiequellen konnten nicht geladen werden. Quellen erneut laden."; }
  }
  private dateAt(time: string | number): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: this.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time));
    return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
  }
  private async loadContext() {
    const request = ++this.request;
    clearTimeout(this.expiry); this.pv = null; this.dynamicSlots = []; this.sourceError = ""; this.loading = false;
    if (!this.hass || !this.day.hours.length) return;
    this.loading = true;
    const start = this.day.hours[0].time;
    const end = new Date(Date.parse(this.day.hours.at(-1)!.time) + 3600000).toISOString();
    const tasks: Promise<void>[] = [];
    if (this.settings.pv_forecast_entity_id) tasks.push((async () => {
      try {
        const pv = await this.hass!.callWS<PvForecast>({ type: "heizlast_ha/get_energy_forecast", pv_forecast_entity_id: this.settings.pv_forecast_entity_id, start, end });
        if (request !== this.request || !this.isConnected) return;
        this.pv = pv;
        if (pv.expires_at) {
          const delay = Date.parse(pv.expires_at) - Date.now();
          if (delay > 0) this.expiry = setTimeout(() => { this.pv = null; }, Math.min(delay, 2147483647));
          else this.pv = null;
        }
      } catch { if (request === this.request) this.sourceError = "PV-Stundenprognose konnte nicht gelesen werden. Quellen erneut laden."; }
    })());
    const importId = this.settings.electricity_price_entity_id;
    if (this.hass.states[importId ?? ""]?.attributes.tariff_type === "dynamic") tasks.push((async () => {
      const source = this.sources.electricity_price.find((item) => item.entity_id === importId);
      const date = this.dateAt(start), today = this.dateAt(Date.now());
      const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
      if (!source || (date !== today && date !== tomorrow)) return;
      try {
        const series = await this.hass!.callWS<{ slots: TariffSlot[]; date: string; status: string }>({ type: "sax_power/dashboard/tariff/series", entry_id: source.config_entry_id, day: date === today ? "today" : "tomorrow" });
        if (request === this.request && this.isConnected && series.date === date && ["available", "partial"].includes(series.status) && Array.isArray(series.slots)) this.dynamicSlots = series.slots;
      } catch { if (request === this.request) this.sourceError = "Dynamische Tarifzeiten konnten nicht gelesen werden. Quellen erneut laden."; }
    })());
    await Promise.allSettled(tasks);
    if (request === this.request) this.loading = false;
  }
  private edit(key: keyof EnergySettings, value: string) {
    if (this.disabled) return;
    this.settings = { ...this.settings, [key]: value || null }; this.notice = "";
  }
  private async save() {
    if (!this.hass || this.disabled || !this.dirty) return;
    this.busy = true; this.error = ""; this.notice = "";
    try {
      const project = await this.hass.callWS<Project>({ type: "heizlast_ha/save_energy_settings", revision: this.project!.revision, settings: clone(this.settings) });
      this.settings = clone(project.energy_settings ?? defaults()); this.project = project;
      this.dispatchEvent(new CustomEvent<Project>("energy-project-saved", { detail: project, bubbles: true, composed: true }));
      this.notice = "Wärmeerzeuger und Energiequellen in Home Assistant gespeichert.";
    } catch (error) {
      this.conflict = typeof error === "object" && error !== null && "code" in error && error.code === "conflict";
      this.error = this.conflict ? "Das Projekt wurde zwischenzeitlich geändert. Einstellungen neu laden und erneut prüfen." : "Energieeinstellungen konnten nicht gespeichert werden. Bitte erneut versuchen.";
    } finally { this.busy = false; }
  }
  private async reload() {
    if (!this.hass || this.busy) return;
    this.busy = true;
    try {
      const project = await this.hass.callWS<Project>({ type: "heizlast_ha/get_project" });
      this.settings = clone(project.energy_settings ?? defaults()); this.project = project; this.conflict = false; this.error = "";
      this.dispatchEvent(new CustomEvent<Project>("energy-project-saved", { detail: project, bubbles: true, composed: true }));
    } catch { this.error = "Einstellungen konnten nicht geladen werden."; }
    finally { this.busy = false; }
  }
  private sensorSelect(key: Exclude<keyof EnergySettings, "heat_generator">, sourceKey: keyof Sources, label: string) {
    const selected = this.settings[key];
    const ids = this.sources[sourceKey].map((source) => source.entity_id);
    if (selected && !ids.includes(selected)) ids.push(selected);
    return html`<label>${label}<select aria-label=${label} .value=${selected ?? ""} ?disabled=${this.disabled} @change=${(event: Event) => this.edit(key, (event.target as HTMLSelectElement).value)}><option value="">Nicht zugeordnet</option>${ids.map((id) => html`<option value=${id} .selected=${id === selected}>${entityName(this.hass?.states[id], this.hass) ?? id}${!this.hass?.states[id] ? " · nicht verfügbar" : ""}</option>`)}</select></label>`;
  }
  private energy(value: number | null) { return value === null ? "?" : `≈ ${formatNumber(value, this.hass, { maximumFractionDigits: 2 })} kWh`; }
  private money(value: number | null) { return value === null ? "?" : `≈ ${formatNumber(value, this.hass, { style: "currency", currency: "EUR" })}`; }
  protected render() {
    const pump = this.pumpSelected ? estimateHeatPumpDay(this.day) : null;
    const importState = this.hass?.states[this.settings.electricity_price_entity_id ?? ""];
    const feedIn = priceCtPerKWh(this.hass?.states[this.settings.feed_in_tariff_entity_id ?? ""]);
    const prices = tariffIntervalsForHours(this.day.hours, importState, this.timezone, this.dynamicSlots);
    const comparison = pump ? compareHeatingElectricity(pump.hours, prices, this.pv?.intervals ?? null, feedIn) : null;
    const gas = estimateGasUse(this.day.heatEnergyKWh, this.gasPriceCtPerKWh);
    const saving = comparison?.totalCostEuro != null && gas.costEuro !== null ? gas.costEuro - comparison.totalCostEuro : null;
    const hour = pump?.hours[this.selectedHour];
    const status = hour ? ({ covered: "Bedarf gedeckt", off: "Heizung aus", capacity_limited: "Heizleistung reicht nicht aus", missing_data: "Heiz- oder Wetterdaten fehlen", unreachable: "FBH-Vorlauf nicht erreichbar", outside_model: "Außerhalb des belegten Modellbereichs" } as const)[hour.status] : "?";
    return html`<section aria-label="Wärmeerzeuger und Kostenvergleich"><h3>Wärmeerzeuger und Kostenvergleich</h3><p class="hint">Verbrauch und Kosten beziehen sich auf den Gebäudewärmebedarf für Raumheizung. Die höhere Raumlastsumme dient der FBH-Auslegung; deren konservativer Vorlauf bleibt Grundlage des Wärmepumpen-COP.</p>
      <div class="fields"><label>Wärmeerzeuger<select aria-label="Wärmeerzeuger" .value=${this.settings.heat_generator} ?disabled=${this.disabled} @change=${(event: Event) => this.edit("heat_generator", (event.target as HTMLSelectElement).value)}><option value="gas" .selected=${!this.pumpSelected}>Gas · Brennwerttherme</option><option value="bosch_aw5800_5" .selected=${this.pumpSelected}>Wärmepumpe · Bosch Compress 5800i AW 5 OR-S · 5-kW-Klasse</option></select></label>
      ${this.pumpSelected ? html`${this.sensorSelect("pv_forecast_entity_id", "pv_forecast", "PV-Vorhersage · pv-forecast-ha")}${this.sensorSelect("electricity_price_entity_id", "electricity_price", "Strompreis und Tarifzeiten · sax-ha")}${this.sensorSelect("feed_in_tariff_entity_id", "feed_in_tariff", "Einspeisevergütung · sax-ha")}` : nothing}</div>
      ${this.admin && this.dirty ? html`<div class="actions"><button ?disabled=${this.disabled} @click=${() => void this.save()}>Energieeinstellungen speichern</button><button ?disabled=${this.busy} @click=${() => { this.settings = clone(this.project?.energy_settings ?? defaults()); this.notice = ""; }}>Energieeinstellungen verwerfen</button></div><p class="hint">Vorschau mit ungespeicherten Energieeinstellungen.</p>` : nothing}
      ${!this.admin ? html`<p class="hint">Ansicht mit Leserechten. Administratoren speichern Wärmeerzeuger und Sensorzuordnungen.</p>` : nothing}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>${this.conflict ? html`<button ?disabled=${this.busy} @click=${() => void this.reload()}>Energieeinstellungen neu laden</button>` : nothing}` : nothing}
      ${this.notice ? html`<p role="status">${this.notice}</p>` : nothing}
      ${comparison && pump ? html`<div class="comparison"><div class="result"><span>Gas · Raumheizung</span><strong class="comparison-gas-cost">${this.money(gas.costEuro)}</strong><span>${this.energy(gas.gasEnergyKWh)} Gas</span></div><div class="result"><span>Wärmepumpe · nur Netzstrom</span><strong class="grid-only-cost">${this.money(comparison.gridOnlyCostEuro)}</strong><span>${this.energy(comparison.electricityKWh)} Strom</span></div><div class="result"><span>Wärmepumpe · Netz + PV</span><strong class="heat-pump-cost">${this.money(comparison.totalCostEuro)}</strong><span>einschließlich entgangener Einspeisevergütung</span></div></div>
      <div class="details"><span>Netzbezug: <b class="grid-energy">${this.energy(comparison.gridElectricityKWh)}</b></span><span>PV für Wärmepumpe: <b class="pv-energy">${this.energy(comparison.pvElectricityKWh)}</b></span><span>Netzkosten: <b>${this.money(comparison.gridCostEuro)}</b></span><span>Entgangene Einspeisung: <b>${this.money(comparison.pvOpportunityCostEuro)}</b></span><span>Differenz Gas − Wärmepumpe mit PV: <b class="cost-saving">${this.money(saving)}</b></span></div>
      <p class="hour-status" role="status">Gewählte Stunde: ${status} · COP ${hour?.cop == null ? "?" : `≈ ${formatNumber(hour.cop, this.hass, { maximumFractionDigits: 2 })}`} · Strom ${this.energy(hour?.electricityKWh ?? null)} · verfügbare Heizleistung ${hour?.maxThermalPowerW == null ? "?" : `≈ ${formatNumber(hour.maxThermalPowerW / 1000, this.hass, { maximumFractionDigits: 2 })} kW`}${hour?.deficitW ? ` · ungedeckter Bedarf ≈ ${formatNumber(hour.deficitW, this.hass, { maximumFractionDigits: 0 })} W` : ""}.</p>
      <p class="hint">Positiver Differenzbetrag bedeutet geringere Wärmepumpenkosten. Preise und Tarifzeiten stammen aus sax-ha; Zeitbezug ${this.timezone}. Dynamische Preise stehen nur für heute und morgen zur Verfügung; weitere Tage bleiben ohne belegte Preise unbekannt.</p>
      <p class="hint">PV-Stunden aus dem lokalen Cache von pv-forecast-ha. PV-Nutzung ist eine Obergrenze: Andere Haushaltsverbraucher, Batterie, Speicher und Lastverschiebung werden nicht berücksichtigt. Gleichmäßige Leistung innerhalb der Prognoseintervalle ist eine Annahme. Keine Übertragung von PV-Energie zwischen Stunden. Fehlende Prognosen oder Tarife ergeben ?.</p>
      <p class="hint">Bosch Compress 5800i AW 5 OR-S: konservative Näherung aus Hersteller-Prüfpunkten mit angenommener linearer Vorlaufkorrektur aus A7/W35 und A7/W55, kein vollständiges Teillastkennfeld und keine Verbrauchsmessung. Unter −7 °C fehlen tabellarische Modellpunkte; dort bleibt der Strombedarf unbekannt. Über +7 °C außen werden die +7-°C-Werte bis +45 °C konstant gehalten. Vorlaufbereich 20–60 °C. Keine automatische Heizstab- oder Gasergänzung. Nur Raumheizung, ohne Warmwasser, Grundpreise und zusätzliche Hilfsenergie. <a href="https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721891866" target="_blank" rel="noopener noreferrer">Bosch-Planungsunterlage, Tabelle 29</a>.</p>
      ${pump.incompleteHours ? html`<p class="error" role="status">Wärmepumpenbedarf für ${pump.incompleteHours} Stunde(n) unbekannt oder nicht gedeckt. Tagesstrom und Tageskosten bleiben unbekannt.</p>` : nothing}
      <p class="hint">${this.loading ? "Energiequellen werden gelesen …" : "Energiequellen werden während der Ansicht jede Minute gelesen."}</p>${this.sourceError ? html`<p class="error" role="alert">${this.sourceError}</p>` : nothing}<button ?disabled=${this.loading} @click=${() => { this.sourcesLoaded = false; void this.loadContext(); }}>Quellen erneut laden</button>` : nothing}
    </section>`;
  }
}
if (!customElements.get("heizlast-energy-comparison")) customElements.define("heizlast-energy-comparison", HeizlastEnergyComparison);
