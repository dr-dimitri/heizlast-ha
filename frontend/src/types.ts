export type Point = [number, number];
export interface Project {
  revision: number;
  planning_bindings: Record<string, string[]>;
}
export interface HassState {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    device_class?: string;
    unit_of_measurement?: string;
  };
}
export interface HomeAssistant {
  states: Record<string, HassState>;
  user?: { is_admin: boolean };
  locale?: { language?: string };
  formatEntityName?(stateObj: HassState): string;
  formatEntityState?(stateObj: HassState, state?: string): string;
  callWS<T>(message: Record<string, unknown>): Promise<T>;
}
export interface CardConfig {
  type: string;
  title?: string;
}

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function bindingFor(bindings: Record<string, string[]>, id: string): string[] {
  return Object.hasOwn(bindings, id) ? bindings[id] : [];
}

export function temperatureSensors(hass: HomeAssistant): HassState[] {
  return Object.values(hass.states)
    .filter((entity) => entity.entity_id.startsWith("sensor.") && entity.attributes.device_class === "temperature")
    .sort((a, b) => (entityName(a, hass) ?? a.entity_id).localeCompare(entityName(b, hass) ?? b.entity_id, hass.locale?.language || "de"));
}

export function entityName(state?: HassState, hass?: HomeAssistant): string | undefined {
  if (!state) return undefined;
  try {
    const name = hass?.formatEntityName?.(state);
    if (name?.trim()) return name;
  } catch { /* Keep entity labels usable when a host formatter is unavailable. */ }
  return state.attributes.friendly_name?.trim() ? state.attributes.friendly_name : state.entity_id;
}

export function formatNumber(value: number, hass?: HomeAssistant, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(hass?.locale?.language || "de-DE", options).format(value);
  } catch {
    return new Intl.NumberFormat("de-DE", options).format(value);
  }
}

export function temperatureLabel(state?: HassState, hass?: HomeAssistant): string {
  if (!state) return "Entität entfernt";
  const unavailable = state.state === "unknown" || state.state === "unavailable";
  const value = Number(state.state);
  if (!unavailable && (!state.state.trim() || !Number.isFinite(value))) return "Ungültiger Messwert";
  try {
    const label = hass?.formatEntityState?.(state);
    if (label?.trim()) return `${label}${!unavailable && !state.attributes.unit_of_measurement ? " (Einheit fehlt)" : ""}`;
  } catch { /* Older hosts and the local adapter use the fallback below. */ }
  if (state.state === "unknown") return "Wert unbekannt";
  if (state.state === "unavailable") return "Nicht verfügbar";
  return `${formatNumber(value, hass, { maximumFractionDigits: 2 })}${state.attributes.unit_of_measurement ? ` ${state.attributes.unit_of_measurement}` : " (Einheit fehlt)"}`;
}
