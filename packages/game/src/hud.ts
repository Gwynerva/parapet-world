/**
 * The HUD: the district banner on entering a district, the route timer with checkpoint splits
 * (and a warning while a run is off its route), the finds counter, toasts, names over runners and the hub prompt. Plain DOM over the canvas.
 */
import { formatSteps } from './profile.ts';
import { h } from './ui.ts';

export interface NameTag {
  x: number;
  y: number;
  text: string;
  kind: 'own' | 'player' | 'bot' | 'gate';
  /** A gate's route difficulty, 1..4. */
  level?: number;
}

const NAME_FONT = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
const GATE_FONT = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
const TAG_BG = 'rgba(10, 12, 18, 0.6)';
const INK = '#f2efe6';
const TAG_COLOUR: Readonly<Record<string, string>> = {
  own: '#ff8a3d',
  player: '#f2efe6',
  bot: '#a9adbd',
};
const LEVEL_COLOUR: readonly string[] = ['', '#6fdc8c', '#f2c94c', '#ff8a3d', '#ff5d73'];

export class Hud {
  readonly root: HTMLDivElement;
  private readonly finds: HTMLDivElement;
  private readonly where: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly toasts: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly names: HTMLCanvasElement;
  private readonly namesCtx: CanvasRenderingContext2D | null;
  private readonly widths = new Map<string, number>();
  private namesFont = '';
  private namesDrawn = -1;
  private readonly prompt: HTMLDivElement;

  private readonly fade: HTMLDivElement;
  private readonly tName: HTMLDivElement;
  private readonly tTime: HTMLDivElement;
  private readonly tSplits: HTMLDivElement;
  private readonly tExtra: HTMLDivElement;
  private readonly tAway: HTMLDivElement;
  private readonly tAwayBar: HTMLElement;
  /** The grace bar's width shown, percent; -1 while the warning is hidden. */
  private awayShown = -1;
  private runKey = '';
  private fadeTimer = 0;
  private bannerTimer = 0;
  private timerHold = 0;
  /** Called when the hub prompt's button is pressed (touch). */
  onHub: (() => void) | null = null;

  constructor() {
    this.finds = h('div', { class: 'chip' });
    this.where = h('div', { class: 'chip dim' });
    this.status = h('div', { class: 'chip dim', style: 'display:none' });
    this.tName = h('div', { class: 'name' });
    this.tTime = h('div', { class: 't' });
    this.tSplits = h('div', { class: 'splits' });
    this.tExtra = h('div', { class: 'splits' });
    this.tAwayBar = h('i', {});
    this.tAway = h(
      'div',
      { class: 'away', style: 'display:none' },
      'Back to the route!',
      h('div', { class: 'bar' }, this.tAwayBar),
    );
    this.timer = h(
      'div',
      { class: 'chip timer', style: 'visibility:hidden' },
      this.tName,
      this.tTime,
      this.tSplits,
      this.tExtra,
      this.tAway,
    );
    this.toasts = h('div', { class: 'toasts' });
    this.banner = h('div', { class: 'banner' });
    this.names = h('canvas', { class: 'names' });
    this.namesCtx = this.names.getContext('2d');
    this.prompt = h('div', { class: 'prompt', style: 'display:none' });
    this.fade = h('div', { class: 'fade' });
    this.root = h(
      'div',
      { class: 'hud' },
      this.names,
      this.banner,
      h(
        'div',
        { class: 'hud-row' },
        h('div', { class: 'left' }, this.finds, this.where, this.status),
        this.timer,
        this.toasts,
      ),
      this.prompt,
      this.fade,
    );
  }

