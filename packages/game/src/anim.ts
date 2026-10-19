/**
 * From simulation states to what the renderer draws: the anchor interpolated between the last two
 * steps, and the clip with its time. The clip restarts when the move is entered again (the
 * state's animation nonce changes). Timing follows the move: a timed move plays its whole clip
 * over its duration, a `cycle` move (running) follows the distance travelled, a move with a `loop`
 * follows its loop, anything else plays at the clip's own speed from the move's first step.
 */
import { CELL, STEPS_PER_SECOND } from '@parapet-world/schemas';
import { FLAG, R, type Ruleset, type RunnerState } from '@parapet-world/sim';

/** A jump of the anchor larger than this between two steps is not interpolated (teleports). */
const NO_LERP = 2 * CELL;

export interface RunnerPicture {
  x: number;
  y: number;
  facing: number;
  clip: string;
  /** Seconds into the clip. */
  time: number;
}

/** How a move drives its clip. */
type Timing = 'progress' | 'cycle' | 'elapsed';

function timing(rs: Ruleset, s: RunnerState): Timing {
  const m = s[R.MOVE]!;
  if (s[R.DUR]! > 0) return 'progress';
  if ((rs.flags[m]! & FLAG.cycle) !== 0 && rs.stride[m]! > 0) return 'cycle';
  if (rs.loop[m]! > 0) return 'progress';
  return 'elapsed';
}

/** The share of the move's clip at a state: progress 0..1, or steps for elapsed timing. */
function position(rs: Ruleset, s: RunnerState, t: Timing): number {
  const m = s[R.MOVE]!;
  if (t === 'cycle') return s[R.CYCLE]! / rs.stride[m]!;
  if (t === 'elapsed') return s[R.TIMER]!;
  const dur = s[R.DUR]!;
  if (dur > 0) return Math.min(1, s[R.TIMER]! / dur);
  const loop = rs.loop[m]!;
  return (s[R.TIMER]! % loop) / loop;
}

/**
 * The picture of a runner at `alpha` (0..1) between its state before the last step (`prev`) and
 * after it (`cur`). `duration(clip)` gives a clip's length in seconds (0 when unknown); `clips`
 * overrides the clip per move index (stand-ins for clips not exported yet, see `clips.ts`).
 */
export function picture(
  rs: Ruleset,
  prev: RunnerState,
  cur: RunnerState,
  alpha: number,
  duration: (clip: string) => number,
  out: RunnerPicture,
  clips: readonly string[] = rs.clips,
): RunnerPicture {
  const dx = cur[R.X]! - prev[R.X]!,
    dy = cur[R.Y]! - prev[R.Y]!,
    far = Math.abs(dx) > NO_LERP || Math.abs(dy) > NO_LERP;
  out.x = far ? cur[R.X]! : prev[R.X]! + dx * alpha;
  out.y = far ? cur[R.Y]! : prev[R.Y]! + dy * alpha;
  out.facing = cur[R.FACING]! < 0 ? -1 : 1;
  const m = cur[R.MOVE]!;
  out.clip = clips[m] ?? rs.clips[m]!;
  const t = timing(rs, cur),
    same = prev[R.ANIM_NONCE] === cur[R.ANIM_NONCE] && prev[R.MOVE] === m,
    b = position(rs, cur, t);
  // a move entered in the last step starts from its beginning (a cycle keeps its distance)
  let a = same ? position(rs, prev, t) : t === 'cycle' ? b : 0;
  let v: number;
  if (t === 'cycle') {
    if (b < a) a -= 1;
    v = a + (b - a) * alpha;
    v -= Math.floor(v);
  } else if (t === 'progress' && cur[R.DUR]! <= 0) {
    // a loop: wrap like a cycle
    let bb = b;
    if (bb < a) bb += 1;
    v = a + (bb - a) * alpha;
    v -= Math.floor(v);
  } else v = a + (b - a) * alpha;
  const d = duration(out.clip);
  out.time = t === 'elapsed' ? v / STEPS_PER_SECOND : v * d;
  return out;
}

export const createPicture = (): RunnerPicture => ({ x: 0, y: 0, facing: 1, clip: '', time: 0 });
