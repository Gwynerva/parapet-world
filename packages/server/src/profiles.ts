/**
 * Player profiles. A device holds a secret token; the server keeps only its SHA-256. A name is
 * claimed by the first token that uses it; the claim comes with a one-time recovery code (shown
 * once, stored hashed) that moves the name to another token. Profiles keep the look, finds,
 * discovered hubs, best times and the last hub.
 */
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_LOOK, UNLOCKS, type Look } from '@parapet-world/schemas';
import { NAME_RE, type ProfileView } from '@parapet-world/protocol';
import type { Storage } from './storage.ts';

export interface Profile {
  id: string;
  name: string;
  look: Look;
  finds: string[];
  hubs: string[];
  best: Record<string, number>;
  lastHub: string | null;
  recoveryHash: string | null;
  created: number;
}

interface NameDoc {
  profile: string;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const nameKey = (name: string): string =>
  `names/${sha(name.toLowerCase().normalize('NFKC')).slice(0, 40)}`;

export type ClaimResult =
  | { ok: true; profile: Profile; recovery: string | null }
  | { ok: false; code: 'name' | 'nameTaken' | 'recovery' };

export class Profiles {
  private readonly store: Storage;
  constructor(store: Storage) {
    this.store = store;
  }

  /** The profile of a token, creating it (and claiming the name) on first use. */
  claim(token: string, name: string, recovery?: string): ClaimResult {
    const id = sha(token).slice(0, 40);
    const key = `profiles/${id}`;
    const existing = this.store.get<Profile>(key);
    if (existing) return { ok: true, profile: existing, recovery: null };
    if (!NAME_RE.test(name)) return { ok: false, code: 'name' };
    const nk = nameKey(name);
    const owner = this.store.get<NameDoc>(nk);
    if (owner) {
      const other = this.store.get<Profile>(`profiles/${owner.profile}`);
      if (!recovery || !other || other.recoveryHash !== sha(recovery)) {
        return { ok: false, code: recovery ? 'recovery' : 'nameTaken' };
      }
      // Move the profile to this token; the old token loses it, a new recovery code is issued.
      const code = randomBytes(9).toString('base64url');
      const moved: Profile = { ...other, id, recoveryHash: sha(code) };
      this.store.put(key, moved);
      this.store.put(`profiles/${other.id}`, { ...other, name: '', recoveryHash: null });
      this.store.put(nk, { profile: id });
      return { ok: true, profile: moved, recovery: code };
    }
    const code = randomBytes(9).toString('base64url');
    const profile: Profile = {
      id,
      name,
      look: { ...DEFAULT_LOOK },
      finds: [],
      hubs: [],
      best: {},
      lastHub: null,
      recoveryHash: sha(code),
      created: Date.now(),
    };
    this.store.put(key, profile);
    this.store.put(nk, { profile: id });
    return { ok: true, profile, recovery: code };
  }

  save(p: Profile): void {
    this.store.put(`profiles/${p.id}`, p);
  }

  get(id: string): Profile | null {
    return this.store.get<Profile>(`profiles/${id}`);
  }
}

export function profileView(p: Profile): ProfileView {
  return { name: p.name, look: p.look, finds: p.finds, hubs: p.hubs, best: p.best };
}

/** What the number of finds unlocks; the classic costume and red hair are always available. */
export function unlocked(p: Profile): { costumes: Set<string>; hairs: Set<string> } {
  const costumes = new Set<string>(['classic']);
  const hairs = new Set<string>(['hairRed']);
  for (const u of UNLOCKS) {
    if (p.finds.length >= u.finds) (u.kind === 'costume' ? costumes : hairs).add(u.id);
  }
  return { costumes, hairs };
}

/** Whether a look is allowed for a profile. */
export function lookAllowed(p: Profile, look: Look): boolean {
  const u = unlocked(p);
  return u.costumes.has(look.costume) && u.hairs.has(look.hair);
}
