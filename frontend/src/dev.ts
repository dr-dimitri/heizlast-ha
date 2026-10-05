/** Local preview only. Production receives authenticated Home Assistant state. */
import "./card";
import type { HeizlastHaPanel } from "./card";
import { clone, type Floorplan, type HomeAssistant, type Project } from "./types";

if (!import.meta.env.DEV) throw new Error("Development preview must not run in production.");
const storageKey = "heizlast-ha-local-preview-v3";
const params = new URLSearchParams(location.search);
const newProject = (): Project => ({ revision: 0, plan: null, bindings: {}, planning_bindings: {} });
let project: Project;
try { project = params.has("reset") ? newProject() : JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? newProject(); }
catch { project = newProject(); }
let readOnly = params.has("readonly");
const persist = () => localStorage.setItem(storageKey, JSON.stringify(project));
persist();
let hass: HomeAssistant = {
  user: { is_admin: !readOnly }, states: {},
  async callWS<T>(message: Record<string, unknown>): Promise<T> {
    if (message.type === "heizlast_ha/get_project") return clone(project) as T;
    if (readOnly) throw { code: "unauthorized" };
    if (message.revision !== project.revision) throw { code: "conflict" };
    if (message.type === "heizlast_ha/save_planning_bindings") {
      const bindings = clone(message.bindings) as Record<string, string[]>;
      if (Object.values(bindings).some((ids) => ids.length)) throw { code: "invalid_bindings" };
      project = { ...project, revision: project.revision + 1, planning_bindings: bindings };
    } else if (message.type === "heizlast_ha/save_project") {
      const plan = clone(message.plan) as Floorplan | null, bindings = clone(message.bindings) as Record<string, string[]>;
      const remaining = new Set(plan?.floors.flatMap((floor) => floor.rooms.map((room) => room.id)) ?? []);
      const removed = project.plan?.floors.flatMap((floor) => floor.rooms.map((room) => room.id)).filter((id) => !remaining.has(id)) ?? [];
      const confirmed = new Set(message.confirmed_removed_room_ids as string[] ?? []);
      if (removed.some((id) => !confirmed.has(id))) throw { code: "confirmation_required", message: "Entfernte Raum-IDs bestätigen." };
      project = { ...project, revision: project.revision + 1, plan, bindings };
    } else throw new Error("Unbekannte Vorschauanfrage.");
    persist(); return clone(project) as T;
  },
};
const panel = document.querySelector<HeizlastHaPanel>("heizlast-ha-panel")!;
panel.hass = hass;
panel.narrow = window.innerWidth < 600;
window.addEventListener("resize", () => panel.narrow = window.innerWidth < 600);
document.getElementById("reset")!.onclick = () => { project = newProject(); persist(); location.href = location.pathname; };
document.getElementById("rights")!.onclick = () => {
  readOnly = !readOnly; hass = { ...hass, user: { is_admin: !readOnly } }; panel.hass = hass;
  document.getElementById("rights")!.textContent = readOnly ? "Administratoransicht" : "Leseansicht";
};
let themeIndex = 0;
document.getElementById("theme")!.onclick = () => {
  themeIndex = (themeIndex + 1) % 3;
  document.documentElement.dataset.theme = ["light", "dark", "custom"][themeIndex];
  document.getElementById("theme")!.textContent = `Theme: ${["Hell", "Dunkel", "Eigene Farben"][themeIndex]}`;
};
window.addEventListener("storage", (event) => { if (event.key === storageKey && event.newValue) project = JSON.parse(event.newValue) as Project; });
