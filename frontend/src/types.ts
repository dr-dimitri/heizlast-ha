export type Point = [number, number];
export interface Room {
  id: string;
  name: string;
  polygon: Point[];
  area_m2: number | null;
}
export interface Floor {
  id: string;
  name: string;
  canvas: { width: number; height: number };
  rooms: Room[];
}
export interface Floorplan {
  schema_version: "1.1";
  floors: Floor[];
}
export interface Project {
  revision: number;
  plan: Floorplan | null;
  bindings: Record<string, string[]>;
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
    .sort((a, b) => (a.attributes.friendly_name ?? a.entity_id).localeCompare(b.attributes.friendly_name ?? b.entity_id, "de"));
}

export function temperatureLabel(state?: HassState): string {
  if (!state) return "Entität entfernt";
  if (state.state === "unknown") return "Wert unbekannt";
  if (state.state === "unavailable") return "Nicht verfügbar";
  const value = Number(state.state);
  if (!state.state.trim() || !Number.isFinite(value)) return "Ungültiger Messwert";
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value)}${state.attributes.unit_of_measurement ? ` ${state.attributes.unit_of_measurement}` : " (Einheit fehlt)"}`;
}
