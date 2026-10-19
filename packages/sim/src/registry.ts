/**
 * Registries of the named predicates (transition conditions) and effects (velocity and position
 * changes) that the move table is compiled against. A name's id is its position here (`P`, `E`);
 * the step code switches on those ids. Arguments are integers (literals or `$param` names) or keys.
 *
 * Keys: LEFT, RIGHT, UP, DOWN, ACTION are absolute; FWD and BACK resolve against the facing.
 */
export type ArgKind = 'int' | 'key';

export const KEY_NAMES = ['LEFT', 'RIGHT', 'UP', 'DOWN', 'ACTION', 'FWD', 'BACK'] as const;
export const K = { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3, ACTION: 4, FWD: 5, BACK: 6 } as const;

/** Predicates and their arguments; `!name` negates. See the README for what each one reads. */
export const PREDICATES = {
  true: [],
  onGround: [],
  /** The key went down this step (and the press was not consumed). */
  pressed: ['key'],
  /** The key went down at most n steps ago (and the press was not consumed): buffering. */
  recent: ['key', 'int'],
  held: ['key'],
  /** Held without its opposite (LEFT/RIGHT, UP/DOWN, FWD/BACK). */
  want: ['key'],
  /** At least n steps in the move. */
  timer: ['int'],
  /** A timed move has reached its duration. */
  ended: [],
  phase: ['int'],
  /** |vx| above / below a speed. */
  speedAbove: ['int'],
  speedBelow: ['int'],
  /** Velocity along the facing above / below a speed. */
  forwardAbove: ['int'],
  forwardBelow: ['int'],
  vyAbove: ['int'],
  vyBelow: ['int'],
  landedFaster: ['int'],
  airSteps: ['int'],
  /** The body touches a KILL cell. */
  inKill: [],
  /** The standing body fits at the current position. */
  canStand: [],
  /** Solid within n units ahead of / behind the body (above the toes). */
  wallAhead: ['int'],
  wallBehind: ['int'],
  /** A wall stopped forward motion during the last step. */
  wallContact: [],
  /** The wall that stopped forward motion took at least this speed. */
  impactAbove: ['int'],
  headBlocked: [],
  /** The floor rises / falls in the facing direction. */
  slopeUp: [],
  slopeDown: [],
  /** Standing on a one-way floor (TOP or BAR). */
  onOneWay: [],
  /** Grips are locked for a few steps after letting go of one. */
  gripLocked: [],
  /** Solid within d units ahead at head height (a wall to run up, not a crate). */
  highWallAhead: ['int'],
  /** A wall stopped the body only below maxH above the feet (a knee-high obstacle: trips). */
  lowWallAhead: ['int'],
  /** A low ceiling within d units ahead that the crouched body passes under. */
  ceilingAhead: ['int'],
  /** An obstacle within reach ahead, more than stepUp and at most maxH high, room above it. */
  obstacleAhead: ['int', 'int'],
  /** An obstacle to vault: within reach, at most maxH high and maxLen cells long, room beyond. */
  vaultAhead: ['int', 'int', 'int'],
  /** A grabbable ledge corner within reach ahead, between low and high above the feet. */
  ledgeAhead: ['int', 'int', 'int'],
  /** As `ledgeAhead`, with room to stand on top of the ledge (halfWidth + 2 px past its corner). */
  ledgeTopAhead: ['int', 'int', 'int'],
  /** The standing body fits on top of the gripped ledge, dx past its corner. */
  ledgeRoom: ['int'],
  /** A ladder in the centre column, from the body's middle to just below the feet. */
  ladderHere: [],
  /** The ladder continues at the head. */
  ladderAtHead: [],
  /** The ladder's top is at most reach above the feet, with a floor to step onto beside it. */
  ladderTop: ['int'],
  /** A pole line within reach of the centre at the hands. */
  poleHere: ['int'],
  /** The gripped pole continues at the hands. */
  poleAtHands: [],
  /** A bar over the centre between low and high above the feet. */
  barHere: ['int', 'int'],
  /** The stored speed (`storeSpeed`, grips) is above a speed. */
  storedAbove: ['int'],
} as const satisfies Record<string, readonly ArgKind[]>;

