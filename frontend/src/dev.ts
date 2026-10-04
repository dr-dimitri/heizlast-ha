/** Development harness only: not imported by the production library entry. */
import "./card";
import type { HeizlastHaCard } from "./card";
import samplePlan from "../../examples/ground-floor.json";
import { clone, type Floorplan, type HomeAssistant, type Project } from "./types";

if (!import.meta.env.DEV) throw new Error("Development harness must not run in production.");

const storageKey = "heizlast-ha-dev-v2";
const params = new URLSearchParams(location.search);
interface DevStorage { project: Project }
function newStorage(empty = false): DevStorage {
  const plan = clone(samplePlan) as Floorplan;
  return { project: { revision: 0, plan: empty ? null : plan, bindings: empty ? {} : { eg_wohnzimmer: ["sensor.wohnzimmer_temperatur", "sensor.wohnzimmer_fenster"], eg_kueche: ["sensor.kueche_temperatur"], eg_flur: ["sensor.flur_temperatur"], eg_bad: ["sensor.bad_temperatur"] } } };
}
let store: DevStorage;
try { store = params.has("reset") ? newStorage(params.has("empty")) : JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? newStorage(params.has("empty")); }
catch { store = newStorage(params.has("empty")); }
function persist(): void { localStorage.setItem(storageKey, JSON.stringify(store)); }
persist();
let readOnly = params.has("readonly");
let alternateValues = false;
const state = (entity: string, friendlyName: string, value: string, unit = "°C") => ({ entity_id: entity, state: value, attributes: { friendly_name: friendlyName, device_class: "temperature", unit_of_measurement: unit } });

let hass: HomeAssistant = {
  user: { is_admin: !readOnly },
  states: {
    "sensor.wohnzimmer_temperatur": state("sensor.wohnzimmer_temperatur", "Wohnzimmer", "21.4"),
    "sensor.wohnzimmer_fenster": state("sensor.wohnzimmer_fenster", "Wohnzimmer · Fenster", "20.8"),
    "sensor.kueche_temperatur": state("sensor.kueche_temperatur", "Küche", "22.1"),
    "sensor.flur_temperatur": state("sensor.flur_temperatur", "Flur", "19.3"),
    "sensor.bad_temperatur": state("sensor.bad_temperatur", "Bad", "23.5"),
    "sensor.aussentemperatur": state("sensor.aussentemperatur", "Außentemperatur", "12.1"),
    "sensor.fahrenheit": state("sensor.fahrenheit", "Zusätzlicher Sensor (Fahrenheit)", "70", "°F"),
  },
  async callWS<T>(message: Record<string, unknown>): Promise<T> {
    if (message.type === "heizlast_ha/get_project") return clone(store.project) as T;
    if (readOnly) throw { code: "unauthorized", message: "Administratorrechte erforderlich." };
    if (message.type === "heizlast_ha/save_project") {
      if (message.revision !== store.project.revision) throw { code: "conflict", message: "Projekt wurde geändert." };
      const plan = clone(message.plan) as Floorplan, bindings = clone(message.bindings) as Record<string, string[]>;
      const nextIds = new Set(plan.floors.flatMap((floor) => floor.rooms.map((room) => room.id)));
      const removed = store.project.plan?.floors.flatMap((floor) => floor.rooms.map((room) => room.id)).filter((id) => !nextIds.has(id)) ?? [];
      const confirmed = new Set(message.confirmed_removed_room_ids as string[] ?? []);
      if (removed.some((id) => !confirmed.has(id))) throw { code: "confirmation_required", message: "Entfernte Raum-IDs bestätigen." };
      store.project = { ...store.project, revision: store.project.revision + 1, plan, bindings }; persist(); return clone(store.project) as T;
    }
    throw new Error(`Nicht unterstützte Testanfrage: ${message.type}`);
  },
};
const card = document.querySelector<HeizlastHaCard>("heizlast-ha-card")!;
card.setConfig({ type: "custom:heizlast-ha-card", title: "Mein Zuhause" });
card.hass = hass;
document.getElementById("reset")!.onclick = () => { store = newStorage(true); persist(); location.href = location.pathname; };
document.getElementById("demo")!.onclick = () => { store = newStorage(); persist(); location.href = location.pathname; };
document.getElementById("rights")!.onclick = () => { readOnly = !readOnly; hass = { ...hass, user: { is_admin: !readOnly } }; card.hass = hass; document.getElementById("rights")!.textContent = readOnly ? "Administratorrechte testen" : "Leserechte testen"; };
document.getElementById("values")!.onclick = () => {
  alternateValues = !alternateValues;
  hass = { ...hass, states: { ...hass.states, "sensor.wohnzimmer_temperatur": state("sensor.wohnzimmer_temperatur", "Wohnzimmer", alternateValues ? "unknown" : "21.4"), "sensor.wohnzimmer_fenster": state("sensor.wohnzimmer_fenster", "Wohnzimmer · Fenster", alternateValues ? "unavailable" : "20.8") } };
  card.hass = hass;
};
window.addEventListener("storage", (event) => { if (event.key === storageKey && event.newValue) store = JSON.parse(event.newValue) as DevStorage; });
