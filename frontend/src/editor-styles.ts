import { css } from "lit";

/** The room editor follows the active Home Assistant theme and card width. */
export const editorStyles = css`
  :host {
    container-type: inline-size;
  }

  .editor {
    --editor-background: var(--primary-background-color, var(--surface));
    --editor-surface: var(--card-background-color, var(--surface));
    --editor-secondary-surface: var(--secondary-background-color, var(--soft));
    --editor-text: var(--primary-text-color, var(--ink));
    --editor-muted: var(--secondary-text-color, var(--muted));
    --editor-primary: var(--primary-color, #03a9f4);
    --editor-on-primary: var(--text-primary-color, #fff);
    --editor-border: var(--divider-color, var(--line));
    --editor-error: var(--error-color, #db4437);
    --editor-warning: var(--warning-color, #ff9800);
    --editor-selected: color-mix(
      in srgb,
      var(--editor-primary) 12%,
      var(--editor-surface)
    );
    color: var(--editor-text);
    background: var(--editor-surface);
    border-color: var(--editor-border);
    border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: var(--ha-card-box-shadow, none);
    font-size: 14px;
    line-height: 1.45;
    min-width: 0;
    text-align: start;
  }

  .editor h1,
  .editor h2,
  .editor h3 {
    color: var(--editor-text);
    font-weight: 500;
    letter-spacing: normal;
  }

  .editor h1 {
    font-size: 22px;
    margin: 0;
  }

  .editor h2 {
    font-size: 18px;
  }

  .editor h3 {
    font-size: 14px;
  }

  .editor .muted,
  .editor .hint,
  .editor .subline,
  .editor .edit-note,
  .editor .sensor-id {
    color: var(--editor-muted);
    font-size: 12px;
  }

  .editor button,
  .editor .file-button {
    color: var(--editor-text);
    border: 1px solid var(--editor-border);
    border-radius: 4px;
    background: var(--editor-surface);
    font-size: 13px;
    font-weight: 500;
    padding: 8px 12px;
    min-height: 40px;
    white-space: normal;
    text-align: center;
  }

  .editor button:hover,
  .editor .file-button:hover {
    background: var(--editor-secondary-surface);
    border-color: var(--editor-border);
  }

  .editor button.primary {
    color: var(--editor-on-primary);
    background: var(--editor-primary);
    border-color: var(--editor-primary);
  }

  .editor button.primary:hover {
    background: color-mix(
      in srgb,
      var(--editor-primary) 90%,
      var(--editor-text)
    );
    border-color: var(--editor-primary);
  }

  .editor button.danger {
    color: var(--editor-error);
  }

  .editor button:disabled,
  .editor .file-button.disabled {
    opacity: 0.5;
  }

  .editor button:focus-visible,
  .editor input:focus-visible,
  .editor select:focus-visible,
  .editor textarea:focus-visible,
  .editor .file-button:focus-within,
  .editor a:focus-visible {
    outline: 2px solid var(--editor-primary);
    outline-offset: 3px;
  }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 14px;
    padding: 22px 24px 16px;
    border-bottom: 0;
    background: var(--editor-surface);
  }

  .editor-header .subline {
    margin-top: 5px;
  }

  .editor-header .brand-icon {
    color: var(--editor-primary);
    background: var(--editor-selected);
    border-radius: 8px;
  }

  .editor-header .badge {
    color: var(--editor-muted);
    background: var(--editor-secondary-surface);
    border-radius: 4px;
    font-weight: 500;
  }

  .editor-progress {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 24px 18px;
    background: var(--editor-surface);
  }

  .editor-progress button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--editor-muted);
    border-color: transparent;
    background: transparent;
    min-height: 36px;
    padding: 5px 7px;
    font-size: 12px;
  }

  .editor-progress button[aria-current="step"],
  .editor-progress button.active {
    color: var(--editor-primary);
    background: var(--editor-selected);
  }

  .editor-progress .step-number {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--editor-muted);
    background: var(--editor-secondary-surface);
    font-size: 11px;
    font-weight: 500;
    flex: none;
  }

  .editor-progress [aria-current="step"] .step-number,
  .editor-progress .active .step-number {
    color: var(--editor-on-primary);
    background: var(--editor-primary);
  }

  .editor-progress .step-separator {
    color: var(--editor-muted);
    font-size: 12px;
  }

  .editor .toolbar {
    padding: 12px 24px;
    flex-wrap: wrap;
    border-top: 1px solid var(--editor-border);
  }

  .editor .notice {
    color: var(--editor-text);
    background: var(--editor-selected);
    border-color: color-mix(
      in srgb,
      var(--editor-primary) 25%,
      var(--editor-border)
    );
    border-radius: 4px;
    margin: 0 24px 16px;
    font-size: 13px;
  }

  .editor .notice.warning {
    color: var(--editor-text);
    background: color-mix(
      in srgb,
      var(--editor-warning) 9%,
      var(--editor-surface)
    );
    border-color: color-mix(
      in srgb,
      var(--editor-warning) 30%,
      var(--editor-border)
    );
  }

  .editor .notice.error {
    color: var(--editor-text);
    background: color-mix(
      in srgb,
      var(--editor-error) 8%,
      var(--editor-surface)
    );
    border-color: color-mix(
      in srgb,
      var(--editor-error) 40%,
      var(--editor-border)
    );
  }

  .editor-layout {
    display: grid;
    grid-template-columns: minmax(150px, 185px) minmax(0, 1fr) minmax(250px, 285px);
    border-top: 1px solid var(--editor-border);
    min-width: 0;
    align-items: stretch;
  }

  .editor .editor-rail {
    padding: 16px 10px;
    border-left: 0;
    border-right: 1px solid var(--editor-border);
    background: var(--editor-surface);
    min-width: 0;
  }

  .editor-rail-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 6px 12px;
  }

  .editor-rail-heading h2,
  .editor-rail-heading h3 {
    margin: 0;
    font-size: 14px;
  }

  .editor .editor-floor,
  .editor .editor-room {
    display: flex;
    justify-content: flex-start;
    text-align: start;
    width: 100%;
    border-color: transparent;
    background: transparent;
    overflow-wrap: anywhere;
    min-height: 40px;
  }

  .editor .editor-floor {
    padding: 9px 6px;
    font-weight: 500;
  }

  .editor .editor-floor[aria-pressed="true"] {
    color: var(--editor-primary);
  }

  .editor .editor-room {
    padding: 9px 10px 9px 23px;
    font-weight: 400;
    color: var(--editor-muted);
  }

  .editor .editor-room[aria-pressed="true"],
  .editor .editor-room.active {
    background: var(--editor-selected);
    color: var(--editor-primary);
    font-weight: 500;
  }

  .editor-floor-group + .editor-floor-group {
    margin-top: 9px;
  }

  .editor-rail-actions {
    display: grid;
    gap: 8px;
    margin-top: 18px;
  }

  .editor .editor-rail-actions button {
    justify-content: flex-start;
    background: transparent;
    color: var(--editor-primary);
  }

  .editor-canvas {
    min-width: 0;
    background: var(--editor-secondary-surface);
    display: flex;
    flex-direction: column;
  }

  .editor-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 10px;
    border-bottom: 1px solid var(--editor-border);
    background: var(--editor-surface);
  }

  .editor .editor-tool {
    min-height: 36px;
    border-color: transparent;
    background: transparent;
    color: var(--editor-muted);
    padding: 7px 9px;
    font-size: 12px;
  }

  .editor .editor-tool[aria-pressed="true"],
  .editor .editor-tool.active {
    color: var(--editor-primary);
    background: var(--editor-selected);
  }

  .editor-tools .tool-separator {
    width: 1px;
    min-height: 24px;
    background: var(--editor-border);
    margin: 0 4px;
  }

  .editor-canvas-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 15px 18px 10px;
    color: var(--editor-muted);
    font-size: 12px;
  }

  .editor .plan-area {
    padding: 18px;
    background: var(--editor-secondary-surface);
    flex: 1;
    min-width: 0;
  }

  .editor .plan-heading {
    flex-wrap: wrap;
    margin-bottom: 12px;
    color: var(--editor-muted);
  }

  .editor .plan-heading strong {
    color: var(--editor-text);
    font-weight: 500;
    font-size: 13px;
  }

  .editor .plan-frame {
    border: 1px solid var(--editor-border);
    border-radius: 4px;
    background: var(--editor-surface);
    box-shadow: none;
    min-width: 0;
  }

  .editor-canvas > .plan-frame {
    width: calc(100% - 32px);
    margin: 0 16px 16px;
  }

  .editor .plan-svg {
    color: var(--editor-text);
    background: var(--editor-surface);
    max-height: 650px;
  }

  .editor .room-shape {
    fill: color-mix(in srgb, var(--editor-text) 5%, var(--editor-surface));
    stroke: color-mix(in srgb, var(--editor-text) 50%, var(--editor-surface));
    stroke-width: 1.5;
  }

  .editor .room-shape.selected {
    fill: var(--editor-selected);
    stroke: var(--editor-primary);
    stroke-width: 2;
  }

  .editor .room-shape:hover,
  .editor .room-shape:focus-visible {
    fill: color-mix(in srgb, var(--editor-primary) 20%, var(--editor-surface));
    stroke: var(--editor-primary);
    stroke-width: 3;
  }

  .editor .room-label {
    fill: var(--editor-text);
    font-weight: 500;
  }

  .editor .label-bg {
    fill: var(--editor-surface);
    stroke: var(--editor-border);
  }

  .editor .vertex,
  .editor .draft-point,
  .editor .drawing-point {
    fill: var(--editor-surface);
    stroke: var(--editor-primary);
    vector-effect: non-scaling-stroke;
    stroke-width: 2;
  }

  .editor .draft-line,
  .editor .drawing-line,
  .editor .split-line {
    fill: none;
    stroke: var(--editor-primary);
    stroke-width: 2;
    stroke-dasharray: 6 4;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }

  .editor .drawing-preview,
  .editor .split-preview {
    fill: color-mix(in srgb, var(--editor-primary) 12%, transparent);
    stroke: var(--editor-primary);
    stroke-width: 2;
    stroke-dasharray: 6 4;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }

  .editor .grid-line {
    stroke: var(--editor-border);
    stroke-width: 0.5;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }

  .editor-canvas-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px 18px;
    color: var(--editor-muted);
    border-top: 1px solid var(--editor-border);
    background: var(--editor-surface);
    font-size: 12px;
  }

  .editor-canvas-footer label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--editor-muted);
  }

  .editor-canvas-footer label > span {
    margin: 0;
  }

  .editor .legend {
    font-size: 12px;
    gap: 12px;
    color: var(--editor-muted);
  }

  .editor .dot {
    background: color-mix(in srgb, var(--editor-text) 8%, var(--editor-surface));
    border-color: var(--editor-muted);
  }

  .editor .dot.selected {
    background: var(--editor-selected);
    border-color: var(--editor-primary);
  }

  .editor .editor-inspector {
    min-width: 0;
    padding: 20px 18px;
    background: var(--editor-surface);
    border-left: 1px solid var(--editor-border);
  }

  .editor .eyebrow {
    font-size: 11px;
    color: var(--editor-muted);
    letter-spacing: 0.5px;
    font-weight: 500;
  }

  .editor .room-title {
    font-size: 20px;
    margin-bottom: 5px;
  }

  .editor .section {
    margin-top: 20px;
    padding-top: 18px;
    border-top-color: var(--editor-border);
  }

  .editor label {
    color: var(--editor-text);
    font-size: 13px;
    font-weight: 400;
  }

  .editor input:not([type="checkbox"]):not([type="file"]),
  .editor select,
  .editor textarea {
    color: var(--editor-text);
    background: var(--editor-surface);
    border-color: var(--editor-border);
    border-radius: 4px;
    font-size: 14px;
    min-height: 42px;
    min-width: 0;
    padding: 10px;
  }

  .editor input[type="checkbox"] {
    accent-color: var(--editor-primary);
    width: 18px;
    height: 18px;
  }

  .editor .field-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .editor .sensor-select {
    gap: 4px;
  }

  .editor .sensor-select label {
    min-height: 40px;
    gap: 10px;
    border-bottom: 1px solid var(--editor-border);
  }

  .editor .sensor-select span {
    font-size: 12px;
  }

  .editor .sensor-reading {
    border-color: var(--editor-border);
    border-radius: 4px;
    background: var(--editor-secondary-surface);
    padding: 12px 10px;
  }

  .editor .sensor-reading strong {
    font-size: 18px;
    font-weight: 500;
    color: var(--editor-text);
  }

  .editor .sensor-reading strong.status,
  .editor .sensor-reading .sensor-name {
    font-size: 12px;
    color: var(--editor-muted);
  }

  .editor .points {
    font-size: 12px;
    gap: 8px;
  }

  .editor .point {
    grid-template-columns: 18px minmax(0, 1fr) minmax(0, 1fr);
    gap: 5px;
    font-size: 11px;
  }

  .editor .point input {
    font-size: 13px;
  }

  .editor .point button {
    min-width: 36px;
    min-height: 36px;
    justify-self: end;
  }

  .editor .point button:first-of-type {
    grid-column: 2;
  }

  .editor-step {
    padding: 24px;
    border-top: 1px solid var(--editor-border);
    background: var(--editor-secondary-surface);
    min-width: 0;
  }

  .editor-step-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 20px;
  }

  .editor-step-heading h2 {
    margin: 0;
  }

  .editor-step-body {
    max-width: 850px;
    min-width: 0;
  }

  .editor-step-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    padding-top: 20px;
    margin-top: 20px;
    border-top: 1px solid var(--editor-border);
  }

  .editor > .editor-step-actions {
    padding: 16px 24px;
    margin-top: 0;
  }

  .editor-source-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin: 18px 0;
    max-width: 760px;
  }

  .editor .editor-source-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 8px;
    padding: 20px;
    text-align: start;
    min-height: 128px;
    border: 1px solid var(--editor-border);
    background: var(--editor-surface);
    border-radius: 8px;
  }

  .editor .editor-source-option[aria-pressed="true"] {
    background: var(--editor-selected);
    border-color: var(--editor-primary);
  }

  .editor-source-option strong {
    font-size: 15px;
    font-weight: 500;
  }

  .editor-source-option .hint {
    margin: 0;
  }

  .editor .setup {
    padding: 22px 24px;
    background: var(--editor-secondary-surface);
    border-top-color: var(--editor-border);
  }

  .editor .empty {
    background: var(--editor-secondary-surface);
    border-top-color: var(--editor-border);
    padding: 35px 24px;
  }

  .editor .empty-symbol {
    color: var(--editor-primary);
    background: var(--editor-selected);
    border-radius: 8px;
  }

  .editor .empty-floor {
    padding: 8px 16px 16px;
    font-size: 13px;
  }

  .editor .footer { font-size: 12px; color:var(--editor-muted); border-color:var(--editor-border); }
  .editor summary { cursor:pointer; min-height:40px; color:var(--editor-text); font-size:13px; }
  .editor summary:focus-visible { outline:2px solid var(--editor-primary); outline-offset:3px; }
  .editor .split-preview.part-1 { fill:color-mix(in srgb,var(--editor-primary) 24%,transparent); stroke-dasharray:3 3; }
  .editor-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    color: var(--editor-muted);
    background: var(--editor-surface);
    border-top: 1px solid var(--editor-border);
    padding: 12px 24px;
    font-size: 12px;
  }

  @container (max-width: 940px) {
    .editor-layout {
      grid-template-columns: 165px minmax(0, 1fr);
    }
    .editor .editor-inspector {
      grid-column: 1 / -1;
      border-left: 0;
      border-top: 1px solid var(--editor-border);
    }
  }

  @container (max-width: 620px) {
    .editor-header,
    .editor-step,
    .editor .setup {
      padding: 18px 16px;
    }
    .editor-progress {
      padding: 0 12px 14px;
      gap: 4px;
    }
    .editor-progress button {
      padding: 5px;
      font-size: 11px;
    }
    .editor-progress .step-separator {
      display: none;
    }
    .editor-layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .editor .editor-rail {
      border-right: 0;
      border-bottom: 1px solid var(--editor-border);
      padding: 14px;
    }
    .editor-rail-actions {
      display: flex;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .editor-room-group {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .editor .editor-room {
      width: auto;
      padding-left: 10px;
    }
    .editor .editor-inspector {
      grid-column: auto;
      padding: 20px 16px;
    }
    .editor .plan-area {
      padding: 14px;
    }
    .editor-source-options,
    .editor .steps {
      grid-template-columns: minmax(0, 1fr);
    }
    .editor .notice {
      margin-inline: 16px;
    }
    .editor-footer {
      padding: 12px 16px;
    }
  }

  @media (pointer: coarse) {
    .editor button,
    .editor .file-button,
    .editor .editor-tool,
    .editor-progress button,
    .editor .editor-room,
    .editor .editor-floor,
    .editor .sensor-select label {
      min-height: 44px;
    }
    .editor input:not([type="checkbox"]):not([type="file"]),
    .editor select,
    .editor textarea {
      min-height: 44px;
      font-size: 16px;
    }
    .editor .point {
      grid-template-columns: 18px minmax(0, 1fr) minmax(0, 1fr);
    }
    .editor .point button {
      min-width: 44px;
      min-height: 44px;
      justify-self: end;
    }
    .editor .point input {
      min-height: 44px !important;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .editor .room-shape {
      transition: none;
    }
  }
`;
