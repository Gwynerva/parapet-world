/**
 * The simulation debug page (`npm run dev`, then /dev/sim/): the baked gym (or `?world=city`)
 * drawn as plain cells, a runner stepped at 30 steps per second from the keyboard, its state, the
 * observers' events and a live parameter panel that recompiles the ruleset on every change.
 * Needs `npm run bake` first. A tool for tuning, not part of the game.
 */
import {
  CELL,
  CELL_MISSING,
  Cell,
  Key,
  STEPS_PER_SECOND,
  base64ToBytes,
  type ChunkFile,
  type WorldIndex,
} from '@parapet-world/schemas';
import {
  ChunkWorld,
  FLAG,
  R,
  copyRunner,
  createObserver,
  createRunner,
  createStatics,
  enterRole,
  loadRuleset,
  observe,
  runnerView,
  stepRunner,
  type Ruleset,
  type RulesetSource,
  type WorldStatics,
} from '@parapet-world/sim';

const PX = 32;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stateEl = document.getElementById('state')!;
const eventsEl = document.getElementById('events')!;
const paramsEl = document.getElementById('params')!;
const perrEl = document.getElementById('perr')!;
const filterEl = document.getElementById('filter') as HTMLInputElement;

const params = new URLSearchParams(location.search);
const worldName = params.get('world') === 'city' ? 'world' : 'gym';

async function json<T>(path: string): Promise<T> {
  const res = await fetch(new URL(`../../${path}`, location.href));
  if (!res.ok) throw new Error(`${path}: ${res.status} (run npm run bake)`);
  return (await res.json()) as T;
}

interface Loaded {
  index: WorldIndex;
  world: ChunkWorld;
  statics: WorldStatics;
  source: RulesetSource;
  chunks: Map<number, { cx: number; cy: number; cells: Uint8Array; mats: Uint8Array }>;
}

async function load(): Promise<Loaded> {
  const [index, source] = await Promise.all([
    json<WorldIndex>(`${worldName}.json`),
    json<RulesetSource>('rules/moves.json'),
  ]);
  const world = new ChunkWorld(index.bounds);
  const chunks = new Map<number, { cx: number; cy: number; cells: Uint8Array; mats: Uint8Array }>();
  await Promise.all(
    index.chunks.map(async (ref) => {
      const file = await json<ChunkFile>(ref.file);
      world.load(file);
      chunks.set((file.cx << 16) ^ file.cy, {
        cx: file.cx,
        cy: file.cy,
        cells: base64ToBytes(file.cells),
        mats: base64ToBytes(file.materials),
      });
    }),
  );
  return { index, world, statics: createStatics(index), source, chunks };
}

const data = await load().catch((e: Error) => {
  stateEl.textContent = e.message;
  stateEl.className = 'err';
  throw e;
});
const defaults = structuredClone(data.source.params);
let rules: Ruleset = loadRuleset(data.source);
const hub = data.index.hubs[Math.max(0, data.index.startHub)];
const runner = hub
  ? createRunner(rules, hub.spawn[0], hub.spawn[1], hub.facing)
  : createRunner(rules, 4 * CELL, 4 * CELL, 1);
const observer = createObserver();
const events: string[] = [];

// Input: held keys, sampled once per step; a tap lasts at least one step.
const down = new Set<string>();
const tapped = new Set<string>();
const KEYS: Record<string, number> = {
  ArrowLeft: Key.LEFT,
  KeyA: Key.LEFT,
  ArrowRight: Key.RIGHT,
  KeyD: Key.RIGHT,
  ArrowUp: Key.UP,
  KeyW: Key.UP,
  KeyZ: Key.UP,
  Space: Key.UP,
  ArrowDown: Key.DOWN,
  KeyS: Key.DOWN,
  KeyX: Key.ACTION,
  ShiftLeft: Key.ACTION,
  ShiftRight: Key.ACTION,
};
let paused = false;
let slow = false;
let stepOnce = false;
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (KEYS[e.code] !== undefined) {
    down.add(e.code);
    tapped.add(e.code);
    e.preventDefault();
  }
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'Period') stepOnce = true;
  if (e.code === 'KeyM') slow = !slow;
  if (e.code === 'KeyR') enterRole(runner, rules, 'respawn', data.statics, data.world);
  if (e.code === 'KeyF') enterRole(runner, rules, 'frozen', data.statics, data.world);
});
addEventListener('keyup', (e) => down.delete(e.code));
addEventListener('blur', () => down.clear());

