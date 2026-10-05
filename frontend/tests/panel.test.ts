import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastHaCard, HeizlastHaPanel } from "../src/card";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { type HomeAssistant } from "../src/types";
async function settle(card: HeizlastGrundrissCard) { await card.updateComplete; await new Promise((resolve) => setTimeout(resolve, 0)); await card.updateComplete; }
async function mount(admin = true) {
  const callWS = vi.fn(async () => ({ revision: 0, planning_bindings: {} })); const hass = { user: { is_admin: admin }, states: {}, callWS } as unknown as HomeAssistant;
  const panel = new HeizlastHaPanel(); panel.hass = hass; document.body.append(panel); await panel.updateComplete;
  const card = panel.shadowRoot!.querySelector<HeizlastGrundrissCard>("heizlast-grundriss-card")!; await settle(card); return { panel, card, hass, callWS };
}
afterEach(() => document.body.replaceChildren());
describe("automatically registered fixed sidebar dashboard", () => {
  it("opens only the documented EG/OG floorplan without import, editor or custom-plan controls", async () => {
    const { panel, card, hass, callWS } = await mount(); expect(customElements.get("heizlast-ha-panel")).toBe(HeizlastHaPanel);
    expect(panel.shadowRoot!.querySelector("h1")!.textContent).toBe("Heizlast HA"); expect(card.hass).toBe(hass); expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "heizlast_ha/get_project" });
    expect(card.shadowRoot!.textContent).toContain("Heizlast im Grundriss"); expect(card.shadowRoot!.textContent).toContain("Erdgeschoss");
    expect(panel.shadowRoot!.querySelector('nav[aria-label="Dashboard-Ansicht"]')).toBeNull();
    expect(card.shadowRoot!.querySelector('input[type="file"],textarea,.editor,.vertex')).toBeNull();
    for (const label of ["Eigene Grundrisse", "Import", "LLM-Prompt", "Grundriss bearbeiten", "Raum hinzufügen", "Geschoss hinzufügen", "Raum teilen", "Raum löschen"]) {
      expect(`${panel.shadowRoot!.textContent} ${card.shadowRoot!.textContent}`).not.toContain(label);
    }
    expect(card.shadowRoot!.querySelectorAll(".floor-tabs button")).toHaveLength(2);
    expect(callWS).not.toHaveBeenCalledWith(expect.objectContaining({ type: "heizlast_ha/save_project" }));
  });
  it("forwards mobile navigation and HA updates without remounting the fixed planning card", async () => {
    const { panel, card, hass, callWS } = await mount(); const og = [...card.shadowRoot!.querySelectorAll<HTMLButtonElement>(".floor-tabs button")].find((button) => button.textContent!.includes("Obergeschoss"))!;
    og.click(); await settle(card); panel.narrow = true; panel.hass = { ...hass, states: { "sensor.room": { entity_id: "sensor.room", state: "22", attributes: { device_class: "temperature" } } } }; await panel.updateComplete; await settle(card);
    const menu = panel.shadowRoot!.querySelector("hass-menu-button") as HTMLElement & { hass: HomeAssistant; narrow: boolean }; expect(menu.narrow).toBe(true); expect(menu.hass).toBe(panel.hass);
    expect(panel.shadowRoot!.querySelector("heizlast-grundriss-card")).toBe(card); expect(card.hass).toBe(panel.hass); expect(og.getAttribute("aria-pressed")).toBe("true"); expect(callWS).toHaveBeenCalledTimes(1);
  });
  it("keeps existing Lovelace card configurations as an alias of the same fixed plan", async () => {
    const { hass, callWS } = await mount(); const alias = document.createElement("heizlast-ha-card") as HeizlastHaCard;
    alias.setConfig({ type: "custom:heizlast-ha-card", title: "Heizlast" }); alias.hass = hass; document.body.append(alias); await settle(alias);
    expect(customElements.get("heizlast-ha-card")).toBe(HeizlastHaCard); expect(alias).toBeInstanceOf(HeizlastGrundrissCard);
    expect(alias.shadowRoot!.querySelector("h1")!.textContent).toBe("Heizlast"); expect(alias.shadowRoot!.querySelectorAll(".room-label")).toHaveLength(8);
    expect(alias.shadowRoot!.querySelectorAll(".zone-button")).toHaveLength(5); expect(alias.shadowRoot!.querySelector('input[type="file"],textarea,.editor')).toBeNull();
    expect(alias.shadowRoot!.textContent).not.toContain("Eigene Grundrisse"); expect(customElements.get("heizlast-ha-card-editor")).toBeUndefined();
    expect(callWS).toHaveBeenCalledTimes(2); expect(HeizlastHaCard.getStubConfig()).toEqual({ type: "custom:heizlast-ha-card" });
  });
  it("shows fixed source data to normal users without assignment controls", async () => { const { card } = await mount(false); expect(card.shadowRoot!.textContent).toContain("Leserechten"); expect(card.shadowRoot!.textContent).toContain("5.989"); expect(card.shadowRoot!.querySelector('input[type="checkbox"]')).toBeNull(); });
});
