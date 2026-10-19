/**
 * Input. A runner's input is the set of keys held during a step (absolute directions, not
 * facing-relative), logged as run-length runs, plus rare commands at a step.
 */
export const Key = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  ACTION: 16,
} as const;
export const KEY_MASK = 31;

/** `steps` consecutive steps with the same held mask. */
export interface InputRun {
  steps: number;
  held: number;
}

export const Command = {
  /** Teleport to a hub; `arg` is the hub's index in `world.json`. Valid only inside a hub area. */
  TELEPORT: 1,
} as const;
export type CommandKind = (typeof Command)[keyof typeof Command];

export interface InputCommand {
  step: number;
  kind: CommandKind;
  arg: number;
}
