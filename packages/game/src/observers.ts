/**
 * Observers: what a runner's step-by-step state means for the game. The record (hub discoveries,
 * finds, time trials) comes from the simulation's own observer (`observe` in the sim package, the
 * same the server runs), so offline and online agree on what was touched; the game adds what only
 * presentation needs: the region and district the runner is in, and the hub area it stands in.
 * Online the server's events are the record and these drive only the presentation.
 */
import type { CellRect, WorldIndex } from '@parapet-world/schemas';
import {
  O,
  R,
  createObserver,
  observe,
  runnerCellX,
  runnerCellY,
  type Ruleset,
  type RunnerState,
  type WorldStatics,
} from '@parapet-world/sim';

export type GameEvent =
  | { kind: 'region'; region: number; district: string }
  /** The runner entered a hub's area. */
  | { kind: 'hub'; hub: number }
  /** A hub discovered for the first time. */
  | { kind: 'discover'; hub: number }
  | { kind: 'hubLeave'; hub: number }
  | { kind: 'find'; find: number }
  | { kind: 'routeStart'; route: number }
  | { kind: 'checkpoint'; route: number; index: number; steps: number }
  | { kind: 'finish'; route: number; steps: number; splits: number[] }
  | { kind: 'routeCancel'; route: number }
  | { kind: 'death' }
  | { kind: 'respawn' };

/** Steps outside the corridor a run survives when the ruleset has no `corridorGrace` (the sim's). */
const CORRIDOR_GRACE = 20;

const inRect = (r: CellRect, cx: number, cy: number): boolean =>
  cx >= r[0] && cy >= r[1] && cx < r[0] + r[2] && cy < r[1] + r[3];

/** A time trial in progress. */
export interface RouteRun {
  route: number;
  /** The runner's step at the start gate. */
  from: number;
  /** Steps since the start gate. */
  steps: number;
  /** Split times at the checkpoints passed so far, in steps. */
  splits: number[];
}

export class Observers {
  private readonly world: WorldIndex;
  private readonly statics: WorldStatics;
  /** The simulation's observer state (`OBSERVER_WORDS` words, the same the server keeps). */
  readonly sim = createObserver();
  private readonly out: GameEvent[] = [];
  private region = -1;
  private hub = -1;
  private readonly found: Set<string>;
  private readonly discovered: Set<string>;
  /** The time trial being run, if any. */
  run: RouteRun | null = null;
  /** The cell the runner's feet are in after the last step. */
  cx = 0;
  cy = 0;

  /** `found` and `discovered` are the profile's sets (ids), updated as events happen. */
  constructor(
    world: WorldIndex,
    statics: WorldStatics,
    found: Set<string>,
    discovered: Set<string>,
  ) {
    this.world = world;
    this.statics = statics;
    this.found = found;
    this.discovered = discovered;
  }

  /**
   * The events of one step (call after every step the own runner ran). The array is reused by
   * the next call.
   */
  step(s: RunnerState, rules: Ruleset): GameEvent[] {
    const out = this.out,
      w = this.world,
      cx = runnerCellX(s),
      cy = runnerCellY(s),
      step = s[R.STEP]!;
    out.length = 0;
    this.cx = cx;
    this.cy = cy;
    // regions and their districts
    let region = -1;
    for (let i = 0; i < w.regions.length; i++) {
      if (inRect(w.regions[i]!.rect, cx, cy)) {
        region = i;
        break;
      }
    }
    if (region !== this.region) {
      const before = this.region >= 0 ? w.regions[this.region]!.district : null;
      this.region = region;
      const r = w.regions[region];
      if (r && r.district !== before) out.push({ kind: 'region', region, district: r.district });
    }
    // the hub area the feet stand in (the hub menu)
    let hub = -1;
    for (let i = 0; i < w.hubs.length; i++) {
      if (inRect(w.hubs[i]!.rect, cx, cy)) {
        hub = i;
        break;
      }
    }
    if (hub !== this.hub) {
      if (this.hub >= 0) out.push({ kind: 'hubLeave', hub: this.hub });
      this.hub = hub;
      if (hub >= 0) out.push({ kind: 'hub', hub });
    }
    // the record, from the simulation's observer
    if (this.run) this.run.steps = step - this.run.from;
    for (const e of observe(this.sim, s, rules, this.statics)) {
      switch (e.kind) {
        case 'hub': {
          const id = w.hubs[e.index]?.id;
          if (id !== undefined && !this.discovered.has(id)) {
            this.discovered.add(id);
            out.push({ kind: 'discover', hub: e.index });
          }
          break;
        }
        case 'find': {
          const id = w.finds[e.index]?.id;
          if (id !== undefined && !this.found.has(id)) {
            this.found.add(id);
            out.push({ kind: 'find', find: e.index });
          }
          break;
        }
        case 'routeStart':
          if (this.run && this.run.route !== e.index) {
            out.push({ kind: 'routeCancel', route: this.run.route });
          }
          this.run = { route: e.index, from: e.step, steps: 0, splits: [] };
          out.push({ kind: 'routeStart', route: e.index });
          break;
        case 'checkpoint':
          this.run?.splits.push(e.steps);
          out.push({ kind: 'checkpoint', route: e.index, index: e.gate - 1, steps: e.steps });
          break;
        case 'finish':
          out.push({
            kind: 'finish',
            route: e.index,
            steps: e.steps,
            splits: this.run?.splits ?? [],
          });
          this.run = null;
          break;
        case 'routeCancel':
          out.push({ kind: 'routeCancel', route: e.index });
          this.run = null;
          break;
        case 'death':
          out.push({ kind: 'death' });
          break;
        case 'respawn':
          out.push({ kind: 'respawn' });
          break;
      }
    }
    return out;
  }

  /**
   * While the run's feet are outside its corridor, the share of the grace left before the run is
   * cancelled (just under 1 on the first step out, near 0 on the last); 1 inside or with no run.
   */
  graceLeft(rules: Ruleset): number {
    const out = this.run ? this.sim[O.OUTSIDE]! : 0;
    if (out <= 0) return 1;
    const grace = rules.params.corridorGrace ?? CORRIDOR_GRACE;
    return Math.max(0, (grace + 1 - out) / (grace + 1));
  }

  /** The hub whose area the runner stands in, or -1. */
  get hubHere(): number {
    return this.hub;
  }
}
