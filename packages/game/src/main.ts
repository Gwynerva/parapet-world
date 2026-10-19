/**
 * Entry point of the game page: the canvas, the UI layer and the game. `?world=city|gym|test`
 * picks the world, `?offline` skips the server, `?online` tries the server with any world (the
 * server plays its own `world.json`), `?dev` shows developer info and the bot route recorder.
 */
import { Game } from './app.ts';

const canvas = document.createElement('canvas');
canvas.id = 'view';
const ui = document.createElement('div');
ui.id = 'ui';
document.body.append(canvas, ui);

const game = new Game(canvas, ui);
(globalThis as unknown as { game: Game }).game = game;
void game.boot();
