/**
 * Which clip draws each move. The move table names a clip per move, but not every clip is exported
 * yet (ledges, ladders, poles, bars and the tiger jump are still being lifted), so each move is
 * resolved once, in order: its own clip; the clip the exporter's index says plays it; a stand-in
 * that reads as the same motion; idle on the ground, fall in the air.
 */
import type { Ruleset } from '@parapet-world/sim';

/** Stand-ins by move (or by the clip the move names), best first. */
export const STAND_INS: Readonly<Record<string, readonly string[]>> = {
  tigerJump: ['jump'],
  vault: ['monkeyVault', 'jump'],
  monkeyVault: ['vault', 'jump'],
  stepOver: ['jump'],
  slideUnder: ['roll'],
  ledgeGrab: ['ledgeHang', 'fall'],
  ledgeHang: ['ledgeGrab', 'fall'],
  ledgeClimb: ['getUp', 'jump'],
  ledgeDrop: ['fall'],
  ledgeJumpBack: ['backFlip', 'jump'],
  wallRunTop: ['wallRunKick', 'jump'],
  wallFlip: ['backFlip'],
  ticTac: ['wallRunKick', 'jump'],
  ladderEnter: ['ladderClimb', 'wallRun'],
  ladderClimb: ['wallRun'],
  ladderSlide: ['fall'],
  ladderTop: ['jump'],
  ladderLeave: ['jump'],
  letGo: ['fall'],
  poleGrab: ['poleSlide', 'fall'],
  poleSlide: ['fall'],
  poleSpin: ['poleSlide', 'frontFlip'],
  poleJump: ['jump'],
  barGrab: ['barHang', 'fall'],
  barHang: ['fall'],
  barSwing: ['fall'],
  barJump: ['jump'],
  skid: ['stand', 'idle'],
  coast: ['run'],
  dead: ['crashDown'],
  respawn: ['stand', 'idle'],
};

/** Moves that are never on the ground (their last resort is fall, not idle). */
const AIR =
  /^(jump|fall|tigerJump|frontFlip|backFlip|wallRun|ticTac|wallFlip|ledge|ladder|pole|bar|letGo|dropDown|crash)/;

export interface ClipPlan {
  /** The clip to draw for every move index. */
  clips: string[];
  /** Moves drawn by something other than their own clip: move, wanted clip, drawn clip. */
  substituted: [string, string, string][];
}

/**
 * Resolves the clip of every move of a ruleset against the clips that exist (`has`) and the
 * exporter's move -> clip map (`plays`).
 */
export function planClips(
  rules: Ruleset,
  has: (clip: string) => boolean,
  plays: ReadonlyMap<string, string>,
): ClipPlan {
  const clips: string[] = [],
    substituted: [string, string, string][] = [];
  for (let m = 0; m < rules.moveNames.length; m++) {
    const move = rules.moveNames[m]!,
      want = rules.clips[m] ?? '';
    let got = '';
    const candidates = [
      want,
      plays.get(move) ?? '',
      ...(STAND_INS[move] ?? []),
      ...(STAND_INS[want] ?? []),
    ];
    for (const c of candidates) {
      if (c && has(c)) {
        got = c;
        break;
      }
    }
    if (!got) got = AIR.test(move) ? 'fall' : 'idle';
    clips.push(got);
    if (got !== want) substituted.push([move, want, got]);
  }
  return { clips, substituted };
}
