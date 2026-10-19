/**
 * The game: content, the simulation of the own runner at 30 steps a second, chunk streaming, the
 * renderer, the HUD and menus, sound, bots, and the online session when a server answers. Offline
 * first: everything works without a server, with the local profile and the sim's observers;
 * online the server's events are the record and the own runner is predicted by the net client.
 * When the server goes away the game carries on offline and keeps trying to come back.
 *
 * The frame path allocates nothing of its own in steady play (no closures, arrays or strings per
 * frame; the HUD touches the DOM only when a text or a whole-pixel position changes).
 */
import {
  CELL,
  CHUNK,
  CHUNK_CELLS,
  Command,
  Key,
  UNITS_PER_PX,
  base64ToBytes,
  chunkKey,
  type ChunkFile,
  type InputCommand,
  type Look,
  type WorldIndex,
} from '@parapet-world/schemas';
import {
  ChunkWorld,
  R,
  copyRunner,
  createRunner,
  createStatics,
  stepRunner,
  type RunnerState,
  type WorldStatics,
} from '@parapet-world/sim';
import { NAME_RE, type GameEvent as ServerEvent, type ProfileView } from '@parapet-world/protocol';
import { createRenderer, type Renderer, type Skin } from '@parapet-world/runtime';
import { createPicture, picture } from './anim.ts';
import { Sound, type SoundFamily } from './audio.ts';
import { createBot, stepBots, type LocalBot } from './bots.ts';
import { GameCamera } from './camera.ts';
import { planClips } from './clips.ts';
import { loadContent, type GameContent, type Rect } from './content.ts';
import { Hud, type NameTag } from './hud.ts';
import { InputSampler } from './input.ts';
import { StepClock } from './loop.ts';
import { Menus, type Leaderboard, type MenuHost } from './menus.ts';
import { Observers, type GameEvent } from './observers.ts';
import { JoinError, OnlineSession } from './online.ts';
import {
  COSTUME_NAMES,
  DIFFICULTY,
  HAIR_NAMES,
  allowedLook,
  difficultyOf,
  formatSteps,
  loadProfile,
  newUnlocks,
  saveProfile,
  type Profile,
  type Settings,
} from './profile.ts';
import { RouteRecorder, cannotBegin, type BotFile } from './recorder.ts';
import { EMPTY_CELLS, ChunkStreamer } from './streamer.ts';
import { TouchPad } from './touch.ts';
import { h, injectStyle } from './ui.ts';

const NAME_LIFT = 72 * UNITS_PER_PX;
/** Main-thread time a frame may spend building chunk meshes, ms (at least one chunk a frame). */
const MESH_BUDGET_MS = 3;
/** Waits between attempts to reach the server again, ms. */
const RECONNECT_MS = [3000, 6000, 12000, 20000, 30000];
const store = (): Storage | null => globalThis.localStorage ?? null;
const params = new URLSearchParams(globalThis.location?.search ?? '');
const unlockName = (kind: string, id: string): string =>
  kind === 'costume'
    ? (COSTUME_NAMES[id as keyof typeof COSTUME_NAMES] ?? id)
    : (HAIR_NAMES[id as keyof typeof HAIR_NAMES] ?? id);

/** A runner other than the own one, ready to draw this frame. */
interface Other {
  name: string;
  look: Look;
  kind: 'player' | 'bot';
  a: RunnerState;
  b: RunnerState;
  alpha: number;
}

export class Game implements MenuHost {
  readonly profile: Profile;
  world!: WorldIndex;
  maxPerspective = 0.15;
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: HTMLDivElement;
  private r!: Renderer;
  private content!: GameContent;
  private sim!: ChunkWorld;
  private statics!: WorldStatics;
  private streamer!: ChunkStreamer;
  private readonly materials = new Map<number, Uint8Array>();
  /** Fetched chunks waiting for their meshes (built within a time budget per frame). */
  private readonly meshQueue: ChunkFile[] = [];
  private readonly input: InputSampler;
  private readonly clock = new StepClock();
  private readonly camera = new GameCamera();
  private readonly hud = new Hud();
  private readonly menus: Menus;
  private readonly touch: TouchPad;
  private readonly sound: Sound;
  private observers!: Observers;
  /** The own runner after the last step and before it (offline arrays, or the net client's). */
  private cur: RunnerState | null = null;
  private prev: RunnerState | null = null;
  private alpha = 0;
  /** The clip each move is drawn with (stand-ins for clips not exported yet). */
  private clipPlan: string[] = [];
  private ownSkin: Skin | null = null;
  private readonly skins = new Map<string, Skin>();
  private readonly pic = createPicture();
  private readonly otherPic = createPicture();
  private readonly tags: NameTag[] = [];
  private tagCount = 0;
  private readonly others: Other[] = [];
  private bots: LocalBot[] = [];
  /** Labels and prompts made once per world, not per frame. */
  private gateLabels: string[] = [];
  private hubPrompts: string[] = [];
  private command: InputCommand | null = null;
  private state: 'loading' | 'title' | 'joining' | 'playing' = 'loading';
  private paused = false;
  private last = 0;
  private lastNonce = -1;
  private lastCycle = 0;
  private lastStep = -1;
  private stalled = false;
  private hubHinted = false;
  private capture: ((code: string) => void) | null = null;
  private readonly dev: boolean;
  private readonly recorder = new RouteRecorder();
  private devEl: HTMLDivElement | null = null;
  private devTimer = 0;
  private fps = 60;
  private online: OnlineSession | null = null;
  private serverNote = 'not tried yet';
  private reconnectTimer = 0;
  private reconnectTry = 0;
  private joining = false;

