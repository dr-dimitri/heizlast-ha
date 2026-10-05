import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastHaCard, HeizlastHaPanel } from "../src/card";
import { HeizlastGrundrissCard } from "../src/planning-dashboard";
import { type HomeAssistant } from "../src/types";
async function settle(card: HeizlastGrundrissCard | HeizlastHaCard) { await card.updateComplete; await new Promise((resolve) => setTimeout(resolve, 0)); await card.updateComplete; }
async function mount(admin = true) {
  const callWS = vi.fn(async () => ({ revision: 0, plan: null, bindings: {} })); const hass = { user: { is_admin: admin }, states: {}, callWS } as unknown as HomeAssistant;
  const panel = new HeizlastHaPanel(); panel.hass = hass; document.body.append(panel); await panel.updateComplete;
  const card = panel.shadowRoot!.querySelector<HeizlastGrundrissCard>("heizlast-grundriss-card")!; await settle(card); return { panel, card, hass, callWS };
}
afterEach(() => document.body.replaceChildren());
describe("automatically registered sidebar dashboard", () => {
  it("opens the documented heatload plan by default without replacing user plans", async () => {
    const { panel, card, hass, callWS } = await mount(); expect(customElements.get("heizlast-ha-panel")).toBe(HeizlastHaPanel);
    expect(panel.shadowRoot!.querySelector("h1")!.textContent).toBe("Heizlast HA"); expect(card.hass).toBe(hass); expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "heizlast_ha/get_project" });
    expect(card.shadowRoot!.textContent).toContain("Heizlast im Grundriss"); expect(card.shadowRoot!.textContent).toContain("Erdgeschoss"); expect(card.shadowRoot!.querySelector('input[type="file"]')).toBeNull();
    expect(panel.shadowRoot!.textContent).toContain("Eigene Grundrisse"); expect(panel.shadowRoot!.querySelector("heizlast-ha-card")).toBeNull(); expect(callWS).not.toHaveBeenCalledWith(expect.objectContaining({ type: "heizlast_ha/save_project" }));
  });
  it("forwards mobile navigation and HA updates without remounting the planning card", async () => {
    const { panel, card, hass, callWS } = await mount(); const og = [...card.shadowRoot!.querySelectorAll<HTMLButtonElement>(".floor-tabs button")].find((button) => button.textContent!.includes("Obergeschoss"))!;
    og.click(); await settle(card); panel.narrow = true; panel.hass = { ...hass, states: { "sensor.room": { entity_id: "sensor.room", state: "22", attributes: { device_class: "temperature" } } } }; await panel.updateComplete; await settle(card);
    const menu = panel.shadowRoot!.querySelector("hass-menu-button") as HTMLElement & { hass: HomeAssistant; narrow: boolean }; expect(menu.narrow).toBe(true); expect(menu.hass).toBe(panel.hass);
    expect(panel.shadowRoot!.querySelector("heizlast-grundriss-card")).toBe(card); expect(card.hass).toBe(panel.hass); expect(og.getAttribute("aria-pressed")).toBe("true"); expect(callWS).toHaveBeenCalledTimes(1);
  });
  it("retains drawing/import setup and unsaved input when switching modes", async () => {
    const { panel, card, hass, callWS } = await mount(); const buttons = panel.shadowRoot!.querySelectorAll<HTMLButtonElement>("nav button"); buttons[1].click(); await panel.updateComplete;
    const legacy = panel.shadowRoot!.querySelector<HeizlastHaCard>("heizlast-ha-card")!; await settle(legacy); expect(legacy.hass).toBe(hass); expect(legacy.shadowRoot!.querySelector('input[type="file"]')).not.toBeNull();
    const input = legacy.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Etagenname"]')!; input.value = "Etage"; input.dispatchEvent(new Event("input", { bubbles: true })); await settle(legacy);
    buttons[0].click(); await panel.updateComplete; buttons[1].click(); await panel.updateComplete; expect(panel.shadowRoot!.querySelector("heizlast-ha-card")).toBe(legacy); expect(input.value).toBe("Etage"); expect(panel.shadowRoot!.querySelector("heizlast-grundriss-card")).toBe(card); expect(callWS).toHaveBeenCalledTimes(2);
  });
  it("shows source planning data to normal users without assignment controls", async () => { const { card } = await mount(false); expect(card.shadowRoot!.textContent).toContain("Leserechten"); expect(card.shadowRoot!.textContent).toContain("5.989"); expect(card.shadowRoot!.querySelector('input[type="checkbox"]')).toBeNull(); });
});
