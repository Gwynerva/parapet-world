/** Compiling the move table: hashes, inheritance and every rejection. */
import { describe, expect, it } from 'vitest';
import { loadRuleset, type RulesetSource } from '../src/index.ts';
import { rulesSource } from './helpers.ts';

function source(): RulesetSource {
  return structuredClone(rulesSource()) as RulesetSource;
}

function move(s: RulesetSource, name: string) {
  return s.moves.find((m) => m.name === name)!;
}

function withMoves(edit: (s: RulesetSource) => void): () => unknown {
  return () => {
    const s = source();
    edit(s);
    return loadRuleset(s);
  };
}

describe('ruleset', () => {
  it('compiles the content move table with a stable hash', () => {
    const a = loadRuleset(source());
    const b = loadRuleset(source());
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBeGreaterThan(0);
    expect(a.moveIndex('run')).toBeGreaterThanOrEqual(0);
    expect(a.clips[a.moveIndex('run')]).toBe('run');
  });

  it('plays only known clips', () => {
    // The 22 lifted clips and the ones being lifted (docs/MVP-PLAN.md, sections 3 and 8).
    const known = new Set(
      (
        'idle stand start run runDownhill runUphill turn turnFast jump fall landingPrepare landing ' +
        'roll frontFlip backFlip stumble crash crashFall crashDown getUp wallRun wallRunKick ' +
        'wallFlip ledgeGrab ledgeHang ledgeClimb ledgeDrop ledgeJumpBack stepOver vault ' +
        'monkeyVault ladderEnter ladderClimb ladderSlide ladderTop poleGrab poleSlide poleJump ' +
        'poleSpin barGrab barSwing barJump tigerJump'
      ).split(' '),
    );
    const r = loadRuleset(source());
    const unknown = r.clips.filter(
      (c, i) => !(r.source.moves[i]!.abstract ?? false) && !known.has(c),
    );
    expect(unknown).toEqual([]);
  });

  it('every parameter and move takes part in the hash', () => {
    const base = loadRuleset(source()).hash;
    const s = source();
    s.params.runSpeed = s.params.runSpeed! + 1;
    expect(loadRuleset(s).hash).not.toBe(base);
    const t = source();
    t.moves.find((m) => m.name === 'run')!.clip = 'runFast';
    expect(loadRuleset(t).hash).not.toBe(base);
  });

  it('inherits flags and transitions, own transitions first within a priority', () => {
    const r = loadRuleset(source());
    const run = r.moveIndex('run');
    const n = r.transLen[run]!;
    const targets: string[] = [];
    for (let k = 0; k < n; k++) targets.push(r.moveNames[r.trans[(r.transAt[run]! + k) * 4]!]!);
    // KILL (priority 100) and leaving the floor (90) come first, then the run's own transitions,
    // then the ones it inherits from running, then those from moving.
    expect(targets.slice(0, 8)).toEqual([
      'dead',
      'fall',
      'runUphill',
      'runDownhill',
      'coast',
      'skid',
      'idle',
      'wallRun',
    ]);
  });

  it('rejects unknown names', () => {
    expect(withMoves((s) => (move(s, 'idle').transitions![0]!.to = 'nowhere'))).toThrow(
      /unknown move/,
    );
    expect(withMoves((s) => move(s, 'idle').transitions![0]!.if!.push('flying'))).toThrow(
      /unknown predicate/,
    );
    expect(withMoves((s) => move(s, 'idle').perStep!.push(['teleport']))).toThrow(/unknown effect/);
    expect(withMoves((s) => move(s, 'idle').perStep!.push(['decelTo0', '$nope']))).toThrow(
      /unknown param/,
    );
    expect(withMoves((s) => (move(s, 'idle').flags = ['floaty' as never]))).toThrow(/unknown flag/);
    expect(withMoves((s) => move(s, 'idle').transitions![0]!.if!.push('held:SIDEWAYS'))).toThrow(
      /unknown key/,
    );
    expect(withMoves((s) => move(s, 'idle').perStep!.push(['decelTo0']))).toThrow(/argument/);
  });

  it('rejects entering abstract moves, timed moves without then and missing roles', () => {
    expect(withMoves((s) => (s.roles.spawn = 'grounded'))).toThrow(/abstract/);
    expect(
      withMoves((s) => {
        const m = s.moves.find((x) => x.name === 'turn')!;
        delete m.then;
      }),
    ).toThrow(/needs then/);
    expect(withMoves((s) => delete (s.roles as Partial<typeof s.roles>).frozen)).toThrow(/role/);
    expect(withMoves((s) => (s.params.maxSpeed = 2000))).toThrow(/maxSpeed/);
    expect(withMoves((s) => (s.params.gravity = 1.5))).toThrow(/integer/);
  });

  it('rejects unconditional cycles of instant moves', () => {
    expect(
      withMoves((s) => {
        s.moves.push(
          { name: 'ping', clip: 'idle', duration: 0, then: 'pong' },
          { name: 'pong', clip: 'idle', duration: 0, then: 'ping' },
        );
      }),
    ).toThrow(/cycle/);
    // A condition on the way out breaks nothing: the fallback still loops.
    expect(
      withMoves((s) => {
        s.moves.push(
          { name: 'ping', clip: 'idle', duration: 0, then: 'pong' },
          {
            name: 'pong',
            clip: 'idle',
            duration: 0,
            then: 'ping',
            transitions: [{ to: 'idle', if: ['onGround'] }],
          },
        );
      }),
    ).toThrow(/cycle/);
  });
});
