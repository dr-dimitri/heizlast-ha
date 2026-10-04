import { afterEach, describe, expect, it, vi } from "vitest";
import { HeizlastHaCard, HeizlastHaPanel } from "../src/card";
import { type HomeAssistant } from "../src/types";

async function mount(admin = true) {
  const callWS = vi.fn(async () => ({ revision: 0, plan: null, bindings: {}, images: [] }));
  const hass = { user: { is_admin: admin }, states: {}, callWS } as unknown as HomeAssistant;
  const panel = new HeizlastHaPanel();
  panel.hass = hass;
  document.body.append(panel);
  await panel.updateComplete;
  const card = panel.shadowRoot!.querySelector<HeizlastHaCard>("heizlast-ha-card")!;
  await card.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await card.updateComplete;
  return { panel, card, hass, callWS };
}

afterEach(() => document.body.replaceChildren());

describe("automatically registered sidebar dashboard", () => {
  it("opens directly into the authenticated floor plan setup", async () => {
    const { panel, card, hass, callWS } = await mount();
    expect(customElements.get("heizlast-ha-panel")).toBe(HeizlastHaPanel);
    expect(panel.shadowRoot!.querySelector("h1")!.textContent).toBe("Heizlast HA");
    expect(card.hass).toBe(hass);
    expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "heizlast_ha/get_project" });
    expect(card.shadowRoot!.querySelector('input[type="file"]')).not.toBeNull();
    expect(card.shadowRoot!.textContent).toContain("Grundriss");
  });

  it("forwards mobile navigation and live updates while preserving input", async () => {
    const { panel, card, hass, callWS } = await mount();
    const input = card.shadowRoot!.querySelector<HTMLInputElement>('input[aria-label="Etagenname"]')!;
    input.value = "Dachgeschoss";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await card.updateComplete;
    panel.narrow = true;
    panel.hass = { ...hass, states: { "sensor.room": { entity_id: "sensor.room", state: "22", attributes: { device_class: "temperature" } } } };
    await panel.updateComplete;
    await card.updateComplete;
    const menu = panel.shadowRoot!.querySelector("hass-menu-button") as HTMLElement & { hass: HomeAssistant; narrow: boolean };
    expect(menu.narrow).toBe(true);
    expect(menu.hass).toBe(panel.hass);
    expect(panel.shadowRoot!.querySelector("heizlast-ha-card")).toBe(card);
    expect(card.hass).toBe(panel.hass);
    expect(input.value).toBe("Dachgeschoss");
    expect(callWS).toHaveBeenCalledTimes(1);
  });

  it("keeps the dashboard read-only for non-admin users", async () => {
    const { card } = await mount(false);
    expect(card.shadowRoot!.textContent).toContain("Administratorrechte");
    expect(card.shadowRoot!.querySelector('input[type="file"]')).toBeNull();
  });
});