function held(): number {
  let h = 0;
  for (const code of down) h |= KEYS[code] ?? 0;
  for (const code of tapped) h |= KEYS[code] ?? 0;
  tapped.clear();
  return h;
}

// Camera and zoom.
let zoom = 2;
let camX = runner[R.X]! / PX;
let camY = runner[R.Y]! / PX;
canvas.addEventListener('wheel', (e) => {
  zoom = Math.min(6, Math.max(0.5, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
  e.preventDefault();
});
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const wx = camX + (e.clientX - r.left - r.width / 2) / zoom;
  const wy = camY + (e.clientY - r.top - r.height / 2) / zoom;
  runner[R.X] = Math.round(wx * PX);
  runner[R.Y] = Math.round(wy * PX);
  runner[R.VX] = 0;
  runner[R.VY] = 0;
  enterRole(runner, rules, 'fall', data.statics, data.world);
});

// The parameter panel.
function buildParams(): void {
  paramsEl.textContent = '';
  const f = filterEl.value.trim().toLowerCase();
  for (const name of Object.keys(data.source.params)) {
    if (f && !name.toLowerCase().includes(f)) continue;
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = name;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.value = String(data.source.params[name]);
    input.classList.toggle('changed', data.source.params[name] !== defaults[name]);
    input.addEventListener('change', () => {
      data.source.params[name] = Math.round(Number(input.value));
      input.classList.toggle('changed', data.source.params[name] !== defaults[name]);
      recompile();
    });
    label.append(span, input);
    paramsEl.append(label);
  }
}

function recompile(): void {
  try {
    rules = loadRuleset(data.source);
    perrEl.textContent = '';
  } catch (e) {
    perrEl.textContent = (e as Error).message;
  }
}

filterEl.addEventListener('input', buildParams);
document.getElementById('reset')!.addEventListener('click', () => {
  data.source.params = structuredClone(defaults);
  recompile();
  buildParams();
});
document.getElementById('copy')!.addEventListener('click', () => {
  const changed = Object.fromEntries(
    Object.keys(data.source.params)
      .filter((k) => data.source.params[k] !== defaults[k])
      .map((k) => [k, data.source.params[k]]),
  );
  void navigator.clipboard.writeText(JSON.stringify(changed, null, 2));
});
buildParams();

// Stepping.
let last = performance.now();
let carry = 0;
const prev = copyRunner(runner);

function step(): void {
  copyRunner(runner, prev);
  if (!stepRunner(runner, held(), null, data.world, rules, data.statics)) return;
  for (const ev of observe(observer, runner, rules, data.statics)) {
    const what =
      ev.kind === 'hub'
        ? data.index.hubs[ev.index]?.id
        : ev.kind === 'find'
          ? data.index.finds[ev.index]?.id
          : ev.kind === 'death'
            ? ''
            : ev.kind === 'respawn'
              ? data.index.hubs[ev.index]?.id
              : data.index.routes[ev.index]?.id;
    const extra =
      ev.kind === 'checkpoint' || ev.kind === 'finish' ? ` ${(ev.steps / 30).toFixed(2)} s` : '';
    events.unshift(`${String(ev.step).padStart(6)} ${ev.kind} ${what ?? ''}${extra}`);
    events.length = Math.min(events.length, 14);
  }
}

