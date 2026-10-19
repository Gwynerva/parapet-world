/**
 * The online session: a WebSocket to `/ws` (proxied to the game server in development) driving a
 * `NetClient` from `@parapet-world/net`. The game joins when Play is pressed and a server answers;
 * otherwise, or when the connection drops, it plays offline with the local profile.
 */
import { NetClient } from '@parapet-world/net';
import type { BoardEntry, GameEvent as ServerEvent, ProfileView } from '@parapet-world/protocol';
import type { Look } from '@parapet-world/schemas';
import {
  R,
  type CellReader,
  type Ruleset,
  type RunnerState,
  type WorldStatics,
} from '@parapet-world/sim';
import type { Leaderboard } from './menus.ts';

/** Another runner to draw (a player or a bot), with its own interpolation. */
export interface OtherRunner {
  id: number;
  name: string;
  look: Look;
  bot: boolean;
  a: RunnerState;
  b: RunnerState;
  alpha: number;
}

export interface OnlineOptions {
  rules: Ruleset;
  world: CellReader;
  statics: WorldStatics;
  token: string;
  name: string;
  /** How long to wait for the server's welcome, ms. */
  timeout?: number;
}

/** Why joining failed: no server, or the server's answer (`nameTaken`, `rules`, ...). */
export class JoinError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const socketUrl = (): string =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`;

export class OnlineSession {
  readonly net: NetClient;
  private readonly ws: WebSocket;
  private readonly boards = new Map<string, Leaderboard>();
  private readonly others: OtherRunner[] = [];
  /** Set when the socket closes or the server ends the session. */
  lost = false;
  private statusCount = -1;
  private statusText = '';
  onEvent: ((e: ServerEvent, profile: ProfileView | null) => void) | null = null;
  onBoard: ((route: string) => void) | null = null;
  onRecovery: ((code: string) => void) | null = null;
  onLost: ((why: string) => void) | null = null;

  private constructor(ws: WebSocket, net: NetClient) {
    this.ws = ws;
    this.net = net;
    net.onEvent = (e, p) => this.onEvent?.(e, p);
    net.onRecovery = (c) => this.onRecovery?.(c);
    net.onBoard = (route: string, top: BoardEntry[], mine: number | null) => {
      this.boards.set(route, { top, mine: mine ?? undefined, source: 'server' });
      this.onBoard?.(route);
    };
  }

  /** Connects and joins; resolves once the server's welcome and own keyframe are in. */
  static open(o: OnlineOptions): Promise<OnlineSession> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(socketUrl());
      } catch (e) {
        reject(new JoinError('down', String(e)));
        return;
      }
      ws.binaryType = 'arraybuffer';
      const net = new NetClient({
        rules: o.rules,
        world: o.world,
        statics: o.statics,
        token: o.token,
        name: o.name,
        transport: {
          send: (d) => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(d as string | ArrayBufferView<ArrayBuffer>);
          },
        },
      });
      const session = new OnlineSession(ws, net);
      let done = false;
      const fail = (code: string, msg: string): void => {
        if (done) return;
        done = true;
        clearInterval(poll);
        try {
          ws.close();
        } catch {
          // already closed
        }
        reject(new JoinError(code, msg));
      };
      const timer = setTimeout(() => fail('down', 'the server did not answer'), o.timeout ?? 4000);
      // the welcome sets the phase; the own runner arrives with the first keyframe
      const poll = setInterval(() => {
        if (net.error) {
          clearTimeout(timer);
          fail(net.error.code, net.error.message);
        } else if (
          net.phase === 'joined' &&
          net.profile &&
          (net.own[R.DUR] !== 0 || net.own[R.X] !== 0)
        ) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearInterval(poll);
          resolve(session);
        }
      }, 50);
      ws.onopen = () => net.start();
      ws.onmessage = (e: MessageEvent) =>
        net.receive(
          typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer),
          performance.now(),
        );
      ws.onerror = () => fail('down', 'no game server');
      ws.onclose = () => {
        if (!done) {
          clearTimeout(timer);
          fail('down', 'no game server');
          return;
        }
        session.lost = true;
        session.onLost?.('the connection to the server was lost');
      };
    });
  }

  /** Steps the own runner to the server clock with the held keys; returns the steps run. */
  update(now: number, held: number): number {
    if (this.net.phase === 'closed' && !this.lost) {
      this.lost = true;
      this.onLost?.(this.net.error?.message ?? 'the server ended the session');
    }
    const ran = this.net.update(now, held);
    // the remote runners' frames for this frame, built once
    let n = 0;
    for (const r of this.net.remotes.values()) {
      const f = this.net.remoteFrame(r);
      const o =
        this.others[n] ??
        (this.others[n] = { id: 0, name: '', look: r.look, bot: false, a: f.a, b: f.b, alpha: 0 });
      o.id = r.id;
      o.name = r.name;
      o.look = r.look;
      o.bot = r.bot;
      o.a = f.a;
      o.b = f.b;
      o.alpha = f.alpha;
      n++;
    }
    this.others.length = n;
    return ran;
  }

  get runners(): readonly OtherRunner[] {
    return this.others;
  }

  /** A line for the HUD (made again only when the number of other runners changes). */
  get status(): string {
    if (this.lost) return 'offline (connection lost)';
    const n = this.net.remotes.size;
    if (n !== this.statusCount) {
      this.statusCount = n;
      this.statusText = `online, ${n} other runner${n === 1 ? '' : 's'}`;
    }
    return this.statusText;
  }

  leaderboard(route: string): Leaderboard | null {
    return this.boards.get(route) ?? null;
  }

  requestBoard(route: string): void {
    this.net.requestBoard(route);
  }

  teleport(hub: number): void {
    this.net.teleport(hub);
  }

  setLook(look: Look): void {
    this.net.setLook(look);
  }

  /** After the tab was hidden. */
  resync(): void {
    this.net.requestResync();
  }

  close(): void {
    this.lost = true;
    this.net.close();
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}
