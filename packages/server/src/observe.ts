/**
 * The simulation's observers (gates, finds, hubs, deaths, respawns) as the server consumes them:
 * one `RunnerObserver` per runner, fed after every step that ran. They live in the sim so the
 * client's HUD and the server's records come from the same code.
 */
export {
  createRunnerObserver as createObserverFor,
  type RunnerObserver,
  type SimEvent,
} from '@parapet-world/sim';
