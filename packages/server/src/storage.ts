/**
 * Where the server keeps profiles and leaderboards. The adapter stores JSON documents by key;
 * the file adapter writes each to `<dir>/<key>.json` through a temporary file and a rename, so a
 * crash never leaves half a document. Writes are coalesced: the newest value of a key is written
 * at most once per `flushMs`.
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export interface Storage {
  get<T>(key: string): T | null;
  put(key: string, value: unknown): void;
  /** Keys under a prefix (`profiles/`). */
  keys(prefix: string): string[];
  flush(): void;
}

const SAFE = /^[a-z0-9_./-]+$/i;
function checkKey(key: string): void {
  if (!SAFE.test(key) || key.includes('..')) throw new Error(`bad storage key ${key}`);
}

export class MemoryStorage implements Storage {
  private readonly docs = new Map<string, string>();
  get<T>(key: string): T | null {
    const v = this.docs.get(key);
    return v === undefined ? null : (JSON.parse(v) as T);
  }
  put(key: string, value: unknown): void {
    checkKey(key);
    this.docs.set(key, JSON.stringify(value));
  }
  keys(prefix: string): string[] {
    return [...this.docs.keys()].filter((k) => k.startsWith(prefix));
  }
  flush(): void {}
}

export class FileStorage implements Storage {
  private readonly dirty = new Map<string, string>();
  private readonly cache = new Map<string, string>();
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  private path(key: string): string {
    checkKey(key);
    return join(this.dir, `${key}.json`);
  }

  get<T>(key: string): T | null {
    const pending = this.dirty.get(key) ?? this.cache.get(key);
    if (pending !== undefined) return JSON.parse(pending) as T;
    const p = this.path(key);
    if (!existsSync(p)) return null;
    const text = readFileSync(p, 'utf8');
    this.cache.set(key, text);
    return JSON.parse(text) as T;
  }

  put(key: string, value: unknown): void {
    this.path(key);
    const text = JSON.stringify(value);
    this.dirty.set(key, text);
    this.cache.set(key, text);
  }

  keys(prefix: string): string[] {
    const out = new Set<string>();
    const dir = join(this.dir, prefix);
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) if (f.endsWith('.json')) out.add(prefix + f.slice(0, -5));
    }
    for (const k of this.dirty.keys()) if (k.startsWith(prefix)) out.add(k);
    return [...out];
  }

  flush(): void {
    for (const [key, text] of this.dirty) {
      const p = this.path(key);
      mkdirSync(dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, p);
    }
    this.dirty.clear();
  }
}
