/**
 * Leaderboards: per route, the top 10 times (one entry per profile, its personal best) plus every
 * profile's personal best. A time is in steps; fewer is better, ties keep the earlier one.
 */
import type { BoardEntry } from '@parapet-world/protocol';
import type { Storage } from './storage.ts';

interface BoardDoc {
  /** Personal best per profile id, with the name it was set under. */
  best: Record<string, { name: string; steps: number; at: number }>;
}

export const BOARD_SIZE = 10;

export class Boards {
  private readonly store: Storage;
  private readonly docs = new Map<string, BoardDoc>();

  constructor(store: Storage) {
    this.store = store;
  }

  private doc(route: string): BoardDoc {
    let d = this.docs.get(route);
    if (!d) {
      d = this.store.get<BoardDoc>(`boards/${route}`) ?? { best: {} };
      this.docs.set(route, d);
    }
    return d;
  }

  /** Records a finished run; returns whether it is a personal best and its rank (1-based). */
  submit(route: string, profile: string, name: string, steps: number, at: number) {
    const d = this.doc(route);
    const prev = d.best[profile];
    const best = !prev || steps < prev.steps;
    if (best) {
      d.best[profile] = { name, steps, at };
      this.store.put(`boards/${route}`, d);
    }
    return { best, rank: this.rank(route, best ? steps : prev!.steps) };
  }

  private sorted(route: string) {
    return Object.values(this.doc(route).best).sort((a, b) => a.steps - b.steps || a.at - b.at);
  }

  rank(route: string, steps: number): number {
    return this.sorted(route).filter((e) => e.steps < steps).length + 1;
  }

  top(route: string): BoardEntry[] {
    return this.sorted(route)
      .slice(0, BOARD_SIZE)
      .map((e) => ({ name: e.name, steps: e.steps }));
  }

  mine(route: string, profile: string): number | null {
    return this.doc(route).best[profile]?.steps ?? null;
  }
}
