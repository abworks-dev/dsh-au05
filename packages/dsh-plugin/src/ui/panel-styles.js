// Shared AU05 presentation. Host theme aliases remain the color authority.
export const panelCss = `
[data-au05-plugin] { --au05-space-tight:4px; --au05-space-control:8px; --au05-space-group:12px; --au05-space-section:16px; --au05-radius-control:8px; --au05-radius-panel:12px; --au05-control-height:32px; --au05-field-height:36px; --au05-label-width:72px; position:fixed; top:calc(var(--dsh-frame-overlay-top,20px) + 40px + env(safe-area-inset-top,0px)); right:calc(16px + env(safe-area-inset-right,0px)); z-index:1; display:flex; flex-direction:column; align-items:flex-end; gap:var(--au05-space-control); max-width:calc(100vw - 32px - env(safe-area-inset-right,0px) - env(safe-area-inset-left,0px)); font:inherit; font-size:12px; line-height:1.6; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-primary,CanvasText); }
[data-au05-plugin] * { box-sizing:border-box; }
[data-au05-plugin] :is(button,input,select) { font:inherit; color:inherit; }
[data-au05-plugin] button { cursor:pointer; transition:background .15s ease,border-color .15s ease,color .15s ease; }
[data-au05-plugin] button:disabled { cursor:default; opacity:.6; }
[data-au05-plugin] button:hover:not(:disabled) { background:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 8%,var(--dsw-alias-bg-base,Canvas)); }
[data-au05-plugin] button:active:not(:disabled) { transform:translateY(1px); }
[data-au05-plugin] :is(button,input,select,textarea,summary,[role=dialog]):focus-visible { outline:2px solid var(--dsw-alias-brand-primary,Highlight); outline-offset:3px; }
[data-au05-plugin] .au05-pill { touch-action:none; user-select:none; cursor:grab; display:inline-flex; align-items:center; gap:var(--au05-space-control); min-height:var(--au05-control-height); max-width:100%; padding:4px 12px; border-radius:16px; border:1px solid var(--dsw-alias-border-l2,currentColor); background:var(--dsw-alias-bg-layer-1,Canvas); }
[data-au05-plugin] .au05-pill strong { font-weight:600; }
[data-au05-plugin] [data-au05-connection] { max-width:8em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--dsw-alias-label-secondary,currentColor); }
[data-au05-plugin] .au05-dot { width:8px; height:8px; flex:none; border-radius:50%; background:var(--dsw-alias-state-idle-primary,currentColor); opacity:.6; }
[data-au05-plugin] .au05-dot[data-active=true] { background:var(--dsw-alias-state-success-primary,currentColor); opacity:1; }
[data-au05-plugin] .au05-pill[data-attention=true] .au05-dot { background:var(--dsw-alias-state-warn-primary,currentColor); opacity:1; }
[data-au05-plugin] .au05-panel { width:380px; max-width:100%; max-height:calc(100dvh - var(--dsh-frame-overlay-top,20px) - 112px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)); overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding:16px; border-radius:var(--au05-radius-panel); border:1px solid var(--dsw-alias-border-l1,currentColor); background:var(--dsw-alias-bg-base,Canvas); box-shadow:0 8px 24px #00000014; }
[data-au05-plugin] .au05-heading { display:flex; align-items:center; justify-content:space-between; gap:var(--au05-space-group); margin-bottom:12px; }
[data-au05-plugin] h2 { font-size:16px; font-weight:600; margin:0; }
[data-au05-plugin] .au05-action { min-height:var(--au05-control-height); padding:4px 12px; border:1px solid var(--dsw-alias-border-l2,currentColor); border-radius:var(--au05-radius-control); background:var(--dsw-alias-bg-layer-1,Canvas); }
[data-au05-plugin] .au05-primary:not(:disabled) { color:var(--dsw-alias-bg-base,Canvas); background:var(--dsw-alias-label-primary,CanvasText); border-color:var(--dsw-alias-label-primary,CanvasText); }
[data-au05-plugin] .au05-primary:hover:not(:disabled) { background:var(--dsw-alias-label-secondary,CanvasText); }
[data-au05-plugin] .au05-quiet { background:transparent; border-color:transparent; }
[data-au05-plugin] .au05-connection-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:var(--au05-space-control); margin-bottom:16px; }
[data-au05-plugin] .au05-connection-row [data-au05-device-status] { margin:0; }
[data-au05-plugin] .au05-connection-row .au05-action { align-self:stretch; }
[data-au05-plugin] .au05-connection-row[data-studio=true], [data-au05-plugin] .au05-connection-row[data-status-hidden=true] { grid-template-columns:repeat(2,minmax(0,1fr)); }
[data-au05-plugin] .au05-connection-row[data-studio=true] [data-au05-device-status] { grid-column:1 / -1; }
[data-au05-plugin] .au05-voice-row { display:flex; align-items:center; gap:var(--au05-space-group); margin:0 0 16px; }
[data-au05-plugin] .au05-voice-row .au05-switch { flex:none; margin:0; }
[data-au05-plugin] .au05-voice-row select { flex:1; }
[data-au05-plugin] .au05-note { margin:8px 0; color:var(--dsw-alias-label-secondary,currentColor); overflow-wrap:anywhere; text-wrap:pretty; }
[data-au05-plugin] .au05-switch { display:flex; align-items:center; gap:var(--au05-space-control); min-height:var(--au05-control-height); margin:8px 0; }
[data-au05-plugin] input[type=checkbox] { width:16px; height:16px; margin:0; flex:none; accent-color:var(--dsw-alias-brand-primary,Highlight); }
[data-au05-plugin] :is(select,input[type=text],textarea) { display:block; min-width:0; width:100%; max-width:100%; margin:0; padding:8px; border:1px solid var(--dsw-alias-border-l2,currentColor); border-radius:var(--au05-radius-control); color:var(--dsw-alias-label-primary,CanvasText); background:var(--dsw-alias-bg-base,Canvas); }
[data-au05-plugin] :is(select,input[type=text]) { min-height:var(--au05-field-height); }
[data-au05-plugin] :is(select,input):disabled { cursor:not-allowed; opacity:.6; }
[data-au05-plugin] textarea { resize:vertical; font:12px/1.6 ui-monospace,monospace; }
[data-au05-plugin] :is(input[type=range],meter) { min-width:0; width:100%; margin:0; accent-color:var(--dsw-alias-brand-primary,Highlight); }
[data-au05-plugin] details { border-top:1px solid var(--dsw-alias-border-l1,currentColor); padding:8px 0; }
[data-au05-plugin] summary { min-height:var(--au05-control-height); align-content:center; cursor:pointer; font-weight:500; border-radius:4px; }
[data-au05-plugin] summary:hover { color:var(--dsw-alias-label-secondary,currentColor); }
[data-au05-plugin] details > :not(summary) { margin-top:12px; }
[data-au05-plugin] .au05-field { display:grid; grid-template-columns:var(--au05-label-width) minmax(0,1fr); gap:var(--au05-space-control); align-items:center; margin:12px 0; }
[data-au05-plugin] .au05-field > label { color:var(--dsw-alias-label-secondary,currentColor); }
[data-au05-plugin] .au05-field-actions { grid-column:2; display:flex; flex-wrap:wrap; gap:var(--au05-space-control); }
[data-au05-plugin] .au05-actions { display:flex; flex-wrap:wrap; gap:var(--au05-space-control); margin:12px 0; }
[data-au05-plugin] .au05-conflict { white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; padding:12px; border:1px solid var(--dsw-alias-state-warn-primary,currentColor); border-radius:var(--au05-radius-control); }
[data-au05-plugin] [role=alert] { color:var(--dsw-alias-state-error-primary,CanvasText); border-inline-start:2px solid currentColor; padding-inline-start:8px; }
[data-au05-plugin] .au05-warning { color:var(--dsw-alias-state-warn-primary,CanvasText); }
[data-au05-plugin] .au05-inspector { display:grid; grid-template-columns:76px minmax(0,1fr); gap:var(--au05-space-section); align-items:center; margin:16px 0; }
[data-au05-plugin] .au05-device-art { position:relative; width:76px; aspect-ratio:364 / 1334; }
[data-au05-plugin] .au05-device-art > svg { display:block; width:100%; height:100%; pointer-events:none; }
[data-au05-plugin] .au05-lamp-echo { pointer-events:none; }
[data-au05-plugin] .au05-lamp-echo [data-au05-lamp] { fill:none; stroke:#f5bd70; stroke-width:11; opacity:0; filter:drop-shadow(0 0 11px #edab59); }
[data-au05-plugin] .au05-lamp-echo [data-au05-lamp][data-lamp-mode="1"], [data-au05-plugin] .au05-lamp-echo [data-au05-lamp][data-lamp-mode="2"] { opacity:.72; }
/* Illustrative cadence only: readback provides mode, not the physical breathing phase. */
@keyframes au05-lamp-breathe { 0%,100% { opacity:.18; } 50% { opacity:.95; } }
[data-au05-plugin] .au05-lamp-echo [data-au05-lamp][data-lamp-mode="2"] { animation:au05-lamp-breathe 1.5s ease-in-out infinite; }
[data-au05-plugin] .au05-control-detail { min-width:0; display:grid; gap:var(--au05-space-group); padding-inline-start:16px; border-inline-start:1px solid var(--dsw-alias-border-l1,currentColor); }
[data-au05-plugin] .au05-input-echo { pointer-events:none; }
[data-au05-plugin] [data-au05-input-control] { fill:#245ea81f; stroke:#245ea8; stroke-width:10; }
[data-au05-plugin] .au05-control-detail h3 { display:flex; flex-wrap:wrap; align-items:center; gap:var(--au05-space-control); margin:0; font-size:12px; font-weight:500; color:var(--dsw-alias-label-secondary,currentColor); }
[data-au05-plugin] [data-au05-input-state] { color:var(--dsw-alias-brand-primary,Highlight); font-weight:600; }
[data-au05-plugin] .au05-control-detail p { margin:4px 0 0; overflow-wrap:anywhere; }
[data-au05-plugin] .au05-control-detail .au05-key-status { font-size:12px; color:var(--dsw-alias-label-secondary,currentColor); }
@media (max-width:480px) { [data-au05-plugin] { right:calc(8px + env(safe-area-inset-right,0px)); max-width:calc(100vw - 16px - env(safe-area-inset-right,0px) - env(safe-area-inset-left,0px)); } [data-au05-plugin] .au05-panel { padding:12px; } }
@media (max-width:360px) { [data-au05-plugin] .au05-inspector { grid-template-columns:68px minmax(0,1fr); gap:var(--au05-space-group); } [data-au05-plugin] .au05-device-art { width:68px; } [data-au05-plugin] .au05-control-detail { padding-inline-start:12px; } [data-au05-plugin] .au05-voice-row { gap:var(--au05-space-control); } [data-au05-plugin] .au05-field { --au05-label-width:64px; } [data-au05-plugin] .au05-connection-row .au05-action { padding-inline:8px; } }
@media (prefers-reduced-motion:reduce) { [data-au05-plugin] *, [data-au05-plugin] *::before, [data-au05-plugin] *::after { transition:none !important; animation:none !important; } [data-au05-plugin] button:active:not(:disabled) { transform:none; } }
`;
