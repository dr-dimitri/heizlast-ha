import { html, svg } from "lit";
import type { HeatingHour } from "./simulation-core";

/** Separate labelled axes; missing/off/unreachable temperatures break the line. */
export function renderHeatingChart(hours: HeatingHour[], label: (time: string) => string,
  selected: number, select: (index: number) => void) {
  if (!hours.length) return html`<p class="hint">Für das Diagramm werden stündliche Wetterdaten benötigt.</p>`;
  const left = 64, right = 646, top = 38, bottom = 260;
  const maxLoad = Math.max(1000, Math.ceil(Math.max(...hours.map((hour) => hour.heatDemandW ?? 0)) / 1000) * 1000);
  const maxSupply = 60;
  const x = (index: number) => left + index / Math.max(1, hours.length - 1) * (right - left);
  const y = (value: number, max: number) => bottom - value / max * (bottom - top);
  const path = (field: "heatDemandW" | "requiredSupplyTemperatureC", max: number) => {
    let previous = false;
    return hours.map((hour, index) => {
      const value = hour[field];
      if (value === null) { previous = false; return ""; }
      const point = `${previous ? "L" : "M"}${x(index)},${y(value, max)}`;
      previous = true;
      return point;
    }).join(" ");
  };
  return html`<div class="heating-chart" tabindex="0" role="region" aria-label="Heizkurve: Heizlast und nötiger Vorlauf pro Stunde">
    <svg viewBox="0 0 720 316" role="img" aria-label="Stündliche Heizlast in Watt links, nötige Vorlauftemperatur in Grad Celsius rechts. Exakte Werte in der Stundentabelle.">
      <text x=${left} y="18" class="load-label">Heizlast (W)</text><text x=${right} y="18" text-anchor="end" class="supply-label">Nötiger Vorlauf (°C)</text>
      ${[0, 1, 2, 3, 4].map((step) => svg`<line class="chart-grid" x1=${left} x2=${right} y1=${y(step, 4)} y2=${y(step, 4)}/><text x=${left - 10} y=${y(step, 4) + 4} text-anchor="end">${Math.round(maxLoad * step / 4)}</text><text x=${right + 10} y=${y(step, 4) + 4}>${maxSupply * step / 4}</text>`)}
      ${hours.map((hour, index) => (index % 3 === 0 && index < hours.length - 3) || index === hours.length - 1 ? svg`<text x=${x(index)} y="283" text-anchor="middle">${label(hour.time).split(" ")[0]}</text>` : svg``)}
      <line class="chart-selection" x1=${x(selected)} x2=${x(selected)} y1=${top} y2=${bottom}/>
      <path class="load-line" d=${path("heatDemandW", maxLoad)}/><path class="supply-line" d=${path("requiredSupplyTemperatureC", maxSupply)}/>
      ${hours.map((hour, index) => svg`<g @click=${() => select(index)}><title>${label(hour.time)}: Heizlast ${hour.heatDemandW === null ? "?" : Math.round(hour.heatDemandW) + " W"}, Vorlauf ${hour.requiredSupplyTemperatureC ?? (hour.status === "off" ? "Heizung aus" : hour.status === "unreachable" ? "Nicht erreichbar" : "?")}${hour.requiredSupplyTemperatureC === null ? "" : " °C"}</title>${hour.heatDemandW !== null ? svg`<circle class="load-point" cx=${x(index)} cy=${y(hour.heatDemandW, maxLoad)} r="3"/>` : svg``}${hour.requiredSupplyTemperatureC !== null ? svg`<circle class="supply-point" cx=${x(index)} cy=${y(hour.requiredSupplyTemperatureC, maxSupply)} r="3"/>` : svg``}<rect class="chart-hit" x=${x(index) - 10} y=${top} width="20" height=${bottom - top}/></g>`)}
      <text x="355" y="309" text-anchor="middle">Stunde · Ortszeit in Home Assistant</text>
    </svg></div><p class="hint chart-legend"><span>━━ Heizlast · linke Achse</span><span>┄┄ Nötiger Vorlauf · rechte Achse</span> Lücke: unbekannt, Heizung aus oder nicht erreichbar. Stunden sind unten einzeln auswählbar.</p>`;
}