function frame(now: number): void {
  const dt = Math.min(250, now - last);
  last = now;
  if (!paused) carry += (dt * STEPS_PER_SECOND) / 1000 / (slow ? 4 : 1);
  while (carry >= 1) {
    step();
    carry -= 1;
  }
  if (stepOnce) {
    step();
    stepOnce = false;
  }
  draw(paused ? 1 : carry);
  requestAnimationFrame(frame);
}

// Drawing.
const MAT_COLOURS = data.index.materials.map((m) => `rgb(${m.avg[0]},${m.avg[1]},${m.avg[2]})`);

function cellPath(cls: number, x: number, y: number, s: number): void {
  switch (cls) {
    case Cell.SOLID:
      ctx.fillRect(x, y, s, s);
      break;
    case Cell.HALF:
      ctx.fillRect(x, y + s / 2, s, s / 2);
      break;
    case Cell.SLAB:
      ctx.fillRect(x, y, s, s / 2);
      break;
    case Cell.POST:
      ctx.fillRect(x + (s * 12) / 32, y, (s * 8) / 32, s);
      break;
    case Cell.SLOPE_UP:
      ctx.beginPath();
      ctx.moveTo(x, y + s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x + s, y + s);
      ctx.fill();
      break;
    case Cell.SLOPE_DOWN:
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s, y + s);
      ctx.lineTo(x, y + s);
      ctx.fill();
      break;
    case Cell.TOP:
      ctx.fillRect(x, y, s, Math.max(1, (s * 3) / 32));
      break;
    case Cell.BAR:
      ctx.fillRect(x, y + (s * 1) / 32, s, Math.max(1, (s * 2) / 32));
      break;
    case Cell.LADDER:
      for (let k = 0; k < 4; k++) ctx.fillRect(x + s * 0.2, y + (k * s) / 4 + s / 8, s * 0.6, 1);
      ctx.fillRect(x + s * 0.2, y, 1, s);
      ctx.fillRect(x + s * 0.8, y, 1, s);
      break;
    case Cell.POLE:
      ctx.fillRect(x + s / 2 - 1, y, 2, s);
      break;
    case Cell.KILL:
      ctx.fillRect(x, y, s, s);
      break;
  }
}

function rect(r: [number, number, number, number], colour: string, dashed = false): void {
  ctx.strokeStyle = colour;
  ctx.setLineDash(dashed ? [4, 4] : []);
  ctx.strokeRect(r[0] * PX * zoom, r[1] * PX * zoom, r[2] * PX * zoom, r[3] * PX * zoom);
  ctx.setLineDash([]);
}