  constructor(canvas: HTMLCanvasElement, ui: HTMLDivElement) {
    this.canvas = canvas;
    this.ui = ui;
    this.dev = params.has('dev');
    this.profile = loadProfile(store());
    this.input = new InputSampler(this.profile.settings.bindings);
    this.input.onKey = this.onKey;
    this.sound = new Sound(this.profile.settings.volume);
    this.menus = new Menus(this);
    this.touch = new TouchPad(this.input);
    this.touch.onPause = () => this.togglePause();
    this.hud.onHub = () => this.openHub();
    injectStyle();
    ui.append(this.hud.root, this.touch.root, this.touch.corner, this.menus.root);
    if (this.dev) {
      this.devEl = h('div', { class: 'dev' });
      ui.append(this.devEl);
    }
    this.touch.setMode(this.profile.settings.touch);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.paused) this.togglePause();
      // back from hidden: the server has moved on, ask for a fresh keyframe
      if (!document.hidden) this.online?.resync();
    });
  }

  /* ---------- boot ---------- */

  async boot(): Promise<void> {
    const note = h('p', {}, '...'),
      loading = h(
        'div',
        { class: 'screen' },
        h('div', { class: 'card' }, h('h2', {}, 'Loading'), note),
      );
    this.ui.append(loading);
    try {
      this.content = await loadContent(
        (what) => (note.textContent = `Loading ${what}...`),
        params.get('world'),
      );
    } catch (e) {
      note.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
    loading.remove();
    const c = this.content;
    this.world = c.world;
    this.maxPerspective = c.settings.perspective;
    if (this.profile.settings.perspective > c.settings.perspective) {
      this.profile.settings.perspective = c.settings.perspective;
    }
    this.r = createRenderer(this.canvas, {
      settings: { ...c.settings, perspective: this.profile.settings.perspective },
    });
    this.r.setWorld(c.world, c.art);
    for (const clip of c.clips) this.r.addClip(clip);
    const plan = planClips(c.rules, (n) => !!this.r.clip(n), c.plays);
    this.clipPlan = plan.clips;
    if (this.dev && plan.substituted.length) {
      console.info(
        `clips: ${plan.substituted.length} moves drawn with stand-ins until their clips are exported:\n` +
          plan.substituted.map(([m, w, g]) => `  ${m} (${w}) -> ${g}`).join('\n'),
      );
    }
    this.gateLabels = c.world.routes.map((r) => `${r.name} · ${DIFFICULTY[difficultyOf(r)] ?? ''}`);
    this.hubPrompts = c.world.hubs.map((hub) => `${hub.name}: hub menu (E)`);
    this.sim = new ChunkWorld(c.world.bounds);
    this.statics = createStatics(c.world);
    this.streamer = new ChunkStreamer(c.world, c.chunk, {
      load: (file) => this.loadChunk(file),
      loadEmpty: (cx, cy) => this.sim.loadCells(cx, cy, EMPTY_CELLS),
      unload: (cx, cy) => this.unloadChunk(cx, cy),
    });
    this.profile.look = allowedLook(this.profile.look, this.profile.finds.length);
    this.ownSkin = this.skinOf(this.profile.look);
    void this.loadBots();
    // the title screen shows the world behind it, around the start hub
    const hub = c.world.hubs[this.startHub()];
    if (hub) this.camera.snap(hub.spawn[0], hub.spawn[1], hub.facing);
    this.state = 'title';
    this.menus.show('title');
    this.input.enabled = false;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** The baked bot routes, and in development `?bots=N` runners for profiling crowds. */
  private async loadBots(): Promise<void> {
    const files = await Promise.all(
      this.world.bots.map((f) =>
        fetch(f.includes('/') ? f : `bots/${f}`)
          .then((r) => (r.ok ? (r.json() as Promise<BotFile>) : null))
          .catch(() => null),
      ),
    );
    const bots: LocalBot[] = [];
    for (const f of files) {
      const b = f && f.format === 1 ? createBot(f, this.content.rules) : null;
      if (b) bots.push(b);
    }
    const extra = this.dev ? Number(params.get('bots') ?? 0) : 0;
    const hub = this.world.hubs[this.startHub()];
    const looks: Look[] = [
      { hair: 'hairRed', costume: 'tee' },
      { hair: 'hairShort', costume: 'hoodie' },
      { hair: 'hairRed', costume: 'summer' },
      { hair: 'hairShort', costume: 'classic' },
    ];
    for (let i = 0; hub && i < extra; i++) {
      const out = 30 + ((i * 7) % 25),
        file: BotFile = {
          format: 1,
          name: `Bot ${i + 1}`,
          district: hub.district,
          look: looks[i % looks.length]!,
          start: {
            x: hub.spawn[0] + ((i % 9) - 4) * 40 * UNITS_PER_PX,
            y: hub.spawn[1],
            facing: 1,
          },
          runs: [
            { steps: 10 + i, held: 0 },
            { steps: out, held: Key.RIGHT },
            { steps: 20, held: i % 3 ? 0 : Key.UP },
            { steps: out, held: Key.LEFT },
            { steps: 20, held: 0 },
          ],
        };
      const b = createBot(file, this.content.rules);
      if (b) bots.push(b);
    }
    this.bots = bots;
  }

  private loadChunk(file: ChunkFile): void {
    // the simulation needs the cells now; the renderer's mesh can wait a frame or two
    this.sim.load(file);
    this.materials.set(chunkKey(file.cx, file.cy), base64ToBytes(file.materials));
    this.meshQueue.push(file);
  }

  private unloadChunk(cx: number, cy: number): void {
    this.sim.unload(cx, cy);
    this.r.unloadChunk(cx, cy);
    this.materials.delete(chunkKey(cx, cy));
    for (let i = this.meshQueue.length - 1; i >= 0; i--) {
      const f = this.meshQueue[i]!;
      if (f.cx === cx && f.cy === cy) this.meshQueue.splice(i, 1);
    }
  }

  /** Builds queued chunk meshes, nearest to the camera first, within the frame's budget. */
  private buildMeshes(): void {
    const q = this.meshQueue;
    if (!q.length) return;
    const t0 = performance.now(),
      ccx = this.camera.x / CHUNK,
      ccy = this.camera.y / CHUNK;
    do {
      let best = 0,
        bestD = Infinity;
      for (let i = 0; i < q.length; i++) {
        const f = q[i]!,
          d = Math.abs(f.cx + 0.5 - ccx) + Math.abs(f.cy + 0.5 - ccy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const f = q[best]!;
      q[best] = q[q.length - 1]!;
      q.pop();
      this.r.loadChunk(f);
    } while (q.length && performance.now() - t0 < MESH_BUDGET_MS);
  }

  private startHub(): number {
    const n = this.world.hubs.length,
      last = this.profile.lastHub;
    return last >= 0 && last < n ? last : this.world.startHub;
  }

  skinOf(look: Look): Skin | null {
    const key = `${look.costume}/${look.hair}`;
    let s = this.skins.get(key);
    if (s) return s;
    const L = this.content.layers,
      body = L.get('body');
    if (!body) return null;
    const stack = [body];
    const hair = L.get(look.hair),
      costume = L.get(look.costume);
    if (hair) stack.push(hair);
    if (costume) stack.push(costume);
    s = this.r.createSkin(stack);
    this.skins.set(key, s);
    return s;
  }

  /* ---------- the menu host ---------- */

  titleNotes(): string[] {
    const c = this.content,
      lines = [
        c.source === 'city'
          ? 'World: the city'
          : c.source === 'gym'
            ? 'World: the gym rooms'
            : 'World: built-in test world',
        `Server: ${this.online ? this.online.status : this.serverNote}`,
      ];
    for (const n of c.notes) lines.push(n);
    return lines;
  }

  touchActive(): boolean {
    return this.touch.active;
  }

  helpSeen(): void {
    if (this.profile.seenHelp) return;
    this.profile.seenHelp = true;
    saveProfile(store(), this.profile);
  }

  /** Whether this world is one the server plays (the city), or the developer asked to try. */
  private serverWorld(): boolean {
    return !params.has('offline') && (this.content.source === 'city' || params.has('online'));
  }

  /** Play: join the server when one answers, else play offline. */
  play(name: string): void {
    if (this.state !== 'title') return;
    if (!NAME_RE.test(name)) {
      this.hud.toast('A name is 2 to 16 letters, digits, spaces, dots, dashes or underscores');
      return;
    }
    this.profile.name = name;
    saveProfile(store(), this.profile);
    this.sound.start();
    if (!this.serverWorld()) {
      this.serverNote = params.has('offline')
        ? 'offline (by choice)'
        : 'offline (the server plays the city, not this world)';
      this.startOffline();
      return;
    }
    this.state = 'joining';
    this.hud.toast('Looking for the game server...');
    this.join(true);
  }

  /** Tries to join the server; at Play, or later to come back after it went away. */
  private join(atPlay: boolean): void {
    if (this.joining) return;
    this.joining = true;
    OnlineSession.open({
      rules: this.content.rules,
      world: this.sim,
      statics: this.statics,
      token: this.profile.token,
      name: this.profile.name,
    }).then(
      (s) => {
        this.joining = false;
        if (this.state === 'title') {
          // the player went back to the title meanwhile
          s.close();
          return;
        }
        this.reconnectTry = 0;
        if (!atPlay) {
          this.hud.toast('Back online');
          this.hud.dim(0);
          setTimeout(() => this.hud.undim(), 350);
        }
        this.startOnline(s, !atPlay);
      },
      (e: unknown) => {
        this.joining = false;
        const code = e instanceof JoinError ? e.code : 'down';
        this.serverNote =
          code === 'down'
            ? 'offline (no server)'
            : code === 'nameTaken'
              ? 'that name is taken on the server: playing offline'
              : code === 'rules'
                ? 'the server runs another version: reload the page'
                : `offline (${e instanceof Error ? e.message : String(e)})`;
        if (code !== 'down') this.hud.toast(`Server: ${this.serverNote}`);
        if (atPlay) this.startOffline();
        // only an absent server is worth waiting for; a refusal stays a refusal
        if (code === 'down') this.scheduleReconnect();
      },
    );
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    const wait = RECONNECT_MS[Math.min(this.reconnectTry, RECONNECT_MS.length - 1)]!;
    this.reconnectTry++;
    this.reconnectTimer = window.setTimeout(() => {
      if (this.state === 'playing' && !this.online && !this.recorder.recording) this.join(false);
      else if (this.state === 'playing' && !this.online) this.scheduleReconnect();
    }, wait);
  }

  private startOffline(): void {
    const w = this.world,
      hub = w.hubs[this.startHub()];
    const x = hub ? hub.spawn[0] : (w.bounds[0] + w.bounds[2] / 2) * CHUNK,
      y = hub ? hub.spawn[1] : w.bounds[1] * CHUNK;
    this.cur = createRunner(this.content.rules, x, y, hub ? hub.facing : 1);
    this.prev = copyRunner(this.cur);
    this.enterPlay();
  }

  /** Online from Play, or back online mid-game (`rejoin`: the menus and HUD stay as they are). */
  private startOnline(s: OnlineSession, rejoin = false): void {
    this.online = s;
    this.serverNote = 'online';
    this.mergeProfile(s.net.profile);
    this.cur = s.net.own;
    this.prev = s.net.ownPrev;
    s.onEvent = (e, p) => this.serverEvent(e, p);
    s.onBoard = () => {
      if (this.menus.open === 'hub') this.menus.show('hub');
    };
    s.onRecovery = (code) =>
      this.hud.toast(
        `Your name's recovery code: ${code} (write it down to move your name to another device)`,
      );
    s.onLost = (why) => {
      // carry on offline from where the runner is, and keep trying to come back
      this.hud.toast(`${why}: playing offline`);
      const own = this.cur ? copyRunner(this.cur) : null;
      this.online = null;
      this.serverNote = `offline (${why})`;
      if (own) {
        this.cur = own;
        this.prev = copyRunner(own);
      }
      this.clock.reset();
      this.scheduleReconnect();
    };
    if (rejoin) {
      const own = this.cur;
      this.camera.snap(own[R.X]!, own[R.Y]!, own[R.FACING]!);
      this.lastStep = -1;
    } else this.enterPlay();
  }

  private enterPlay(): void {
    const s = this.cur!;
    this.observers = new Observers(
      this.world,
      this.statics,
      new Set(this.profile.finds),
      new Set(this.profile.hubs),
    );
    this.camera.snap(s[R.X]!, s[R.Y]!, s[R.FACING]!);
    this.state = 'playing';
    this.paused = false;
    this.lastStep = -1;
    this.menus.close();
    this.input.enabled = true;
    this.clock.reset();
    this.hud.undim();
    this.hud.setFinds(this.profile.finds.length, this.world.finds.length);
    if (!this.profile.seenHelp) {
      // the first play starts with the controls
      this.input.enabled = false;
      this.menus.show('help');
    }
  }

  /** The server's profile is the record online. */
  private mergeProfile(p: ProfileView | null): void {
    if (!p) return;
    const me = this.profile;
    me.finds = [...p.finds];
    me.hubs = [...p.hubs];
    me.best = { ...p.best };
    me.look = allowedLook(p.look, p.finds.length);
    this.ownSkin = this.skinOf(me.look);
    saveProfile(store(), me);
    this.hud.setFinds(me.finds.length, this.world.finds.length);
  }

  resume(): void {
    this.menus.close();
    if (this.state !== 'playing') return;
    this.paused = false;
    this.input.enabled = true;
    this.input.clear();
    this.clock.reset();
    this.sound.setPaused(false);
  }

  quitToTitle(): void {
    clearTimeout(this.reconnectTimer);
    this.online?.close();
    this.online = null;
    this.state = 'title';
    this.paused = false;
    this.cur = this.prev = null;
    this.recorder.cancel();
    this.input.enabled = false;
    this.hud.setRun(null, 0, [], undefined, Infinity);
    this.hud.setPrompt(null);
    this.hud.setNames(this.tags, 0);
    this.hud.undim();
    this.sound.setPaused(false);
    this.sound.ambience(null);
    this.menus.show('title');
  }

  teleport(hub: number): void {
    if (this.online) this.online.teleport(hub);
    else this.command = { step: 0, kind: Command.TELEPORT, arg: hub };
    this.hud.dim(0);
    setTimeout(() => this.hud.undim(), 300);
    this.resume();
  }

  setLook(look: Look): void {
    this.profile.look = allowedLook(look, this.profile.finds.length);
    this.ownSkin = this.skinOf(this.profile.look);
    saveProfile(store(), this.profile);
    this.online?.setLook(this.profile.look);
  }

  settingsChanged(s: Settings): void {
    this.r?.setSettings({ perspective: Math.min(s.perspective, this.maxPerspective) });
    this.sound.setVolume(s.volume);
    this.touch.setMode(s.touch);
    this.input.bindings = { ...s.bindings };
    saveProfile(store(), this.profile);
  }

  leaderboard(route: number): Leaderboard {
    const r = this.world.routes[route]!;
    const online = this.online?.leaderboard(r.id);
    if (online) return online;
    return { top: [], mine: this.profile.best[r.id], source: 'local' };
  }

  captureKey(cb: (code: string) => void): void {
    this.capture = cb;
  }

  get hubHere(): number {
    return this.state === 'playing' && this.observers ? this.observers.hubHere : -1;
  }

  /* ---------- input outside the runner ---------- */

  private readonly onKey = (code: string, e: KeyboardEvent): void => {
    if (this.capture) {
      const cb = this.capture;
      this.capture = null;
      e.preventDefault();
      cb(code);
      return;
    }
    if (code === 'Escape' || code === 'KeyP') {
      const open = this.menus.open;
      if (open === 'settings' || open === 'help' || (open === 'hub' && code === 'Escape')) {
        if (open === 'help') this.helpSeen();
        this.menus.goBack();
      } else if (this.state === 'playing') this.togglePause();
      return;
    }
    if (this.state !== 'playing' || this.menus.open) return;
    if ((code === 'KeyE' || code === 'Enter') && this.hubHere >= 0) this.openHub();
    if (this.dev && code === 'KeyR') this.toggleRecording();
  };

  private togglePause(): void {
    if (this.state !== 'playing') return;
    if (this.paused || this.menus.open) {
      this.resume();
      return;
    }
    this.paused = true;
    this.input.enabled = false;
    this.input.clear();
    // online the world goes on; only the sound stops
    this.sound.setPaused(true);
    this.menus.show('pause');
  }

  private openHub(): void {
    if (this.hubHere < 0 || this.menus.open) return;
    this.input.enabled = false;
    this.input.clear();
    if (this.online) {
      const district = this.world.hubs[this.hubHere]!.district;
      for (const r of this.world.routes) {
        if (r.district === district) this.online.requestBoard(r.id);
      }
    }
    if (!this.profile.usedHub) {
      this.profile.usedHub = true;
      saveProfile(store(), this.profile);
    }
    this.menus.show('hub');
    this.sound.tick();
  }

  /* ---------- the frame ---------- */

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (dt > 0) this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    this.input.poll();
    if (this.state === 'playing' && this.cur && this.prev) {
      if (this.online) this.onlineSteps(now);
      else if (!this.paused) this.offlineSteps(dt, now);
      this.timerHud(now);
    }
    this.draw(dt, now);
  };

  private offlineSteps(dt: number, now: number): void {
    const n = this.clock.advance(dt),
      rules = this.content.rules,
      cur = this.cur!,
      prev = this.prev!;
    for (let i = 0; i < n; i++) {
      const held = this.input.sample();
      prev.set(cur);
      const ok = stepRunner(cur, held, this.command, this.sim, rules, this.statics);
      if (this.bots.length) stepBots(this.bots, this.sim, rules, this.statics);
      if (!ok) {
        // the chunks around the runner are not in yet: its clock stalls
        this.stalled = true;
        this.clock.reset();
        break;
      }
      this.stalled = false;
      this.command = null;
      if (this.recorder.recording) this.recorder.record(held, cur);
      this.afterStep(cur, now);
    }
    this.alpha = this.stalled ? 1 : this.clock.alpha;
  }

  private onlineSteps(now: number): void {
    const s = this.online!;
    const ran = s.update(now, this.paused ? 0 : this.input.peek());
    if (ran > 0) this.input.consume();
    if (!this.online) return; // the session was lost during the update
    this.alpha = s.net.ownAlpha(now);
    const step = this.cur![R.STEP]!;
    if (step !== this.lastStep) {
      this.lastStep = step;
      this.afterStep(this.cur!, now);
    }
  }

  /** Sounds and the observers after a step of the own runner. */
  private afterStep(s: RunnerState, now: number): void {
    this.moveSounds(s);
    const events = this.observers.step(s, this.content.rules);
    for (let i = 0; i < events.length; i++) this.localEvent(events[i]!, now);
  }

  private timerHud(now: number): void {
    const run = this.observers.run;
    if (run) {
      const route = this.world.routes[run.route]!;
      this.hud.setRun(route.name, run.steps, run.splits, this.profile.best[route.id], now);
    } else this.hud.setRun(null, 0, NO_SPLITS, undefined, now);
    this.hud.setAway(this.observers.graceLeft(this.content.rules));
  }

  /** Sounds of entering moves, and footsteps along the run cycle. */
  private moveSounds(s: RunnerState): void {
    const rules = this.content.rules,
      m = s[R.MOVE]!,
      nonce = s[R.ANIM_NONCE]!;
    if (nonce !== this.lastNonce) {
      this.lastNonce = nonce;
      const name = rules.moveNames[m];
      if (name === 'jump' || name === 'tigerJump') this.sound.jump();
      else if (name === 'landSoft') this.sound.land(false, this.floorSound(s));
      else if (name === 'landHard' || name === 'stumble') this.sound.land(true, this.floorSound(s));
      else if (name === 'roll' || name === 'slideUnder') this.sound.roll();
      else if (m === rules.roles.dead) this.sound.death();
    }
    const stride = rules.stride[m]!;
    if (stride > 0 && s[R.GROUND] !== 0) {
      const c = s[R.CYCLE]! / stride;
      // two footfalls per stride
      if ((this.lastCycle < 0.5 && c >= 0.5) || c < this.lastCycle) {
        this.sound.footstep(this.floorSound(s));
      }
      this.lastCycle = c;
    }
  }

  /** The sound family of the material under the runner's feet. */
  private floorSound(s: RunnerState): SoundFamily {
    const x = s[R.X]! >> 10,
      y = s[R.Y]! >> 10,
      cx = Math.floor(x / CHUNK_CELLS),
      cy = Math.floor(y / CHUNK_CELLS),
      grid = this.materials.get(chunkKey(cx, cy));
    const m = grid ? grid[(y - cy * CHUNK_CELLS) * CHUNK_CELLS + (x - cx * CHUNK_CELLS)]! : 0;
    return this.world.materials[m]?.sound ?? 'concrete';
  }

  /** The local observers' events: offline they are the record, online only presentation. */
  private localEvent(e: GameEvent, now: number): void {
    const w = this.world,
      p = this.profile,
      online = !!this.online;
    switch (e.kind) {
      case 'region': {
        const d = w.districts.find((x) => x.id === e.district);
        if (d) {
          this.hud.showBanner(d.name, 'district');
          this.hud.setWhere(d.name);
          this.sound.ambience(d.ambience || d.id);
        }
        break;
      }
      case 'hub':
        p.lastHub = e.hub;
        saveProfile(store(), p);
        if (!p.usedHub && !this.hubHinted) {
          this.hubHinted = true;
          this.hud.toast(
            this.touch.active
              ? 'A hub: tap the button for teleports, the wardrobe and leaderboards'
              : 'A hub: press E for teleports, the wardrobe and leaderboards',
          );
        }
        break;
      case 'discover':
        if (!online) {
          p.hubs.push(w.hubs[e.hub]!.id);
          saveProfile(store(), p);
          this.hud.toast(`Hub discovered: ${w.hubs[e.hub]!.name}`);
          this.sound.checkpoint();
        }
        break;
      case 'find':
        if (!online) {
          const before = p.finds.length;
          p.finds.push(w.finds[e.find]!.id);
          saveProfile(store(), p);
          this.found(p.finds.length);
          for (const u of newUnlocks(before, p.finds.length)) this.unlocked(u.kind, u.id);
        }
        break;
      case 'routeStart':
        if (!online) this.sound.tick();
        break;
      case 'checkpoint':
        if (!online) this.sound.checkpoint();
        break;
      case 'finish':
        if (!online) {
          const r = w.routes[e.route]!,
            best = p.best[r.id],
            isBest = !best || e.steps < best;
          if (isBest) p.best[r.id] = e.steps;
          saveProfile(store(), p);
          this.finished(r.name, e.steps, isBest, e.splits, now, '');
        }
        break;
      case 'routeCancel':
        if (!online) this.hud.toast(`${w.routes[e.route]!.name}: run cancelled`);
        break;
      case 'death': {
        // a moment to see the fall, then dark (a 0.35 s fade) a little before the respawn
        const dead = (this.content.rules.params.deadSteps ?? 45) * (1000 / 30);
        this.hud.dim(Math.max(200, dead - 600));
        break;
      }
      case 'respawn':
        this.hud.undim();
        break;
      default:
        break;
    }
  }

  /** The server's events: the record online. */
  private serverEvent(e: ServerEvent, p: ProfileView | null): void {
    const w = this.world;
    this.mergeProfile(p);
    const now = performance.now();
    switch (e.kind) {
      case 'hub': {
        const hub = w.hubs.find((x) => x.id === e.hub);
        this.hud.toast(`Hub discovered: ${hub ? hub.name : e.hub}`);
        this.sound.checkpoint();
        break;
      }
      case 'find':
        this.found(this.profile.finds.length, e.total);
        break;
      case 'unlock':
        this.unlocked(e.unlock, e.id);
        break;
      case 'routeStart':
        this.sound.tick();
        break;
      case 'checkpoint':
        this.sound.checkpoint();
        break;
      case 'finish': {
        const r = w.routes.find((x) => x.id === e.route),
          splits = this.observers.run?.splits ?? NO_SPLITS;
        this.finished(
          r ? r.name : e.route,
          e.steps,
          e.best,
          splits,
          now,
          e.rank > 0 ? ` #${e.rank}` : '',
        );
        break;
      }
      case 'cancel': {
        const r = w.routes.find((x) => x.id === e.route);
        this.hud.toast(`${r ? r.name : e.route}: run cancelled`);
        break;
      }
      default:
        break;
    }
  }

  private found(after: number, total = this.world.finds.length): void {
    this.hud.setFinds(after, total);
    this.hud.toast(`Find! ${after} / ${total}`);
    this.sound.find();
  }

  private unlocked(kind: string, id: string): void {
    this.hud.toast(`Unlocked: ${unlockName(kind, id)} (change it in a hub)`);
    setTimeout(() => this.sound.unlock(), 600);
  }

  private finished(
    name: string,
    steps: number,
    best: boolean,
    splits: readonly number[],
    now: number,
    rank: string,
  ): void {
    this.hud.showResult(name, steps, best, splits, now);
    this.hud.toast(`${name}: ${formatSteps(steps)}${best ? ' (best)' : ''}${rank}`);
    this.sound.finish();
  }

  /* ---------- drawing ---------- */

  /** A clip's length in seconds (for clip timing). */
  private readonly clipLen = (c: string): number => this.r.clip(c)?.duration ?? 1;

  private draw(dt: number, now: number): void {
    const r = this.r;
    if (!r) return;
    this.tagCount = 0;
    if (this.state === 'playing' && this.cur && this.prev) {
      const rules = this.content.rules,
        cur = this.cur,
        p = picture(rules, this.prev, cur, this.alpha, this.clipLen, this.pic, this.clipPlan);
      this.camera.update(p.x, p.y, cur[R.VX]!, cur[R.VY]!, p.facing, cur[R.GROUND] !== 0, dt);
      this.streamer.update(
        Math.floor(this.camera.x / CHUNK),
        Math.floor(this.camera.y / CHUNK),
        Math.floor(p.x / CHUNK),
        Math.floor(p.y / CHUNK),
      );
      this.buildMeshes();
      this.collectOthers();
      r.begin(this.camera.x, this.camera.y);
      for (let i = 0; i < this.others.length; i++) {
        const o = this.others[i]!,
          skin = this.skinOf(o.look);
        if (!skin) continue;
        const q = picture(rules, o.a, o.b, o.alpha, this.clipLen, this.otherPic, this.clipPlan);
        r.runner(skin, q.x, q.y, q.facing, q.clip, q.time);
        this.tag(q.x, q.y - NAME_LIFT, o.name, o.kind, 0);
      }
      if (this.ownSkin) r.runner(this.ownSkin, p.x, p.y, p.facing, p.clip, p.time, true);
      this.drawMarkers(now);
      r.end();
      this.gateTags();
      this.tag(p.x, p.y - NAME_LIFT, this.profile.name, 'own', 0);
      const hub = this.observers.hubHere;
      this.hud.setPrompt(hub >= 0 && !this.menus.open ? (this.hubPrompts[hub] ?? null) : null);
      this.hud.setStatus(
        this.stalled ? 'loading the world...' : this.online ? this.online.status : '',
      );
    } else {
      // the title: the world behind the menu, slowly panning
      this.camera.x += dt * 20 * UNITS_PER_PX;
      const cx = Math.floor(this.camera.x / CHUNK),
        cy = Math.floor(this.camera.y / CHUNK);
      this.streamer.update(cx, cy, cx, cy);
      this.buildMeshes();
      r.begin(this.camera.x, this.camera.y);
      r.end();
    }
    this.hud.setNames(this.tags, this.tagCount);
    if (this.devEl && now > this.devTimer) {
      this.devTimer = now + 250;
      this.devInfo();
    }
  }

  /** Online the remote players and bots, offline the local bots. */
  private collectOthers(): void {
    let n = 0;
    if (this.online) {
      const list = this.online.runners;
      for (let i = 0; i < list.length; i++) {
        const o = list[i]!;
        this.putOther(n++, o.name, o.look, o.bot ? 'bot' : 'player', o.a, o.b, o.alpha);
      }
    } else {
      for (let i = 0; i < this.bots.length; i++) {
        const b = this.bots[i]!;
        this.putOther(n++, b.name, b.look, 'bot', b.prev, b.cur, this.alpha);
      }
    }
    this.others.length = n;
  }

  private putOther(
    n: number,
    name: string,
    look: Look,
    kind: Other['kind'],
    a: RunnerState,
    b: RunnerState,
    alpha: number,
  ): void {
    const o = this.others[n] ?? (this.others[n] = { name, look, kind, a, b, alpha });
    o.name = name;
    o.look = look;
    o.kind = kind;
    o.a = a;
    o.b = b;
    o.alpha = alpha;
  }

  /** Route gates (the start gates, and the next gate of the run in progress) and found finds. */
  private drawMarkers(now: number): void {
    const w = this.world,
      m = this.content.markers,
      run = this.observers.run;
    for (let i = 0; i < w.routes.length; i++) {
      const route = w.routes[i]!;
      if (run && run.route === i) {
        const next = run.splits.length;
        if (next < route.checkpoints.length) {
          this.marker(route.checkpoints[next]!, m['gate.checkpoint'], 0.9, 0);
        } else this.marker(route.finish, m['gate.finish'], 0.9, 0);
      } else this.marker(route.start, m['gate.start'], 0.75, 0);
    }
    const bob = Math.sin(now / 320) * 3 * UNITS_PER_PX,
      found = this.profile.finds;
    for (let i = 0; i < w.finds.length; i++) {
      const f = w.finds[i]!;
      if (found.includes(f.id)) this.marker(f.rect, m.find, 0.4, bob);
    }
  }

  private marker(rect: Rect, sprite: Rect | undefined, alpha: number, lift: number): void {
    if (!sprite) return;
    const x = (rect[0] + rect[2] / 2) * CELL,
      y = (rect[1] + rect[3]) * CELL - (sprite[3] / 2) * UNITS_PER_PX - lift;
    this.r.marker(null, sprite[0], sprite[1], sprite[2], sprite[3], x, y, alpha);
  }

  /** A name tag at a world point (units), into the reused tag list. */
  private tag(wx: number, wy: number, text: string, kind: NameTag['kind'], level: number): void {
    const t =
      this.tags[this.tagCount] ??
      (this.tags[this.tagCount] = { x: 0, y: 0, text: '', kind: 'own' });
    this.tagCount++;
    this.r.worldToScreen(wx, wy, t);
    t.text = text;
    t.kind = kind;
    t.level = level;
  }

  /** Each start gate on screen (but the one of the run in progress) says its route and difficulty. */
  private gateTags(): void {
    const w = this.world,
      run = this.observers.run,
      cw = this.canvas.clientWidth,
      ch = this.canvas.clientHeight,
      gate = this.content.markers['gate.start'],
      lift = ((gate ? gate[3] : 64) + 6) * UNITS_PER_PX;
    for (let i = 0; i < w.routes.length; i++) {
      if (run && run.route === i) continue;
      const route = w.routes[i]!,
        s = route.start;
      this.tag(
        (s[0] + s[2] / 2) * CELL,
        (s[1] + s[3]) * CELL - lift,
        this.gateLabels[i]!,
        'gate',
        difficultyOf(route),
      );
      const t = this.tags[this.tagCount - 1]!;
      if (t.x < -100 || t.y < -40 || t.x > cw + 100 || t.y > ch + 40) this.tagCount--;
    }
  }

  /* ---------- developer mode (?dev) ---------- */

  private toggleRecording(): void {
    const s = this.cur;
    if (!s) return;
    if (this.online) {
      this.hud.toast('Record bot routes offline (?dev&offline)');
      return;
    }
    if (!this.recorder.recording) {
      const why = cannotBegin(s, this.content.rules);
      if (why) {
        this.hud.toast(`A bot route starts standing still: ${why}`);
        return;
      }
      this.recorder.begin(s, this.content.rules);
      this.prev?.set(s);
      this.hud.toast('Recording a bot route from here (R stops)');
      return;
    }
    const o = this.observers,
      region = this.world.regions.find(
        (g) =>
          o.cx >= g.rect[0] &&
          o.cy >= g.rect[1] &&
          o.cx < g.rect[0] + g.rect[2] &&
          o.cy < g.rect[1] + g.rect[3],
      ),
      district = region?.district ?? 'world';
    const out = this.recorder.finish({
      name: this.profile.name || 'Bot',
      district,
      look: this.profile.look,
    });
    if (!out) {
      this.hud.toast('No loop: end within a cell of the start, standing, facing the same way');
      return;
    }
    void fetch('__dev/bots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ district, file: out.file }),
    })
      .then((res) => (res.ok ? res.json() : res.text().then((t) => Promise.reject(new Error(t)))))
      .then(
        (j: { file: string }) => this.hud.toast(`Saved ${j.file} (${out.trim.steps} steps)`),
        (e: unknown) =>
          this.hud.toast(`Saving failed: ${e instanceof Error ? e.message : String(e)}`),
      );
  }

  private devInfo(): void {
    const s = this.cur,
      el = this.devEl!,
      rules = this.content?.rules;
    const lines = [`${this.fps.toFixed(0)} fps`];
    if (s && rules) {
      lines.push(
        `step ${s[R.STEP]}  ${rules.moveNames[s[R.MOVE]!]}  x ${(s[R.X]! / CELL).toFixed(2)} y ${(s[R.Y]! / CELL).toFixed(2)}`,
        `vx ${s[R.VX]} vy ${s[R.VY]}  chunks ${this.streamer.loadedCount}  bots ${this.bots.length}${this.stalled ? '  STALLED' : ''}`,
      );
    }
    if (this.r) lines.push(`${this.r.stats.drawCalls} draws, ${this.r.stats.triangles} tris`);
    lines.push(
      this.recorder.recording
        ? `REC ${this.recorder.length} steps (R stops)`
        : 'R records a bot route',
    );
    el.textContent = lines.join('\n');
    el.classList.toggle('rec', this.recorder.recording);
  }

  /** For checks in the browser. */
  debug(): {
    state: RunnerState | null;
    renderer: Renderer;
    profile: Profile;
    camera: GameCamera;
    online: OnlineSession | null;
  } {
    return {
      state: this.cur,
      renderer: this.r,
      profile: this.profile,
      camera: this.camera,
      online: this.online,
    };
  }
}

const NO_SPLITS: readonly number[] = [];