/** Effects and their arguments; each is `[name, ...args]` in a list. */
export const EFFECTS = {
  /** Velocity along the facing moves toward speed by accel per step (never overshoots). */
  accelToward: ['int', 'int'],
  /** vx moves toward 0 by decel per step. */
  decelTo0: ['int'],
  /** Air steering: toward the facing up to max when it is held (never slowing a faster jump),
   *  braking toward 0 when the other side is held. */
  airControl: ['int', 'int'],
  /** Velocity set or added, x along the facing. */
  setVX: ['int'],
  setVY: ['int'],
  addVX: ['int'],
  addVY: ['int'],
  /** v = v * n / 256, rounded toward zero. */
  scaleVX: ['int'],
  scaleVY: ['int'],
  /** Velocity along the facing at least / at most a speed. */
  minForward: ['int'],
  maxForward: ['int'],
  /** vy = -(base + |vx| * per256 / 256); leaves the floor. */
  jump: ['int', 'int'],
  flipFacing: [],
  /** Face the held direction, if any. */
  faceWant: [],
  zeroV: [],
  /** Remember |vx| and vy; restore |vx| along the facing. */
  storeSpeed: [],
  restoreSpeed: [],
  setPhase: ['int'],
  /** Ignore one-way floors for n steps. */
  dropThrough: ['int'],
  /** Move to the spawn point of the hub of the region the runner is in. */
  respawn: [],
  /** vy = -vy, only when on the floor (a standing trick's take-off). */
  hop: ['int'],
  /** vy = min(vy, v). */
  maxVY: ['int'],
  /** Grips cannot be grabbed for n steps. */
  lockGrips: ['int'],
  /** Up a wall: vy = -(base + max(|vx|, impact) * per256 / 256). */
  climbJump: ['int', 'int'],
  /** Grip the ledge `ledgeAhead` finds (same arguments); the glide starts here. */
  grabLedge: ['int', 'int', 'int'],
  /** Grip the ladder `ladderHere` finds (its centre line). */
  grabLadder: [],
  /** Grip the pole `poleHere` finds; stores the speed. */
  grabPole: ['int'],
  /** Grip the bar `barHere` finds; stores the speed. */
  grabBar: ['int', 'int'],
  /** Aim a vault at the landing `vaultAhead` finds (same arguments); stores the speed. */
  vaultStart: ['int', 'int', 'int'],
  /** Aim at the floor beside the ladder's top (`ladderTop`), turning to face it. */
  ladderExit: [],
  /** Over the move's duration, from the entry point to the grip + (dx along the facing, dy),
   *  lifted on an arc by `lift` (plus a vault's own lift). */
  glide: ['int', 'int', 'int'],
  /** At the grip + (dx along the facing, dy), still. */
  hold: ['int', 'int'],
  /** x at the grip + dx along the facing (vertical grips). */
  alignGrip: ['int'],
  /** Ladder climbing: up while UP is held (and the ladder goes on), down while DOWN is held. */
  climbWant: ['int', 'int'],
} as const satisfies Record<string, readonly ArgKind[]>;

export type PredicateName = keyof typeof PREDICATES;
export type EffectName = keyof typeof EFFECTS;

function ids<T extends string>(names: readonly T[]): Readonly<Record<T, number>> {
  const out = {} as Record<T, number>;
  for (let i = 0; i < names.length; i++) out[names[i]!] = i;
  return out;
}

export const PREDICATE_NAMES = Object.keys(PREDICATES) as PredicateName[];
export const EFFECT_NAMES = Object.keys(EFFECTS) as EffectName[];
/** Predicate ids by name. */
export const P = ids(PREDICATE_NAMES);
/** Effect ids by name. */
export const E = ids(EFFECT_NAMES);

/** Move flags. */
export const FLAG = {
  /** Feet follow the floor (slopes, small steps); leaving it is `!onGround`. */
  ground: 1,
  noGravity: 2,
  noCollide: 4,
  /** Facing effects are ignored. */
  lockFacing: 8,
  /** Entering the move consumes no presses. */
  keepPresses: 16,
  /** BACK reads as neither held nor pressed (inherited turn transitions stay quiet). */
  noTurn: 32,
  /** The runner hangs from its grip anchor (the clip is aligned to the hands). */
  anchorHands: 64,
  /** The low body box (rolls, slides). */
  crouch: 128,
  /** Distance travelled drives the clip (`stride`). */
  cycle: 256,
} as const;
export type FlagName = keyof typeof FLAG;