function draw(alpha: number): void {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const rx = (prev[R.X]! + (runner[R.X]! - prev[R.X]!) * alpha) / PX;
  const ry = (prev[R.Y]! + (runner[R.Y]! - prev[R.Y]!) * alpha) / PX;
  camX += (rx - camX) * 0.2;
  camY += (ry - 24 - camY) * 0.2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#101218';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(Math.round(w / 2 - camX * zoom), Math.round(h / 2 - camY * zoom));

  const s = PX * zoom;
  const x0 = Math.floor((camX - w / 2 / zoom) / PX) - 1;
  const x1 = Math.ceil((camX + w / 2 / zoom) / PX) + 1;
  const y0 = Math.floor((camY - h / 2 / zoom) / PX) - 1;
  const y1 = Math.ceil((camY + h / 2 / zoom) / PX) + 1;
  ctx.strokeStyle = '#1b1f2a';
  ctx.lineWidth = 1;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const raw = data.world.cell(cx, cy);
      const cls = raw & ~CELL_MISSING;
      if ((raw & CELL_MISSING) !== 0) {
        ctx.fillStyle = '#2a1520';
        ctx.fillRect(cx * s, cy * s, s, s);
        continue;
      }
      if (cls === Cell.EMPTY) continue;
      const chunk = data.chunks.get(((cx >> 5) << 16) ^ (cy >> 5));
      const mat = chunk ? chunk.mats[((cy & 31) << 5) | (cx & 31)]! : 0;
      ctx.fillStyle =
        cls === Cell.KILL
          ? '#4f7a2a'
          : mat !== 0
            ? MAT_COLOURS[mat]!
            : cls === Cell.LADDER || cls === Cell.POLE || cls === Cell.BAR
              ? '#e0a040'
              : '#c0703a';
      cellPath(cls, cx * s, cy * s, s);
    }
  }
  // Chunk borders.
  ctx.strokeStyle = '#3a2f50';
  for (let cx = Math.floor(x0 / 32) * 32; cx <= x1; cx += 32) {
    ctx.beginPath();
    ctx.moveTo(cx * s, y0 * s);
    ctx.lineTo(cx * s, y1 * s);
    ctx.stroke();
  }
  for (let cy = Math.floor(y0 / 32) * 32; cy <= y1; cy += 32) {
    ctx.beginPath();
    ctx.moveTo(x0 * s, cy * s);
    ctx.lineTo(x1 * s, cy * s);
    ctx.stroke();
  }
  // Triggers.
  for (const hubDef of data.index.hubs) rect(hubDef.rect, '#5aa0ff');
  for (const route of data.index.routes) {
    for (const c of route.corridor) rect(c, '#3c4a3c', true);
    rect(route.start, '#5fd068');
    for (const c of route.checkpoints) rect(c, '#e8d050');
    rect(route.finish, '#ff6050');
  }
  for (const f of data.index.finds) rect(f.rect, '#c070ff');

  // The runner.
  const v = runnerView(runner, rules);
  const flags = rules.flags[runner[R.MOVE]!]!;
  const hw = rules.params.halfWidth! / PX;
  const bh = ((flags & FLAG.crouch) !== 0 ? rules.params.crouchHeight! : rules.params.height!) / PX;
  const z = zoom;
  ctx.strokeStyle = v.dead ? '#ff4040' : v.anchorHands ? '#f0b34a' : '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect((rx - hw) * z, (ry - bh) * z, hw * 2 * z, bh * z);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(rx * z - 2, ry * z - 2, 4, 4);
  ctx.beginPath();
  const ay = (ry - bh * 0.7) * z;
  ctx.moveTo(rx * z, ay);
  ctx.lineTo((rx + v.facing * hw * 1.6) * z, ay);
  ctx.stroke();
  if (v.anchorHands) {
    ctx.fillStyle = '#f0b34a';
    ctx.fillRect((runner[R.GRIP_X]! / PX) * z - 3, (runner[R.GRIP_Y]! / PX) * z - 3, 6, 6);
  }
  ctx.lineWidth = 1;

  stateEl.textContent = [
    `${worldName}  ruleset ${rules.hash.toString(16)}${paused ? '  PAUSED' : ''}${slow ? '  SLOW' : ''}`,
    `move   ${v.move}  (clip ${v.clip})`,
    `timer  ${v.timer}/${runner[R.DUR]}  progress ${v.progress.toFixed(2)}  phase ${v.phase}`,
    `pos    ${(v.x / CELL).toFixed(2)}, ${(v.y / CELL).toFixed(2)} cells  facing ${v.facing}`,
    `vel    ${v.vx}, ${v.vy} u/step  (${((v.vx * 30) / CELL).toFixed(1)} cells/s)`,
    `ground ${runner[R.GROUND]! - 1}  slope ${runner[R.SLOPE]}  wall ${runner[R.WALL]}  impact ${runner[R.IMPACT]}`,
    `landVY ${runner[R.LAND_VY]}  air ${runner[R.AIR_STEPS]}  lock ${runner[R.LOCK]}  drop ${runner[R.DROP]}`,
    `grip   ${runner[R.GRIP_X]}, ${runner[R.GRIP_Y]} (${runner[R.GRIP_KIND]})  speed ${runner[R.SPEED]}`,
    `step   ${runner[R.STEP]}  held ${runner[R.HELD]}`,
  ].join('\n');
  eventsEl.textContent = events.join('\n');
}

requestAnimationFrame(frame);
