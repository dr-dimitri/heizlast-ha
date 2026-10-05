import { LitElement, css, html } from "lit";
import { HeizlastGrundrissCard } from "./planning-dashboard";
import type { CardConfig, HomeAssistant } from "./types";

/** Compatibility name for existing Lovelace configurations. */
export class HeizlastHaCard extends HeizlastGrundrissCard {
  static getStubConfig(): CardConfig { return { type: "custom:heizlast-ha-card" }; }
}

/** The sidebar displays the fixed EG/OG plan with authenticated sensor state. */
export class HeizlastHaPanel extends LitElement {
  static properties = { hass: { attribute: false }, narrow: { type: Boolean } };
  static styles = css`
    :host { display: block; height: 100%; overflow: auto; background: var(--primary-background-color); color: var(--primary-text-color); }
    header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; height: var(--header-height, 56px); padding: 0 16px; background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, white); }
    h1 { margin: 0 0 0 16px; font-size: 20px; font-weight: 400; }
    main { max-width: 1600px; margin: 0 auto; padding: 24px; }
    @media (max-width: 600px) { main { padding: 12px; } }
  `;
  hass?: HomeAssistant;
  narrow = false;

  protected render() {
    return html`<header><hass-menu-button .hass=${this.hass} .narrow=${this.narrow}></hass-menu-button><h1>Heizlast HA</h1></header><main><heizlast-grundriss-card .hass=${this.hass}></heizlast-grundriss-card></main>`;
  }
}

if (!customElements.get("heizlast-ha-card")) customElements.define("heizlast-ha-card", HeizlastHaCard);
if (!customElements.get("heizlast-ha-panel")) customElements.define("heizlast-ha-panel", HeizlastHaPanel);
