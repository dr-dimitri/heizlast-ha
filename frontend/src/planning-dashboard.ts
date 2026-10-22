import { LitElement, html, svg, nothing, type PropertyValues } from "lit";
import { planningStyles } from "./planning-styles";
import { planningData, floorLoad, floorName, polygonPoints, shapesForZone, zonesForFloor, type PlanningFloor, type PlanShape } from "./planning-types";
import { bindingFor, clone, entityName, formatNumber, measuredTemperatureLabel, outdoorTemperatureLabel, roleSensor, solarRadiationLabel, temperatureCelsius, temperatureSensors, type CardConfig, type HomeAssistant, type Project } from "./types";
import { solarGainsW } from "./heat-load";
import { heatLossW } from "./thermal-model";
import { simulateHeatingDay, estimateGasUse, CONDENSING_BOILER_EFFICIENCY, MAX_REQUIRED_SUPPLY_C, type HeatingDay, type HeatingHour, type WeatherForecast, type SimulationResult, type ZoneSimulationResult } from "./simulation-core";
import { renderHeatingChart } from "./heating-chart";
import "./energy-dashboard";

export class HeizlastGrundrissCard extends LitElement {
  static styles = planningStyles;
  static properties = {
    hass: { attribute: false }, config: { state: true }, selectedFloor: { state: true }, selectedZone: { state: true },
    project: { state: true }, bindings: { state: true }, temperatures: { state: true }, loading: { state: true }, busy: { state: true },
    error: { state: true }, conflict: { state: true }, notice: { state: true }, sensorSearch: { state: true },
    selectedView: { state: true }, forecast: { state: true }, forecastError: { state: true }, forecastLoading: { state: true }, selectedDate: { state: true }, selectedHour: { state: true },
    gasPrice: { state: true },
  };
  hass?: HomeAssistant;
  private config: CardConfig = { type: "custom:heizlast-grundriss-card" };
  private selectedFloor: PlanningFloor = "EG";
  private selectedZone = 5;
  private selectedView: "live" | "simulation" = "live";
  private forecast?: WeatherForecast;
  private forecastError = "";
  private forecastLoading = false;
  private selectedDate = "";
  private selectedHour = 0;
  private gasPrice = "";
  private forecastTimer?: ReturnType<typeof setInterval>;
  private forecastExpiry?: ReturnType<typeof setTimeout>;
  private forecastRequest = 0;
  private simulationCache?: { forecast?: WeatherForecast; date: string; temperatures: string; result: HeatingDay };
  private project?: Project;
  private bindings: Record<string, string[]> = {};
  private temperatures: Record<string, string> = {};
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
  private get dirty(): boolean { return JSON.stringify(this.bindings) !== JSON.stringify(this.project?.planning_bindings ?? {}) || JSON.stringify(this.temperatureValues) !== JSON.stringify(this.project?.planning_temperatures ?? {}) || this.invalidTemperatures; }
  private get temperatureValues(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.temperatures).filter(([, value]) => value !== "").map(([key, value]) => [key, this.simulationNumber(value)]));
  }
  private get invalidTemperatures(): boolean { return Object.values(this.temperatureValues).some((value) => !Number.isFinite(value) || value < -273.15); }
  private get gasPriceValue(): number | null { return this.gasPrice.trim() === "" ? null : this.simulationNumber(this.gasPrice.replace(",", ".")); }
  private get invalidGasPrice(): boolean { return this.gasPriceValue !== null && (!Number.isFinite(this.gasPriceValue) || this.gasPriceValue < 0); }
  private get gasPriceDirty(): boolean { return this.invalidGasPrice || this.gasPriceValue !== (this.project?.gas_price_ct_per_kwh ?? null); }
  private resetDraft(): void {
    this.bindings = clone(this.project?.planning_bindings ?? {});
    this.temperatures = Object.fromEntries(Object.entries(this.project?.planning_temperatures ?? {}).filter(([key]) => !bindingFor(this.bindings, key).length).map(([key, value]) => [key, String(value)]));
  }
  private number(value: number, decimals = 1): string { return formatNumber(value, this.hass, { maximumFractionDigits: decimals }); }
  private readings(id: number) {
    const sensors = bindingFor(this.bindings, String(id));
    const zone = planningData.zones.find((zone) => zone.id === id)!;
    const room = !this.loading && sensors.length === 1 ? this.hass?.states[sensors[0]] : undefined;
    const manual = !this.loading && !sensors.length ? this.temperatureValues[String(id)] : undefined;
    const inside = sensors.length ? temperatureCelsius(room) : manual;
    const losses = heatLossW(zone, inside, temperatureCelsius(roleSensor(this.hass, "outdoor_temperature")), planningData.building.design_outdoor_temperature_c);
    const solar = solarGainsW(zone, roleSensor(this.hass, "solar_radiation"), planningData.solar_assumptions);
    const current = losses === null ? null : Math.max(0, losses - (solar ?? 0));
    return {
      temperature: !sensors.length && typeof manual === "number" && Number.isFinite(manual) && manual >= -273.15 ? `${this.number(manual)} °C` : measuredTemperatureLabel(room, this.hass),
      currentW: current,
      indoorTemperatureC: inside,
      calculated: Number.isFinite(zone.load) ? `${this.number(zone.load)} W` : "?",
      current: current === null ? "?" : `≈ ${this.number(current, 0)} W`,
      solar: solar === null ? "?" : `≈ ${this.number(solar, 0)} W`,
      solarIncluded: losses !== null && solar !== null,
    };
  }

  private renderCurrentFloorLoad() {
    const values = zonesForFloor(this.selectedFloor).map((zone) => this.readings(zone.id).currentW);
    const known = values.filter((value): value is number => value !== null);
    const total = known.reduce((sum, value) => sum + value, 0);
    return html`<span class="floor-total current-floor-load">Summe aktuelle Heizlast ${this.selectedFloor}<strong>${known.length === values.length && Number.isFinite(total) ? this.watts(total) : "?"}</strong><small>${known.length} / ${values.length} Rechenzonen berechenbar</small></span>`;
  }

  private readingDescription(id: number): string {
    if (this.selectedView === "simulation") {
      const result = this.simulatedZone(id);
      return `Heizlast der Stunde: ${this.watts(result?.heatDemandW)} / Mögliche FBH-Leistung: ${this.watts(result?.heatingPowerW)} / Leistungsbilanz: ${result ? `${result.balanceW < 0 ? "−" : "+"}${this.watts(Math.abs(result.balanceW))}` : "?"} / ${this.balanceDescription(result)} / Solare Gewinne der Stunde: ${this.watts(result?.solarGainsW)} / Solarüberschuss der Stunde: ${this.watts(result?.solarSurplusW)}`;
    }
    const values = this.readings(id);
    return `Aktuelle Temperatur: ${values.temperature} / Berechnete Heizlast: ${values.calculated} / Aktuelle Heizlast: ${values.current}`;
  }

  private get heatingDay(): HeatingDay {
    const temperatures = Object.fromEntries(planningData.zones.map((zone) => [zone.id, this.readings(zone.id).indoorTemperatureC]));
    const key = JSON.stringify(temperatures);
    if (this.simulationCache?.forecast === this.forecast && this.simulationCache?.date === this.selectedDate && this.simulationCache?.temperatures === key) return this.simulationCache.result;
    const weather = this.forecast?.days.find((day) => day.date === this.selectedDate)?.hours ?? [];
    const result = simulateHeatingDay(planningData, weather, temperatures);
    this.simulationCache = { forecast: this.forecast, date: this.selectedDate, temperatures: key, result };
    return result;
  }
  private get hour(): HeatingHour | undefined { return this.heatingDay.hours[this.selectedHour]; }
  private get simulation(): SimulationResult {
    const hour = this.hour;
    return { valid: !!hour?.zones.length, errors: [], zones: hour?.zones ?? [], circuits: hour?.circuits ?? [], totals: null, facadeIrradiance: null, solarProfile: null };
  }
  private simulationNumber(value: string): number { return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN; }
  private simulatedZone(id: number): ZoneSimulationResult | undefined { return this.simulation.zones.find((zone) => zone.id === id); }
  private watts(value?: number | null): string { return value == null ? "?" : `≈ ${this.number(value, 0)} W`; }
  private simulationClass(id: number): string {
    if (this.selectedView !== "simulation") return "";
    const result = this.simulatedZone(id);
    return result ? result.peakDeficitW > 0.01 ? "simulated-deficit" : "simulated-covered" : "simulated-invalid";
  }
  private balanceDescription(result?: ZoneSimulationResult, compact = false): string {
    return result ? result.peakDeficitW > 0.01 ? `${compact ? "Defizit" : "Defizit bei Suchgrenze"}: ${this.watts(result.peakDeficitW)}` : "Bedarf gedeckt" : "Leistungsbilanz: ?";
  }
  private hourLabel(time: string): string {
    return new Intl.DateTimeFormat("de-DE", { timeZone: this.forecast?.timezone ?? "UTC", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(new Date(time));
  }
  private supplyLabel(hour?: HeatingHour): string {
    if (hour?.status === "off") return "Heizung aus";
    if (hour?.status === "unreachable") return "Nicht erreichbar";
    return hour?.requiredSupplyTemperatureC != null ? `≈ ${this.number(hour.requiredSupplyTemperatureC)} °C` : "?";
  }
  private async loadWeather(): Promise<void> {
    if (!this.hass || this.forecastLoading) return;
    const request = ++this.forecastRequest;
    this.forecastLoading = true;
    try {
      const forecast = await this.hass.callWS<WeatherForecast>({ type: "heizlast_ha/get_weather" });
      if (request !== this.forecastRequest || !this.isConnected) return;
      if (!Array.isArray(forecast.days) || !forecast.timezone) throw new Error("weather");
      // A stale cache never supplies a plausible-looking heating curve.
      clearTimeout(this.forecastExpiry);
      const age = forecast.fetched_at ? Date.now() - Date.parse(forecast.fetched_at) : NaN;
      this.forecast = Number.isFinite(age) && age >= 0 && age < 3600000 ? forecast
        : { ...forecast, days: forecast.days.map((day) => ({ ...day, hours: day.hours.map(({ time }) => ({ time })) })) };
      this.forecastError = Number.isFinite(age) && age >= 0 && age < 3600000 ? "" : "Keine frischen stündlichen Wetterdaten verfügbar. Der nächste Wetterabruf erfolgt automatisch.";
      if (!this.forecastError) this.forecastExpiry = setTimeout(() => {
        if (!this.forecast) return;
        this.forecast = { ...this.forecast, fetched_at: null, days: this.forecast.days.map((day) => ({ ...day, hours: day.hours.map(({ time }) => ({ time })) })) };
        this.forecastError = "Keine frischen stündlichen Wetterdaten verfügbar. Der nächste Wetterabruf erfolgt automatisch.";
      }, 3600000 - age);
      if (!forecast.days.some((day) => day.date === this.selectedDate)) {
        this.selectedDate = forecast.days[0]?.date ?? "";
        this.selectedHour = 0;
      }
    } catch {
      if (request !== this.forecastRequest) return;
      this.forecast = undefined;
      this.forecastError = "Stündliche Wetterdaten konnten nicht geladen werden.";
    } finally { if (request === this.forecastRequest) this.forecastLoading = false; }
  }
  connectedCallback(): void {
    super.connectedCallback();
    this.forecastTimer = setInterval(() => { if (this.selectedView === "simulation") void this.loadWeather(); }, 60000);
    if (this.selectedView === "simulation") void this.loadWeather();
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.forecastTimer);
    clearTimeout(this.forecastExpiry);
    this.forecastRequest++;
    this.forecastLoading = false;
  }

  private renderSimulationControls() {
    const day = this.heatingDay, hour = this.hour;
    const gas = estimateGasUse(day.heatEnergyKWh, this.gasPriceValue);
    return html`<section class="scenario" aria-label="Tagessimulation">
      <h2>Heizkurve im Tagesverlauf</h2>
      <p class="hint">Stündliche Wettervorhersage von <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · Raumtemperaturen und Gebäudedaten aus Live · Auflösung 1 Stunde.</p>
      <div class="scenario-grid"><label>Tag<select aria-label="Tag" .value=${this.selectedDate} @change=${(event: Event) => { this.selectedDate = (event.target as HTMLSelectElement).value; this.selectedHour = 0; }}>${(this.forecast?.days ?? []).map((value) => html`<option value=${value.date} .selected=${value.date === this.selectedDate}>${value.date.split("-").reverse().join(".")}</option>`)}</select></label><label>Stunde im Grundriss<select aria-label="Stunde im Grundriss" .value=${String(this.selectedHour)} @change=${(event: Event) => this.selectedHour = Number((event.target as HTMLSelectElement).value)}>${day.hours.map((value, index) => html`<option value=${index} .selected=${index === this.selectedHour}>${this.hourLabel(value.time)}</option>`)}</select></label><button @click=${() => void this.loadWeather()} ?disabled=${this.forecastLoading}>${this.forecastLoading ? "Wetterdaten laden …" : "Wetterdaten aktualisieren"}</button></div>
      <p class="hint">${this.forecast?.timezone ?? "Zeitzone aus Home Assistant"} · ${day.hours.length || "?"} Stunden im gewählten Tag. ${this.forecast?.fetched_at ? `Wetterabruf: ${this.hourLabel(this.forecast.fetched_at)}.` : ""} Tage mit Zeitumstellung haben 23 oder 25 Stunden.</p>
      ${this.forecastError ? html`<p class="notice error" role="alert">${this.forecastError}</p>` : nothing}
      ${day.missingZoneIds.length ? html`<p class="notice error" role="alert">Raumtemperatur fehlt: ${day.missingZoneIds.map((id) => `${planningData.zones.find((zone) => zone.id === id)!.name} (Zone ${id})`).join(", ")}. In Live einen gültigen Raumfühler oder eine feste Temperatur hinterlegen.</p>` : nothing}
      ${day.hours.some((value) => value.status === "missing_weather") ? html`<p class="notice" role="status">Wetterdaten fehlen für einzelne Stunden. Lücken bleiben unbekannt und werden nicht als null berechnet.</p>` : nothing}
      ${day.hours.some((value) => value.status === "unreachable") ? html`<p class="notice warning" role="status">Der Bedarf einzelner Räume ist innerhalb der Modellgrenzen nicht erreichbar. Auch bis ${MAX_REQUIRED_SUPPLY_C} °C Vorlauf wird keine ausreichende Leistung gefunden; die Oberflächengrenze bleibt wirksam. Dies ist keine Betriebsempfehlung.</p>` : nothing}
      ${day.hours.some((value) => value.status === "invalid_model") ? html`<p class="notice error" role="alert">Die gemeinsamen FBH-Planungsdaten reichen für diese Berechnung nicht aus.</p>` : nothing}
      ${renderHeatingChart(day.hours, (time) => this.hourLabel(time), this.selectedHour, (index) => this.selectedHour = index)}
      <div class="curve-summary"><span>Wärmebedarf am Tag <strong>${day.heatEnergyKWh === null ? "?" : `≈ ${this.number(day.heatEnergyKWh, 1)} kWh`}</strong></span><span>Vorlauf ${hour ? this.hourLabel(hour.time) : ""} <strong>${this.supplyLabel(hour)}</strong></span><span>Außen ${hour ? this.hourLabel(hour.time) : ""} <strong>${hour?.outdoorTemperatureC == null ? "?" : `${this.number(hour.outdoorTemperatureC)} °C`}</strong></span></div>
      <div class="gas-estimate">
        <h3>Gasverbrauch und Kosten am gewählten Tag</h3>
        <div class="curve-summary"><span>Geschätzter Gasverbrauch <strong class="gas-energy">${gas.gasEnergyKWh === null ? "?" : `≈ ${this.number(gas.gasEnergyKWh, 1)} kWh`}</strong></span><span>Gesamte Gaskosten am Tag <strong class="gas-cost">${gas.costEuro === null ? "?" : `≈ ${formatNumber(gas.costEuro, this.hass, { style: "currency", currency: "EUR" })}`}</strong></span></div>
        <label class="gas-price-label" for="gas-price">Gaspreis · Arbeitspreis (ct/kWh)</label>
        <input id="gas-price" type="text" inputmode="decimal" placeholder="Nicht hinterlegt" aria-invalid=${this.invalidGasPrice} aria-describedby="gas-price-hint" .value=${this.gasPrice} ?disabled=${!this.admin || !this.project || this.loading || this.busy || this.conflict} @input=${(event: Event) => { if (this.admin && this.project && !this.loading && !this.busy && !this.conflict) { this.gasPrice = (event.target as HTMLInputElement).value; this.notice = ""; } }}/>
        <p id="gas-price-hint" class="hint">${this.invalidGasPrice ? "Eine endliche Zahl ab 0 ct/kWh eingeben." : "Brutto-Arbeitspreis aus dem Gastarif eingeben. Ohne Preis bleiben die Kosten unbekannt."} ${this.admin ? "Der Preis wird erst beim Speichern dauerhaft in Home Assistant hinterlegt." : "Nur Administratoren können den gespeicherten Gaspreis ändern."}</p>
        ${this.admin ? html`<div class="actions"><button ?disabled=${!this.project || this.loading || this.busy || this.conflict || !this.gasPriceDirty || this.invalidGasPrice} @click=${() => void this.saveGasPrice()}>Gaspreis speichern</button><button ?disabled=${this.busy || !this.gasPriceDirty} @click=${() => this.gasPrice = String(this.project?.gas_price_ct_per_kwh ?? "")}>Gaspreis verwerfen</button></div>` : nothing}
        <p class="hint">Annahme moderne Brennwerttherme: ${CONDENSING_BOILER_EFFICIENCY * 100} % Nutzungsgrad bezogen auf den Brennwert. Gasbedarf = Wärmebedarf ÷ ${this.number(CONDENSING_BOILER_EFFICIENCY, 2)}; Tageskosten in Euro = Gasbedarf × Arbeitspreis ÷ 100. Nur Raumheizung, ohne Warmwasser, Grundpreis und Hilfsstrom. Zusätzliche Verteil- und Speicherverluste sind nicht modelliert. Bei unvollständigem Tagesbedarf bleiben Verbrauch und Kosten ?. Auch bei nicht erreichbarem Vorlauf ist dies nur der rechnerische Brennstoffbedarf zum Wärmebedarf.</p>
      </div>
      <heizlast-energy-comparison .hass=${this.hass} .project=${this.project} .day=${day} .selectedHour=${this.selectedHour} .timezone=${this.forecast?.timezone ?? "UTC"} .gasPriceCtPerKWh=${this.gasPriceValue} @energy-project-saved=${(event: CustomEvent<Project>) => this.project = event.detail}></heizlast-energy-comparison>
      <details><summary>Gemeinsame Modellgrundlage</summary><p class="hint">Planungsdaten, bestätigte Heizkreise und Solarbilanz entsprechen Live. Raumtemperaturen aus Sensoren oder festen Eingaben werden für den ganzen Tag konstant gehalten. FBH-Annahmen bleiben fest: 80 % aktive Fläche, 1,5 l/min je offenem Kreis, 6 m zusätzliche Anbindung, 0,15 m Heizstreifenbreite und 29 °C maximale Bodenoberfläche. Referenzkennlinie aus der bestehenden Kalibrierannahme bei 22 °C innen und −9 °C außen mit dem belegten Vorlauf/Rücklauf. Unbekannte Anlagenwerte bleiben Annahmen, keine Messungen.</p></details>
      <p class="hint">Der nötige gemeinsame Vorlauf richtet sich nach dem anspruchsvollsten Raum. Alle Kreise gelten als offen; Thermostatregelung und Wärmespeicherung sind nicht modelliert. Wetterwerte sind Vorhersagedaten. Die Kurve ist eine stationäre Näherung, keine Heizungssteuerung oder Raumtemperaturprognose.</p>
    </section>${this.renderSimulationMetrics()}`;
  }

  private renderSimulationMetrics() {
    const zones = this.simulation.zones.filter((zone) => zonesForFloor(this.selectedFloor).some((planningZone) => planningZone.id === zone.id));
    const total = (key: "heatDemandW" | "heatingPowerW" | "solarGainsW") => this.simulation.valid ? this.watts(zones.reduce((sum, zone) => sum + zone[key], 0)) : "?";
    return html`<section class="metrics simulation-metrics" aria-label="Stundenergebnisse">
      <div class="metric"><div class="metric-label">Heizlast ${this.selectedFloor}</div><strong>${total("heatDemandW")}</strong><p>Gewählte Stunde · nach Solarwärme</p></div>
      <div class="metric"><div class="metric-label">Mögliche FBH-Leistung ${this.selectedFloor}</div><strong>${total("heatingPowerW")}</strong><p>${this.hour?.status === "unreachable" ? "Bei 60 °C Suchgrenze" : "Beim berechneten gemeinsamen Vorlauf"}</p></div>
      <div class="metric"><div class="metric-label">Räume mit Defizit ${this.selectedFloor}</div><strong>${this.simulation.valid ? `${zones.filter((zone) => zone.peakDeficitW > 0.01).length} / ${zones.length}` : "?"}</strong><p>Gewählte Stunde · ohne Speicher</p></div>
      <div class="metric"><div class="metric-label">Solare Gewinne ${this.selectedFloor}</div><strong>${total("solarGainsW")}</strong><p>Stündliche Wetterdaten · EnEV-Faktoren</p></div>
      <div class="metric"><div class="metric-label">Nötiger Vorlauf · Wohnhaus</div><strong>${this.supplyLabel(this.hour)}</strong><p>Alle elf Rechenzonen berücksichtigt</p></div>
    </section>`;
  }

  private renderSimulationDetails() {
    const result = this.simulatedZone(this.zone.id);
    return html`<div class="detail-kicker"><span>${floorName(this.zone.floor)}</span><span>${this.hour ? this.hourLabel(this.hour.time) : "Simulation"} · Zone ${this.zone.id}</span></div><h2>${this.zone.name}</h2><div class="simulation-results">
      <div class="heat-value">${this.watts(result?.heatDemandW)}</div><p class="heat-caption">Heizlast der gewählten Stunde</p>
      <div class="loss"><span>Temperaturbezogene Verluste</span><b>${this.watts(result?.heatLossW)}</b></div><div class="loss"><span>Solare Gewinne</span><b>${this.watts(result?.solarGainsW)}</b></div><div class="loss"><span>Ungenutzter Solarüberschuss</span><b>${this.watts(result?.solarSurplusW)}</b></div><div class="loss"><span>Mögliche FBH-Leistung</span><b>${this.watts(result?.heatingPowerW)}</b></div>
      <div class="simulation-balance" role="status">${this.balanceDescription(result)}${this.hour?.status === "unreachable" ? html`<p>Leistung und Bodenoberfläche bei ${MAX_REQUIRED_SUPPLY_C} °C Suchgrenze; kein erreichbarer Vorlauf.</p>` : nothing}</div>
      <dl><div><dt>Aktive FBH-Fläche · Annahme</dt><dd>${result ? `${this.number(result.activeFloorAreaM2, 2)} m²` : "?"}</dd></div><div><dt>Höchste Bodenoberfläche</dt><dd>${result ? `${this.number(result.floorSurfaceTemperatureC)} °C` : "?"}</dd></div><div><dt>Kreisrücklauf · Mittel</dt><dd>${result && this.hour?.status !== "off" ? `${this.number(result.returnTemperatureC)} °C` : "–"}</dd></div><div><dt>Raumtemperatur aus Live</dt><dd>${this.readings(this.zone.id).temperature}</dd></div></dl>
      ${this.renderCircuitDetails()}
      <p class="hint">Mögliche Heizkapazität bei offenen Kreisen. Solarüberschüsse werden ohne Speichermodell nicht in andere Stunden übertragen.</p>
    </div>`;
  }

  private renderCircuitDetails() {
    const installation = planningData.underfloor_heating.installation;
    const own = installation.circuits.filter((circuit) => circuit.zone_id === this.zone.id);
    const calculated = this.simulation.circuits.filter((circuit) => circuit.zoneId === this.zone.id);
    const manifold = installation.manifolds.find((candidate) => candidate.floor === this.zone.floor)!;
    const manifoldName = planningData.zones.find((zone) => zone.id === manifold.zone_id)!.name;
    const result = this.simulatedZone(this.zone.id);
    return html`<details class="circuit-details"><summary>Heizkreise & Zuleitungen</summary><div class="source">
      <p>Bestätigte Rohrdimension: ${this.number(installation.pipe_outer_diameter_mm, 0)} × ${this.number(installation.pipe_wall_thickness_mm, 0)} mm. Heizkreisverteiler ${this.zone.floor}: ${manifoldName}.</p>
      <p>${own.length ? `${own.length} Heizkreis${own.length === 1 ? "" : "e"} · Raumrohrlängen: ${own.map((circuit) => `${this.number(circuit.length_m, 0)} m`).join(" / ")}.` : "Kein eigener Heizkreis. Wärme kommt ausschließlich aus den durchlaufenden Zuleitungen anderer Räume."}</p>
      ${calculated.length ? html`<ul>${calculated.map((circuit, index) => html`<li>Kreis ${index + 1}: ${this.number(circuit.roomPipeLengthM, 0)} m + ${this.number(circuit.connectionPipeLengthM, 1)} m geschätzte Anbindung = ${this.number(circuit.totalPipeLengthM, 1)} m · ≈ ${this.number(circuit.waterVolumeL, 1)} l Rohrinhalt · angenommener Durchfluss ${this.number(circuit.flowLPerMin, 1)} l/min · Rücklauf ≈ ${this.number(circuit.returnTemperatureC, 1)} °C.</li>`)}</ul>` : nothing}
      <p>Geschätzte Zuleitungslänge innerhalb dieser Zone: ${result ? `${this.number(result.connectionPipeLengthM, 1)} m` : "?"}. Rohrwasser in dieser Zone einschließlich Zuleitungen: ${result ? `≈ ${this.number(result.pipeWaterVolumeL, 1)} l` : "?"}.</p>
      <p>Die zusätzliche Hin-/Rückleitung wird je zur Hälfte vor und nach dem Raum berechnet. Kreise im Verteilerraum bleiben dort; die übrigen Anbindungen werden vereinfachend vollständig der jeweiligen Diele zugerechnet. Deren Wärme wird einmalig dort bilanziert. Die genaue Leitungsführung ist unbekannt.</p>
      <p>${planningData.sources.heating_installation.document}: ${planningData.sources.heating_installation.description} Zusätzliche Längen, Heizstreifenbreite und Durchfluss sind feste Modellannahmen. Rohrlänge allein legt keine Wärmeleistung fest; Bodenaufbau, tatsächlicher Verlegeabstand, hydraulischer Abgleich und Wärmeverluste nach unten sind nicht modelliert. Der Rohrinhalt dient keiner Aufheizzeitprognose.</p>
    </div></details>`;
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("selectedView") && this.selectedView === "simulation") void this.loadWeather();
    if (changed.has("hass") && this.selectedView === "simulation") {
      const previous = changed.get("hass") as HomeAssistant | undefined;
      if (previous?.config !== this.hass?.config) {
        this.forecastRequest++;
        this.forecastLoading = false;
        this.forecast = undefined;
        void this.loadWeather();
      }
    }
    if (changed.has("hass") && this.hass && !this.loadStarted) { this.loadStarted = true; void this.loadProject(); }
  }

  private async loadProject(): Promise<void> {
    if (!this.hass || this.busy) return;
    this.loading = true; this.error = ""; this.notice = "";
    try {
      this.project = await this.hass.callWS<Project>({ type: "heizlast_ha/get_project" });
      this.resetDraft();
      this.gasPrice = String(this.project.gas_price_ct_per_kwh ?? "");
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
    if (checked) {
      const temperatures = { ...this.temperatures };
      delete temperatures[key];
      this.temperatures = temperatures;
    }
    this.notice = "";
  }

  private setTemperature(input: HTMLInputElement): void {
    if (!this.admin || !this.project || this.busy || this.conflict || bindingFor(this.bindings, String(this.selectedZone)).length) return;
    // Keep an incomplete number invalid rather than interpreting it as a cleared field.
    this.temperatures = { ...this.temperatures, [this.selectedZone]: input.validity.badInput ? "invalid" : input.value };
    this.notice = "";
  }

  private async save(): Promise<void> {
    if (!this.hass || !this.admin || !this.project || !this.dirty || this.busy || this.conflict || this.invalidTemperatures) return;
    this.busy = true; this.error = ""; this.notice = "";
    try {
      const result = await this.hass.callWS<Project>({ type: "heizlast_ha/save_planning_bindings", revision: this.project.revision, bindings: clone(this.bindings), temperatures: this.temperatureValues });
      this.project = result; this.resetDraft();
      this.notice = "Sensorzuordnungen und feste Temperaturen in Home Assistant gespeichert.";
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      this.conflict = code === "conflict";
      this.error = this.conflict ? "Das Projekt wurde zwischenzeitlich geändert. Laden Sie die aktuellen Zuordnungen und wählen Sie Ihre Änderungen erneut aus." : code === "unauthorized" ? "Zum Speichern sind Administratorrechte erforderlich." : "Sensorzuordnungen und feste Temperaturen konnten nicht gespeichert werden. Bitte erneut versuchen.";
    } finally { this.busy = false; }
  }

  private async saveGasPrice(): Promise<void> {
    if (!this.hass || !this.admin || !this.project || !this.gasPriceDirty || this.invalidGasPrice || this.busy || this.conflict) return;
    this.busy = true; this.error = ""; this.notice = "";
    try {
      this.project = await this.hass.callWS<Project>({ type: "heizlast_ha/save_gas_price", revision: this.project.revision, gas_price_ct_per_kwh: this.gasPriceValue });
      this.gasPrice = String(this.project.gas_price_ct_per_kwh ?? "");
      this.notice = "Gaspreis in Home Assistant gespeichert.";
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      this.conflict = code === "conflict";
      this.error = this.conflict ? "Das Projekt wurde zwischenzeitlich geändert. Laden Sie die aktuellen Einstellungen und prüfen Sie den Gaspreis erneut." : code === "unauthorized" ? "Zum Speichern sind Administratorrechte erforderlich." : "Gaspreis konnte nicht gespeichert werden. Bitte erneut versuchen.";
    } finally { this.busy = false; }
  }

  protected render() {
    const floorZones = zonesForFloor(this.selectedFloor);
    return html`<article class="dashboard">
      <header class="heading"><div><div class="eyebrow">Heizlast HA · Wohnhaus</div><h1>${this.config.title ?? "Heizlast im Grundriss"}</h1><p class="subtitle">${this.selectedView === "live" ? "Raum auswählen · Planungswerte prüfen · Raumtemperaturen festlegen" : "Tag auswählen · stündliche Heizlast und nötigen Vorlauf berechnen"}</p></div><span class="chip">${this.selectedView === "live" ? "Planungsdaten" : "Simulation · Näherung"}</span></header>
      <div class="view-tabs" role="tablist" aria-label="Ansichten">${(["live", "simulation"] as const).map((view) => html`<button id=${`view-${view}`} role="tab" aria-selected=${this.selectedView === view} aria-controls="dashboard-view" tabindex=${this.selectedView === view ? 0 : -1} @click=${() => this.selectedView = view} @keydown=${(event: KeyboardEvent) => this.viewKeydown(event)}>${view === "live" ? "Live" : "Simulation"}</button>`)}</div>
      <div id="dashboard-view" role="tabpanel" aria-labelledby=${`view-${this.selectedView}`}>
      ${this.selectedView === "simulation" ? this.renderSimulationControls() : html`<section class="metrics" aria-label="Gebäude und Planung"><div class="metric"><div class="metric-label">Gebäudeheizlast</div><strong>${this.number(planningData.building.heat_load_w, 0)} <small>W</small></strong><p>Heizlastberechnung · S. ${planningData.sources.building.page} / ${planningData.sources.building.sheet}</p></div><div class="metric"><div class="metric-label">Summe der Raumheizlasten</div><strong>${this.number(planningData.room_heat_load_sum_w)} <small>W</small></strong><p>${planningData.zones.length} gemeinsame oder einzelne Rechenzonen</p></div><div class="metric"><div class="metric-label">Beheizte Nettofläche</div><strong>${this.number(planningData.building.heated_net_floor_area_m2)} <small>m²</small></strong><p>EG + OG · Flächen aus der Berechnung</p></div><div class="metric outdoor-temperature"><div class="metric-label">Außentemperatur</div><strong>${outdoorTemperatureLabel(this.hass)}</strong><p>Standort Home Assistant · <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · 30-Minuten-Abfrage</p></div><div class="metric solar-radiation"><div class="metric-label">Sonneneinstrahlung</div><strong>${solarRadiationLabel(this.hass)}</strong><p>Horizontale Globalstrahlung · Open-Meteo</p></div></section>`}
      ${this.error ? html`<div class="notice error" role="alert">${this.error}${this.conflict || !this.project ? html`<br/><button ?disabled=${this.loading || this.busy} @click=${() => void this.loadProject()}>${this.conflict ? "Aktuelle Zuordnungen laden" : "Erneut laden"}</button>` : nothing}</div>` : nothing}
      ${this.notice ? html`<div class="notice" role="status">${this.notice}</div>` : nothing}
      <div class="toolbar"><nav class="floor-tabs" aria-label="Geschosse">${(["EG", "OG"] as PlanningFloor[]).map((floor) => html`<button aria-pressed=${this.selectedFloor === floor} @click=${() => this.chooseFloor(floor)}>${floorName(floor)}</button>`)}</nav><div class="floor-totals"><span class="floor-total">Summe Normheizlasten ${this.selectedFloor}<strong>${this.number(floorLoad(this.selectedFloor))} W</strong></span>${this.selectedView === "live" ? this.renderCurrentFloorLoad() : nothing}</div></div>
      <div class="workspace"><section><div class="map-card"><div class="plan-heading"><strong>${floorName(this.selectedFloor)}</strong><span>Raumkonturen aus ${planningData.sources.plans[this.selectedFloor].document}</span></div>${this.renderPlan()}${this.selectedView === "simulation" ? html`<p class="readings-legend">Heizlast der Stunde / mögliche FBH-Leistung / Bilanz (alle W) · ≈ = Näherung · + = Reserve · − = Defizit · ? = fehlende Daten</p><div class="legend"><span><i class="dot covered"></i>Bedarf gedeckt</span><span><i class="dot deficit"></i>Defizit · ohne Speicher</span><span><i class="dot selected"></i>Ausgewählter Raum</span></div>` : html`<p class="readings-legend">Aktuelle Temperatur / berechnete Heizlast / aktuelle Heizlast · ? = Wert nicht verfügbar · ≈ = Schätzung aus Temperaturen und verfügbaren solaren Gewinnen</p><p class="readings-legend">Heizlasten gelten für die gesamte Rechenzone. Mehrere Temperatursensoren werden in den Raumdetails einzeln angezeigt; im Grundriss steht dann ?.</p><div class="legend"><span><i class="dot"></i>Raum anklicken</span><span><i class="dot selected"></i>Ausgewählte Rechenzone</span>${floorZones.some((zone) => zone.uncertain) ? html`<span><i class="dot uncertain"></i>? Zuordnung prüfen</span>` : nothing}</div>`}</div><div class="zone-heading"><span>Rechenzonen · ${floorZones.length} im ${this.selectedFloor}</span><span>${this.selectedView === "simulation" ? "Leistungsbilanz" : "Normheizlast"}</span></div><nav class="zone-list" aria-label="Rechenzonen">${floorZones.map((zone) => html`<button class="zone-button" data-zone=${zone.id} aria-label=${this.selectedView === "simulation" ? `${zone.name} auswählen · ${this.readingDescription(zone.id)}` : `${zone.name} auswählen`} aria-pressed=${zone.id === this.selectedZone} @click=${() => this.chooseZone(zone.id)}><span class="zone-number">${zone.id}</span>${zone.name}${zone.uncertain ? " ?" : ""}<span>${this.selectedView === "simulation" ? this.balanceDescription(this.simulatedZone(zone.id), true) : `${this.number(zone.load)} W`}</span></button>`)}</nav></section><aside class="details" aria-label="Details der Rechenzone">${this.selectedView === "simulation" ? this.renderSimulationDetails() : this.renderDetails()}</aside></div>
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
      <details><summary>Quellen & Zuordnung</summary><div class="source"><p>Heizlastberechnung · S. ${zone.page} / R${zone.id}. Raumübersicht: S. 4 / Z1 und S. 5 / Z2.</p><p>${planSource.document} · S. ${planSource.page} / Blatt ${planSource.sheet}: ${shapes.map((shape) => `${shape.name}${shape.area === null ? " · Planfläche unbeschriftet" : ` · ${this.number(shape.area, 2)} m²`}`).join("; ")}.</p><p>${planningData.notes.geometry}</p><p>${planningData.notes.room_sum}</p><p>Aktuelle Heizlast ≈ Normheizlast × max(0, Raumtemperatur − Außentemperatur) / (Auslegung innen − Auslegung außen). Auslegung außen: ${this.number(planningData.building.design_outdoor_temperature_c)} °C · ${planningData.sources.climate.document}, S. ${planningData.sources.climate.page} / ${planningData.sources.climate.sheet}. Davon werden verfügbare solare Gewinne abgezogen, mindestens 0 W. Interne Gewinne, wechselnde Lüftung und Wärmespeicherung werden nicht berücksichtigt.</p><p>Solare Gewinne ≈ Summe(Fensterbauteilfläche × Fassadeneinstrahlung) × ${this.number(planningData.solar_assumptions.glazing_fraction,2)} Rahmenfaktor × ${this.number(planningData.solar_assumptions.g_value,2)} g-Wert × ${this.number(planningData.solar_assumptions.shading_factor,2)} Verschattung × ${this.number(planningData.solar_assumptions.sun_protection_factor,2)} Sonnenschutz × ${this.number(planningData.solar_assumptions.incidence_factor,2)} Einfallsfaktor. ${planningData.sources.solar.document}, S. ${planningData.sources.solar.pages.join("–")} / Abschnitt ${planningData.sources.solar.section}. Diese Planungsfaktoren berücksichtigen keinen aktuellen Rollladenstatus.</p><p>${planningData.notes.solar}</p><p>Auslegungstemperaturen sind Planungswerte. Raumtemperaturen stammen aus zugeordneten Home-Assistant-Sensoren oder ausdrücklich eingegebenen festen Werten. Feste Werte sind keine Messwerte.</p></div></details>`;
  }

  private renderFixedTemperature() {
    const key = String(this.zone.id), selected = bindingFor(this.bindings, key).length > 0;
    const value = selected ? "" : this.temperatures[key] ?? "";
    const invalid = value !== "" && (!Number.isFinite(this.simulationNumber(value)) || this.simulationNumber(value) < -273.15);
    return html`<div class="fixed-temperature"><label for="fixed-temperature">Feste Raumtemperatur (°C)</label><input id="fixed-temperature" type="number" min="-273.15" step="any" placeholder="Nicht vorhanden" .value=${value} aria-invalid=${invalid} aria-describedby="fixed-temperature-hint" ?disabled=${selected || !this.admin || !this.project || this.loading || this.busy || this.conflict} @input=${(event: Event) => this.setTemperature(event.target as HTMLInputElement)}/><p id="fixed-temperature-hint" class="hint">${invalid ? "Eine gültige Temperatur ab −273,15 °C eingeben." : selected ? "Ein Temperatursensor ist zugeordnet. Der feste Wert wurde gelöscht; es gelten ausschließlich Sensorwerte." : "Optionaler fester Wert für die Heizlastschätzung, kein Messwert. Eine Sensorzuordnung löscht diesen Wert."}</p></div>`;
  }

  private renderSensors() {
    const selected = bindingFor(this.bindings, String(this.zone.id));
    const sensors = this.hass ? temperatureSensors(this.hass) : [];
    const filter = this.sensorSearch.toLocaleLowerCase();
    const candidates = [...sensors.filter((state) => selected.includes(state.entity_id) || `${state.entity_id} ${entityName(state, this.hass)}`.toLocaleLowerCase().includes(filter)).map((state) => state.entity_id), ...selected.filter((id) => !sensors.some((sensor) => sensor.entity_id === id))];
    const values = this.readings(this.zone.id);
    return html`<section class="sensors"><h3>Aktuelle Raumtemperatur</h3>${this.loading ? html`<p class="hint" role="status">Sensorzuordnungen werden geladen …</p>` : selected.length ? selected.map((id) => html`<div class="sensor-reading"><span class="sensor-name">${entityName(this.hass?.states[id], this.hass) ?? id}<small class="sensor-id">${id}${!this.hass?.states[id] ? " · entfernt" : this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</small></span><strong>${measuredTemperatureLabel(this.hass?.states[id], this.hass)}</strong></div>`) : html`<p class="hint">Kein Sensor zugeordnet · ${values.temperature}${values.temperature !== "?" ? " · fest eingegeben" : ""}</p>`}<p class="hint solar-gains">Solare Gewinne: ${this.readings(this.zone.id).solar} · Näherung nach EnEV-Annahmen.</p><p class="hint current-heat-load">Aktuelle Heizlast: ${this.readings(this.zone.id).current} · ${this.readings(this.zone.id).solarIncluded ? "Näherung mit solaren Gewinnen nach EnEV-Annahmen." : "Temperaturbasierte Näherung ohne verfügbare Solarkorrektur."}</p>
      ${this.admin && this.project ? html`<details><summary>Temperatursensoren zuordnen</summary><input class="sensor-filter" aria-label="Temperatursensor suchen" type="search" placeholder="Sensor suchen" .value=${this.sensorSearch} @input=${(event: Event) => this.sensorSearch = (event.target as HTMLInputElement).value}/><div class="sensor-select">${candidates.length ? candidates.map((id) => html`<label><input type="checkbox" .checked=${selected.includes(id)} ?disabled=${this.busy || this.conflict} @change=${(event: Event) => this.toggleSensor(id, (event.target as HTMLInputElement).checked)}/><span>${entityName(this.hass?.states[id], this.hass) ?? id}<small class="sensor-id">${id}${!this.hass?.states[id] ? " · entfernt" : this.hass.states[id].attributes.device_class !== "temperature" ? " · Geräteklasse geändert" : ""}</small></span></label>`) : html`<p class="hint">Keine vorhandenen Temperatursensoren gefunden.</p>`}</div><p class="hint">Zuordnung gilt für die gesamte Rechenzone. Mehrere Sensoren werden einzeln angezeigt.</p></details>${this.renderFixedTemperature()}${this.dirty ? html`<div class="actions"><button class="primary" ?disabled=${this.busy || this.conflict || this.invalidTemperatures} @click=${() => void this.save()}>${this.busy ? "Wird gespeichert …" : "Änderungen speichern"}</button><button ?disabled=${this.busy} @click=${() => { this.resetDraft(); this.notice = ""; }}>Änderungen verwerfen</button></div><p class="hint">Ungespeicherte Sensorzuordnungen oder feste Temperaturen</p>` : nothing}` : !this.admin ? html`${this.renderFixedTemperature()}<p class="hint">Ansicht mit Leserechten. Administratoren können Sensoren zuordnen und feste Temperaturen eingeben.</p>` : nothing}</section>`;
  }
}

if (!customElements.get("heizlast-grundriss-card")) customElements.define("heizlast-grundriss-card", HeizlastGrundrissCard);
const registry = window as Window & { customCards?: Array<{ type: string; name: string; description: string; preview: boolean }> };
registry.customCards ??= [];
if (!registry.customCards.some((card) => card.type === "heizlast-grundriss-card")) registry.customCards.push({ type: "heizlast-grundriss-card", name: "Heizlast HA · Grundriss", description: "Grundriss von EG und OG mit belegten Heizlasten und echten Raumtemperaturen", preview: false });