  /** Fades the picture to black after `delay` ms (a death; a teleport with 0). */
  dim(delay: number): void {
    clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => this.fade.classList.add('on'), delay);
  }

  /** Fades the picture back in. */
  undim(): void {
    clearTimeout(this.fadeTimer);
    this.fade.classList.remove('on');
  }

  setFinds(found: number, total: number): void {
    this.finds.textContent = `Finds ${found} / ${total}`;
  }

  setWhere(text: string): void {
    this.where.textContent = text;
  }

  setStatus(text: string): void {
    if (this.status.textContent === text) return;
    this.status.textContent = text;
    this.status.style.display = text ? '' : 'none';
  }

  /** Shows a district's name across the screen for a few seconds. */
  showBanner(title: string, sub: string): void {
    this.banner.replaceChildren(h('small', {}, sub), title);
    this.banner.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('on'), 2600);
  }

  toast(text: string): void {
    const el = h('div', { class: 'toast' }, text);
    this.toasts.append(el);
    setTimeout(() => el.remove(), 3700);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
  }

  /** Writes the timer's lines; each is touched only when its text changes. */
  private timerText(
    name: string,
    time: string,
    splits: string,
    extra: string,
    best: boolean,
  ): void {
    if (this.tName.textContent !== name) this.tName.textContent = name;
    if (this.tTime.textContent !== time) this.tTime.textContent = time;
    if (this.tSplits.textContent !== splits) this.tSplits.textContent = splits;
    if (this.tExtra.textContent !== extra) this.tExtra.textContent = extra;
    this.tTime.classList.toggle('best', best);
    this.tExtra.classList.toggle('best', best);
    if (this.timer.style.visibility) this.timer.style.visibility = '';
  }

  /**
   * The route timer: a run in progress (steps so far, its splits, the best time), or nothing,
   * which hides it once a held result has expired. Cheap to call every frame: the text is redone
   * only when the steps or the splits change.
   */
  setRun(
    name: string | null,
    steps: number,
    splits: readonly number[],
    best: number | undefined,
    now: number,
  ): void {
    if (name === null) {
      if (now > this.timerHold && this.timer.style.visibility !== 'hidden') {
        this.timer.style.visibility = 'hidden';
      }
      this.runKey = '';
      return;
    }
    if (now < this.timerHold) return;
    const key = `${steps}/${splits.length}/${name}`;
    if (key === this.runKey) return;
    this.runKey = key;
    this.timerText(
      name,
      formatSteps(steps),
      splits.map((s, i) => `CP${i + 1} ${formatSteps(s)}`).join('  '),
      best ? `best ${formatSteps(best)}` : '',
      false,
    );
  }

  /**
   * The warning while a run's feet are outside its corridor, with a bar of the grace `left`
   * (0..1) before the run is cancelled; 1 or more hides it. Touches the DOM only on a change.
   */
  setAway(left: number): void {
    const pc = left >= 1 ? -1 : Math.max(0, Math.round(left * 100));
    if (pc === this.awayShown) return;
    if (pc < 0 !== this.awayShown < 0) this.tAway.style.display = pc < 0 ? 'none' : '';
    this.awayShown = pc;
    if (pc >= 0) this.tAwayBar.style.width = `${pc}%`;
  }

  /** A finished run's time, held for a few seconds. */
  showResult(
    name: string,
    steps: number,
    best: boolean,
    splits: readonly number[],
    now: number,
  ): void {
    this.timerText(
      `${name}: finish`,
      formatSteps(steps),
      splits.map((s, i) => `CP${i + 1} ${formatSteps(s)}`).join('  '),
      best ? 'new best' : '',
      best,
    );
    this.runKey = '';
    this.timerHold = now + 5000;
  }

  /** Whether a held result is still on screen. */
  holding(now: number): boolean {
    return now < this.timerHold;
  }

  /** The hub prompt (null hides it). */
  setPrompt(text: string | null): void {
    if (!text) {
      if (this.prompt.style.display !== 'none') this.prompt.style.display = 'none';
      return;
    }
    if (this.prompt.dataset.text !== text) {
      this.prompt.dataset.text = text;
      this.prompt.replaceChildren(
        h('button', { class: 'btn', onclick: () => this.onHub?.() }, text),
      );
    }
    if (this.prompt.style.display) this.prompt.style.display = '';
  }

  /**
   * Draws the name tags (CSS px) over runners and the route labels over start gates on one 2D
   * canvas over the game: no element per tag, no strings or layout per frame (text widths are
   * measured once per text).
   */
  setNames(tags: readonly NameTag[], count: number): void {
    const c = this.names,
      ctx = this.namesCtx;
    if (!ctx) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1),
      w = Math.round(c.clientWidth * dpr),
      hgt = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== hgt) {
      c.width = w;
      c.height = hgt;
      this.namesDrawn = -1;
    }
    if (!count && !this.namesDrawn) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    this.namesDrawn = count;
    for (let i = 0; i < count; i++) {
      const t = tags[i]!,
        gate = t.kind === 'gate',
        font = gate ? GATE_FONT : NAME_FONT;
      if (this.namesFont !== font) {
        ctx.font = font;
        this.namesFont = font;
      }
      let tw = this.widths.get(t.text);
      if (tw === undefined) {
        tw = ctx.measureText(t.text).width;
        this.widths.set(t.text, tw);
        if (this.widths.size > 512) this.widths.clear();
      }
      const bw = tw + (gate ? 13 : 12),
        bh = gate ? 17 : 18,
        x = Math.round(t.x - bw / 2),
        y = Math.round(t.y - bh);
      ctx.fillStyle = TAG_BG;
      ctx.fillRect(x, y, bw, bh);
      if (gate) {
        ctx.fillStyle = LEVEL_COLOUR[t.level ?? 1] ?? LEVEL_COLOUR[1]!;
        ctx.fillRect(x, y, 3, bh);
      }
      ctx.fillStyle = gate ? INK : (TAG_COLOUR[t.kind] ?? INK);
      ctx.fillText(t.text, x + (gate ? 8 : 6), y + bh - 5);
    }
  }
}
