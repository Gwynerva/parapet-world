/** DOM helpers and the stylesheet of the game's HUD and menus. */

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Creates an element: `h('button', { class: 'x', onclick: fn }, 'Text', child)`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const CSS = `
:root {
  --ink: #f2efe6; --muted: #a9adbd; --panel: rgba(14, 16, 24, 0.86); --line: rgba(255,255,255,0.12);
  --accent: #ff8a3d; --good: #6fdc8c; --bad: #ff6b6b; --font: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mono: ui-monospace, Consolas, monospace;
}
#ui { position: fixed; inset: 0; pointer-events: none; color: var(--ink); font: 15px/1.45 var(--font);
  user-select: none; -webkit-user-select: none; }
#ui button, #ui input, #ui select { font: inherit; }
.hud-row { position: absolute; top: 10px; left: 12px; right: 12px; display: flex; justify-content: space-between;
  align-items: flex-start; gap: 12px; }
.chip { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 5px 10px;
  font: 600 14px/1.3 var(--font); white-space: nowrap; }
.chip.dim { color: var(--muted); font-weight: 500; }
.left { display: flex; gap: 8px; flex-wrap: wrap; }
.timer { text-align: center; min-width: 150px; }
.timer .t { font: 700 22px/1.2 var(--mono); font-variant-numeric: tabular-nums; }
.timer .name { color: var(--muted); font-size: 12px; }
.timer .splits { font: 12px/1.4 var(--mono); color: var(--muted); }
.timer .best { color: var(--good); }
.timer .splits:empty { display: none; }
.timer .away { margin-top: 4px; color: var(--bad); font: 700 12px/1.4 var(--font); animation: away 0.5s ease-in-out infinite alternate; }
.timer .away .bar { height: 3px; margin-top: 3px; border-radius: 2px; background: rgba(255,107,107,0.25); overflow: hidden; }
.timer .away i { display: block; height: 100%; background: var(--bad); }
@keyframes away { from { opacity: 1; } to { opacity: 0.55; } }
@media (prefers-reduced-motion: reduce) { .timer .away { animation: none; } }
.toasts { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.toast { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: 8px; padding: 7px 12px; animation: toast 3.6s ease forwards; max-width: 300px; }
@keyframes toast { 0% { opacity: 0; transform: translateY(-6px); } 8% { opacity: 1; transform: none; }
  85% { opacity: 1; } 100% { opacity: 0; } }
.banner { position: absolute; top: 22%; left: 0; right: 0; text-align: center; pointer-events: none;
  font: 800 clamp(28px, 6vw, 64px)/1 var(--font); letter-spacing: 0.12em; text-transform: uppercase;
  text-shadow: 0 3px 0 rgba(0,0,0,0.5); opacity: 0; transition: opacity 0.6s ease; }
.banner small { display: block; font: 600 clamp(12px, 1.6vw, 16px)/1.6 var(--font); letter-spacing: 0.3em;
  color: var(--muted); }
.banner.on { opacity: 1; }
.names { position: absolute; inset: 0; width: 100%; height: 100%; }
.d1 { --level: #6fdc8c; } .d2 { --level: #f2c94c; } .d3 { --level: #ff8a3d; } .d4 { --level: #ff5d73; }
.pill { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 99px; font: 600 11px/1.5 var(--font);
  text-transform: none; letter-spacing: 0; color: #15110c; background: var(--level); vertical-align: 1px; }
.prompt { position: absolute; bottom: 22%; left: 50%; transform: translateX(-50%); }
.prompt button { pointer-events: auto; }
.screen { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: auto;
  background: radial-gradient(ellipse at center, rgba(8,10,16,0.55), rgba(8,10,16,0.9)); padding: 16px; }
.screen.side { place-items: center end; background: linear-gradient(90deg, transparent 40%, rgba(8,10,16,0.75)); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px;
  width: min(440px, 100%); max-height: calc(100vh - 32px); overflow: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.card h1 { margin: 0 0 4px; font: 800 34px/1.1 var(--font); letter-spacing: 0.02em; }
.card h2 { margin: 0 0 12px; font: 700 20px/1.2 var(--font); }
.card h3 { margin: 16px 0 6px; font: 600 13px/1.2 var(--font); color: var(--muted); text-transform: uppercase;
  letter-spacing: 0.08em; }
.card p { margin: 0 0 10px; color: var(--muted); }
.lead { color: var(--muted); margin-bottom: 18px !important; }
.field { display: flex; gap: 8px; margin: 12px 0; }
.field input[type=text] { flex: 1; min-width: 0; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--line);
  background: rgba(255,255,255,0.06); color: var(--ink); }
.btn { padding: 9px 16px; border-radius: 8px; border: 1px solid var(--line); background: rgba(255,255,255,0.08);
  color: var(--ink); cursor: pointer; font-weight: 600; }
.btn:hover { background: rgba(255,255,255,0.14); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.primary { background: var(--accent); color: #1b0f05; border-color: transparent; }
.btn.primary:hover { filter: brightness(1.08); }
.btn.on { outline: 2px solid var(--accent); outline-offset: -2px; }
.btn:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.stack { display: flex; flex-direction: column; gap: 8px; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 0;
  border-bottom: 1px solid var(--line); }
.row:last-child { border-bottom: 0; }
.row .k { color: var(--muted); }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.notes { font: 12px/1.5 var(--mono); color: var(--muted); margin-top: 14px; }
.slider { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.slider input { flex: 1; }
.touch { position: absolute; inset: auto 0 0 0; height: 46%; pointer-events: none; display: none; }
.touch.on { display: block; }
.pad { position: absolute; bottom: max(18px, env(safe-area-inset-bottom)); display: flex; gap: 12px; }
.pad.l { left: max(18px, env(safe-area-inset-left)); }
.pad.r { right: max(18px, env(safe-area-inset-right)); align-items: flex-end; }
.tb { width: 72px; height: 72px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.35);
  background: rgba(20,22,30,0.4); color: var(--ink); font: 700 22px/1 var(--font); pointer-events: auto;
  touch-action: none; display: grid; place-items: center; }
.tb.big { width: 88px; height: 88px; }
.tb.held { background: rgba(255,138,61,0.55); border-color: var(--accent); }
.corner { position: absolute; top: 10px; right: 12px; pointer-events: auto; display: none; }
.touch.on ~ .corner { display: block; }
#ui:has(.touch.on) .toasts { margin-right: 56px; }
.fade { position: absolute; inset: 0; background: #05060a; opacity: 0; pointer-events: none;
  transition: opacity 0.35s ease; }
.fade.on { opacity: 1; }
.help { display: grid; grid-template-columns: minmax(96px, auto) 1fr; gap: 6px 14px; align-items: baseline; }
.help .keys { font: 600 13px/1.4 var(--mono); color: var(--accent); white-space: nowrap; }
.help .what { color: var(--ink); }
.help .what small { color: var(--muted); }
.kbd { display: inline-block; min-width: 1.4em; text-align: center; padding: 0 5px; border-radius: 5px;
  border: 1px solid var(--line); background: rgba(255,255,255,0.07); margin-right: 3px; }
.dev { position: absolute; left: 12px; top: 52px; font: 12px/1.4 var(--mono); color: var(--muted);
  background: var(--panel); border-radius: 8px; padding: 6px 10px; white-space: pre; }
.dev.rec { color: var(--bad); }
@media (max-width: 640px) { .chip { font-size: 12px; } .timer .t { font-size: 18px; } }
`;

export function injectStyle(): void {
  if (document.getElementById('game-style')) return;
  document.head.append(h('style', { id: 'game-style' }, CSS));
}
