/**
 * @parapet-world/sim: the deterministic integer simulation of runners, shared by the browser and
 * the server. See README.md for the API, the state layout and the determinism rules.
 */
export { R, STATE_WORDS, HASHED_WORDS, AGE_MAX } from './layout.ts';
export {
  createRunner,
  stepRunner,
  copyRunner,
  hashRunner,
  hashRunnerAt,
  enterRole,
  runnerReady,
  runnerCellX,
  runnerCellY,
  touchesMissing,
  simDebug,
  MAX_HOPS,
  type RunnerState,
} from './step.ts';
export {
  loadRuleset,
  SIM_VERSION,
  BODY_PARAMS,
  ROLE_NAMES,
  type Ruleset,
  type RulesetSource,
  type MoveSource,
  type TransitionSource,
  type EffectSource,
  type RoleName,
} from './ruleset.ts';
export {
  PREDICATES,
  EFFECTS,
  PREDICATE_NAMES,
  EFFECT_NAMES,
  FLAG,
  KEY_NAMES,
  type FlagName,
  type PredicateName,
  type EffectName,
} from './registry.ts';
export { ChunkWorld, GridWorld, gridChunks, type CellReader, type ChunkBounds } from './world.ts';
export {
  createStatics,
  hubForCell,
  hubAtCell,
  hubCount,
  regionCount,
  routeCount,
  findCount,
  NO_STATICS,
  HUB_WORDS,
  REGION_WORDS,
  ROUTE_WORDS,
  type WorldStatics,
  type StaticsSource,
} from './statics.ts';
export {
  encodeInputLog,
  decodeInputLog,
  appendInput,
  inputLength,
  replayRunner,
  type ReplayResult,
} from './input.ts';
export { runnerView, isDead, type RunnerView } from './view.ts';
export {
  observe,
  createObserver,
  copyObserver,
  createRunnerObserver,
  type SimEvent,
  type RunnerObserver,
  ObserverEvent,
  OBSERVER_WORDS,
  O,
  type WorldEvent,
  type ObserverEventKind,
} from './observers.ts';
export { fnvWord, fnvWords, fnvString, FNV_OFFSET } from './hash.ts';
export { findFloor, sweepX, sweepUp, boxHitsSolid, boxHasClass, cellAt } from './collide.ts';
