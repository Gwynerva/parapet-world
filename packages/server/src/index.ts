/**
 * @parapet-world/server: the game server. `main.ts` runs it; the rest is importable for tests and
 * tools (the core `GameServer` has no sockets or timers).
 */
export { GameServer, Session, type Connection, type GameServerOptions } from './game.ts';
export { ServerRunner, FILL_AFTER, ZERO_AFTER, MAX_AHEAD, RING } from './runner.ts';
export { Profiles, profileView, lookAllowed, unlocked, type Profile } from './profiles.ts';
export { Boards, BOARD_SIZE } from './boards.ts';
export { MemoryStorage, FileStorage, type Storage } from './storage.ts';
export {
  parseBotRoute,
  checkBotRoute,
  botStart,
  type BotRoute,
  type BotRouteFile,
  type RouteCheck,
} from './bots.ts';
export { loadContent, type LoadedContent } from './content.ts';
export { createObserverFor, type RunnerObserver, type SimEvent } from './observe.ts';
export { staticHandler } from './http.ts';
