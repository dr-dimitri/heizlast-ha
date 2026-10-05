import { css } from "lit";

export const planningStyles = css`
  :host { display:block; color:var(--primary-text-color,#18303e); --accent:var(--primary-color,#007fa8); --surface:var(--ha-card-background,var(--card-background-color,#fff)); --muted:var(--secondary-text-color,#657784); --line:var(--divider-color,#dbe4e9); --subtle:var(--secondary-background-color,#f2f6f8); font-family:var(--paper-font-body1_-_font-family,system-ui,sans-serif); }
  * { box-sizing:border-box; }
  button,input,select { font:inherit; }
  button { cursor:pointer; border:1px solid var(--line); background:var(--surface); color:var(--primary-text-color); border-radius:10px; padding:10px 14px; }
  button:hover { border-color:var(--accent); }
  button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible { outline:3px solid var(--accent); outline-offset:3px; }
  button:disabled { cursor:wait; opacity:.55; }
  .dashboard { padding:24px; border:1px solid var(--line); background:var(--surface); border-radius:var(--ha-card-border-radius,18px); }
  .heading,.plan-heading,.zone-heading,.detail-kicker { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .eyebrow { color:var(--accent); font-size:11px; letter-spacing:1.6px; text-transform:uppercase; font-weight:700; }
  h1 { font-size:28px; letter-spacing:-.8px; line-height:1.2; margin:7px 0; font-weight:650; }
  .subtitle,.hint,.muted,.source { color:var(--muted); font-size:12px; line-height:1.6; }
  p { margin:6px 0; }
  .chip { border:1px solid var(--line); border-radius:24px; padding:7px 11px; font-size:11px; white-space:nowrap; color:var(--muted); }
  .view-tabs { display:flex; gap:6px; margin:18px 0; border-bottom:1px solid var(--line); padding-bottom:10px; }
  .view-tabs button { min-width:110px; font-weight:600; }
  .view-tabs button[aria-selected=true] { border-color:var(--accent); color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,var(--surface)); }
  .metrics { margin:24px 0 22px; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; }
  .metric { padding:16px 18px; border:1px solid var(--line); border-radius:13px; background:var(--subtle); }
  .metric-label { font-size:11px; color:var(--muted); }
  .metric strong { display:block; margin:7px 0 4px; font-size:27px; font-weight:650; font-variant-numeric:tabular-nums; letter-spacing:-.6px; }
  .metric strong small { font-size:14px; font-weight:400; color:var(--muted); }
  .metric p { font-size:11px; color:var(--muted); }
  .metric a { color:var(--accent); }
  .simulation-metrics { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .simulation-metrics .metric strong { font-size:22px; }
  .toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:16px; }
  .floor-tabs { display:flex; background:var(--subtle); border:1px solid var(--line); border-radius:12px; padding:4px; gap:4px; }
  .floor-tabs button { border-color:transparent; background:transparent; color:var(--muted); padding:9px 17px; }
  .floor-tabs button[aria-pressed=true] { background:var(--surface); color:var(--accent); border-color:var(--line); font-weight:650; }
  .floor-total { font-size:12px; color:var(--muted); }
  .floor-total strong { color:var(--primary-text-color); margin-left:5px; font-variant-numeric:tabular-nums; }
  .workspace { display:grid; grid-template-columns:minmax(0,1fr) 290px; gap:18px; align-items:start; }
  .map-card { border:1px solid var(--line); border-radius:14px; padding:16px; background:var(--subtle); }
  .plan-heading { font-size:13px; margin:0 0 10px; }
  .plan-heading span { font-size:11px; color:var(--muted); }
  .plan { position:relative; width:100%; max-width:710px; margin:auto; aspect-ratio:440/400; }
  .plan svg { width:100%; height:100%; display:block; overflow:visible; }
  .room-shape { fill:color-mix(in srgb,var(--accent) 11%,var(--surface)); stroke:color-mix(in srgb,var(--muted) 55%,var(--surface)); stroke-width:2; stroke-linejoin:round; cursor:pointer; }
  .room-shape.selected { fill:color-mix(in srgb,var(--accent) 30%,var(--surface)); stroke:var(--accent); stroke-width:2.4; }
  .room-shape.uncertain { stroke-dasharray:5 3; }
  .room-shape.simulated-covered { fill:color-mix(in srgb,var(--success-color,#2e8455) 18%,var(--surface)); }
  .room-shape.simulated-deficit { fill:color-mix(in srgb,var(--warning-color,#bc7424) 23%,var(--surface)); }
  .room-shape.simulated-covered.selected { fill:color-mix(in srgb,var(--success-color,#2e8455) 32%,var(--surface)); }
  .room-shape.simulated-deficit.selected { fill:color-mix(in srgb,var(--warning-color,#bc7424) 38%,var(--surface)); }
  .room-shape.simulated-invalid { fill:var(--subtle); stroke-dasharray:3 3; }
  .room-label-box { overflow:visible; }
  .room-label { display:block; width:100%; height:100%; padding:0; border:1px solid transparent; border-radius:6px; color:var(--primary-text-color); background:color-mix(in srgb,var(--surface) 85%,transparent); }
  .room-label:focus-visible { outline-offset:-3px; }
  .room-name,.room-readings { font-family:inherit; }
  .room-name { font-size:12px; font-weight:600; fill:currentColor; }
  .room-readings { font-size:6px; fill:var(--muted); font-variant-numeric:tabular-nums; }
  .room-label.selected { border-color:var(--accent); color:var(--accent); background:var(--surface); }
  .stairs { fill:var(--subtle); stroke:var(--muted); stroke-width:1; opacity:.65; }
  .stair-step { stroke:var(--muted); stroke-width:.7; opacity:.6; }
  .legend { display:flex; gap:14px; flex-wrap:wrap; font-size:10px; color:var(--muted); margin:10px 0 0; }
  .legend span { display:flex; align-items:center; gap:6px; }
  .readings-legend { color:var(--muted); font-size:10px; line-height:1.5; margin-top:10px; }
  .dot { display:inline-block; width:9px; height:9px; border:1px solid var(--muted); background:color-mix(in srgb,var(--accent) 11%,var(--surface)); border-radius:3px; }
  .dot.selected { border-color:var(--accent); background:var(--accent); }
  .dot.uncertain { border-style:dashed; background:var(--surface); }
  .dot.covered { background:var(--success-color,#2e8455); border-color:var(--success-color,#2e8455); }
  .dot.deficit { background:var(--warning-color,#bc7424); border-color:var(--warning-color,#bc7424); }
  .scenario { padding:18px; margin:20px 0; border:1px solid var(--line); border-radius:14px; background:var(--subtle); }
  .scenario h2 { margin:0 0 8px; font-size:18px; }
  .scenario-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin-top:14px; }
  .scenario-grid label { display:flex; flex-direction:column; gap:7px; font-size:11px; color:var(--muted); }
  .scenario-grid input,.scenario-grid select { width:100%; min-width:0; border:1px solid var(--line); background:var(--surface); color:var(--primary-text-color); padding:10px; border-radius:8px; }
  .scenario-grid input[aria-invalid=true] { border-color:var(--error-color,#db4437); }
  .scenario-assumptions .scenario-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .scenario-errors { margin:14px 0 0; }
  .scenario-errors p { margin:0; }
  .simulation-results .loss { align-items:baseline; }
  .simulation-results .loss b { white-space:nowrap; }
  .simulation-balance { padding:12px; border-radius:9px; background:var(--subtle); margin:13px 0; font-size:12px; line-height:1.5; }
  .simulation-balance.deficit { border-left:3px solid var(--warning-color,#bc7424); }
  .simulation-balance.covered { border-left:3px solid var(--success-color,#2e8455); }
  .zone-heading { font-size:11px; color:var(--muted); margin:18px 0 9px; }
  .zone-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
  .zone-button { display:flex; align-items:center; gap:9px; font-size:12px; text-align:left; padding:9px 10px; min-height:42px; }
  .zone-button[aria-pressed=true] { border-color:var(--accent); color:var(--accent); background:color-mix(in srgb,var(--accent) 7%,var(--surface)); }
  .zone-number { min-width:22px; width:22px; height:22px; font-size:10px; border-radius:6px; display:grid; place-items:center; background:var(--subtle); color:var(--muted); }
  .zone-button span:last-child { margin-left:auto; color:var(--muted); font-size:10px; white-space:nowrap; }
  .details { border:1px solid var(--line); border-radius:14px; padding:20px; }
  .detail-kicker { color:var(--muted); font-size:10px; letter-spacing:.5px; text-transform:uppercase; }
  h2 { margin:12px 0 16px; font-size:22px; line-height:1.2; letter-spacing:-.4px; font-weight:650; }
  .heat-value { font-size:38px; letter-spacing:-1px; color:var(--accent); font-weight:600; font-variant-numeric:tabular-nums; line-height:1; }
  .heat-value small { font-size:16px; font-weight:400; letter-spacing:0; }
  .heat-caption { font-size:11px; color:var(--muted); margin:7px 0 19px; }
  dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 9px; margin:0 0 18px; }
  dt { font-size:10px; color:var(--muted); margin:0 0 6px; }
  dd { margin:0; font-size:17px; font-variant-numeric:tabular-nums; }
  .loss { display:flex; justify-content:space-between; gap:12px; font-size:12px; padding:9px 0; border-top:1px solid var(--line); }
  .loss b { font-weight:550; font-variant-numeric:tabular-nums; }
  .note { font-size:11px; line-height:1.6; border-radius:9px; background:var(--subtle); padding:12px; color:var(--muted); margin:13px 0; }
  .warning { color:var(--primary-text-color); border-left:3px solid var(--warning-color,#d59a23); background:color-mix(in srgb,var(--warning-color,#d59a23) 12%,var(--surface)); }
  details { border-top:1px solid var(--line); padding-top:12px; margin-top:16px; font-size:11px; }
  summary { cursor:pointer; font-weight:550; }
  .source p { margin:8px 0; }
  .sensors { margin-top:18px; padding-top:16px; border-top:1px solid var(--line); }
  h3 { margin:0 0 10px; font-size:13px; font-weight:600; }
  .sensor-reading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0; }
  .sensor-reading strong { font-size:17px; font-variant-numeric:tabular-nums; }
  .sensor-name { font-size:12px; overflow-wrap:anywhere; }
  .sensor-id { display:block; font-size:9px; color:var(--muted); overflow-wrap:anywhere; }
  .sensor-select { max-height:240px; overflow:auto; margin:10px 0; }
  .sensor-select label { display:flex; align-items:start; gap:8px; font-size:12px; line-height:1.4; padding:8px 0; }
  .sensor-select input { margin:3px 0 0; accent-color:var(--accent); width:17px; height:17px; }
  .sensor-filter { display:block; width:100%; border:1px solid var(--line); border-radius:8px; padding:9px; margin-top:10px; color:var(--primary-text-color); background:var(--surface); }
  .actions { display:flex; gap:7px; flex-wrap:wrap; margin-top:10px; }
  .actions button { font-size:11px; padding:8px 10px; }
  .actions .primary { color:var(--text-primary-color,#fff); background:var(--accent); border-color:var(--accent); }
  .notice { margin:0 0 16px; padding:13px; border:1px solid var(--line); border-radius:10px; font-size:12px; line-height:1.5; }
  .notice button { margin-top:10px; font-size:12px; }
  .error { border-color:var(--error-color,#db4437); }
  .footer { margin-top:20px; padding-top:16px; border-top:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; font-size:10px; color:var(--muted); line-height:1.5; }
  @media(max-width:950px) { .workspace { grid-template-columns:minmax(0,1fr) 260px; gap:12px; } .metrics { grid-template-columns:repeat(2,minmax(0,1fr)); } .dashboard { padding:18px; } .details { padding:16px; } .metric { padding:13px; } .metric strong { font-size:25px; } .zone-button span:last-child { display:none; } }
  @media(max-width:720px) { .workspace { grid-template-columns:1fr; } .dashboard { padding:14px; } h1 { font-size:24px; } .chip { display:none; } .metrics { margin:18px 0; gap:8px; } .metric { padding:11px; } .metric strong { font-size:22px; } .metric-label { font-size:10px; } .metric p { font-size:10px; } .map-card { padding:12px; } .details { padding:18px; } .scenario-grid,.scenario-assumptions .scenario-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .footer { flex-direction:column; gap:3px; } }
  @media(max-width:420px) { .plan-heading span { display:none; } .zone-list { gap:6px; } .zone-button { font-size:11px; gap:6px; } .zone-number { min-width:19px; width:19px; height:19px; } .floor-tabs button { padding:9px 12px; font-size:12px; } .scenario { padding:13px; } .scenario-grid,.scenario-assumptions .scenario-grid { grid-template-columns:1fr; } }
`;
