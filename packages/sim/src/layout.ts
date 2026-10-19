/**
 * The runner's state: one flat `Int32Array`, so copying, hashing and snapshots are loops over
 * integers. Positions are world units (1 px = 32 units, 1 cell = 1024), y grows downward, the
 * position is the feet point (the bottom centre of the body box). Velocities are units per step.
 */
export const R = {
  /** Steps taken since the runner was created. */
  STEP: 0,
  X: 1,
  Y: 2,
  VX: 3,
  VY: 4,
  /** 1 facing right, -1 facing left. */
  FACING: 5,
  /** Index of the current move in the ruleset. */
  MOVE: 6,
  /** A small sub-state number effects may set (`setPhase`); 0 on entry. */
  PHASE: 7,
  /** Steps spent in the current move (0 on the step it was entered). */
  TIMER: 8,
  /** Duration of the current move in steps, resolved at entry (-1 until a transition). */
  DUR: 9,
  /** Moves entered during the last step (instant chains are capped). */
  HOPS: 10,
  /** Keys held during the last step (`Key` bits). */
  HELD: 11,
  PREV_HELD: 12,
  /** Steps since each key went down (LEFT, RIGHT, UP, DOWN, ACTION); `AGE_MAX` once consumed. */
  AGE_LEFT: 13,
  AGE_RIGHT: 14,
  AGE_UP: 15,
  AGE_DOWN: 16,
  AGE_ACTION: 17,
  /** Held intent: -1, 0 or 1 along x (left/right) and y (up/down). */
  WANT_X: 18,
  WANT_Y: 19,
  /** The collision class plus one of the floor under the feet, 0 when airborne. */
  GROUND: 20,
  /** The floor's slope in world terms: 1 rises to the right (`/`), -1 rises to the left (`\`). */
  SLOPE: 21,
  /** -1 or 1 when a wall stopped horizontal motion during the last step, else 0. */
  WALL: 22,
  /** 1 when a ceiling stopped upward motion during the last step. */
  HEAD: 23,
  /** The grip anchor of hanging and climbing moves (world units) and its collision class. */
  GRIP_X: 24,
  GRIP_Y: 25,
  GRIP_KIND: 26,
  /** Vertical speed at the last landing. */
  LAND_VY: 27,
  /** Steps since the feet last touched a floor (saturating). */
  AIR_STEPS: 28,
  /** Speeds stored by `storeSpeed` for later moves. */
  SPEED: 29,
  SPEED_Y: 30,
  /** Distance travelled in `cycle` moves, wrapped at the move's stride (animation sync). */
  CYCLE: 31,
  /** Steps left during which one-way floors are ignored (dropping through). */
  DROP: 32,
  /** The speed a wall took away during the last step (|vx| before the block), else 0. */
  IMPACT: 33,
  /** Steps left during which ledges, ladders, poles and bars cannot be grabbed. */
  LOCK: 34,
  /** Scratch words of the current move (glides keep their start point in S0, S1 and lift in S2). */
  S0: 35,
  S1: 36,
  S2: 37,
  S3: 38,
  /** Incremented on every move entry so clips restart; excluded from the hash. */
  ANIM_NONCE: 39,
} as const;

export const STATE_WORDS = 40;
/** Words covered by the runner hash: everything but `ANIM_NONCE`. */
export const HASHED_WORDS = R.ANIM_NONCE;
/** Press age of a key that is not pressed (or whose press was consumed). */
export const AGE_MAX = 255;
export const AIR_MAX = 1 << 20;

/** Key index order of the `AGE_*` words: LEFT, RIGHT, UP, DOWN, ACTION. */
export const AGE_BASE = R.AGE_LEFT;
export const KEY_COUNT = 5;
