/**
 * Input: the keys held during a step (schemas `Key` bits), from the keyboard, gamepads and the
 * on-screen buttons. The simulation derives press edges from consecutive masks itself, so the
 * sampler makes sure every edge the player made reaches a step: a press is latched until a step
 * takes it (a tap shorter than a step still lasts one step), and so is a release (letting go and
 * pressing again within one step shows the key up for a step, then down: the re-press the tiger
 * jump asks for while coasting).
 */
import { KEY_MASK, Key } from '@parapet-world/schemas';

/** The latch at the heart of the sampler: what is down now, plus edges since the last step. */
export class HeldLatch {
  private down = 0;
  private pressed = 0;
  private released = 0;
  /** The mask the last step got, and presses owed to the next step. */
  private prev = 0;
  private owed = 0;

  press(bit: number): void {
    this.down |= bit;
    this.pressed |= bit;
  }

  release(bit: number): void {
    this.down &= ~bit;
    this.released |= bit;
  }

  /** Sets the whole down mask of a polled source (gamepad), latching its edges. */
  set(mask: number): void {
    this.pressed |= mask & ~this.down;
    this.released |= this.down & ~mask;
    this.down = mask;
  }

  /** The mask the next step gets, leaving the latch as it is. */
  peek(): number {
    // a key the last step had and that went up since shows up for this step
    const cut = this.prev & this.released;
    return (((this.down | this.pressed) & ~cut) | this.owed) & KEY_MASK;
  }

  /** The mask for the next step; the edges it shows are spent. */
  take(): number {
    const held = this.peek(),
      cut = this.prev & this.released;
    // a key pressed again after that release is owed to the step after
    this.owed = cut & (this.pressed | this.down);
    this.prev = held;
    this.pressed = this.released = 0;
    return held;
  }

  /** Lets go of everything (focus lost, a menu opened). */
  clear(): void {
    this.down = this.pressed = this.released = this.owed = this.prev = 0;
  }

  get mask(): number {
    return this.down & KEY_MASK;
  }
}

export type Action = 'left' | 'right' | 'up' | 'down' | 'action';
export const ACTIONS: readonly Action[] = ['left', 'right', 'up', 'down', 'action'];
export const ACTION_BIT: Readonly<Record<Action, number>> = {
  left: Key.LEFT,
  right: Key.RIGHT,
  up: Key.UP,
  down: Key.DOWN,
  action: Key.ACTION,
};
export const ACTION_LABEL: Readonly<Record<Action, string>> = {
  left: 'Left',
  right: 'Right',
  up: 'Jump / up',
  down: 'Down / roll',
  action: 'Action',
};

/** Keyboard bindings by `KeyboardEvent.code`; arrows and WASD are always bound. */
export type Bindings = Record<Action, string>;
export const DEFAULT_BINDINGS: Bindings = {
  left: 'KeyA',
  right: 'KeyD',
  up: 'Space',
  down: 'KeyS',
  action: 'KeyJ',
};
const FIXED: Readonly<Record<string, number>> = {
  ArrowLeft: Key.LEFT,
  ArrowRight: Key.RIGHT,
  ArrowUp: Key.UP,
  ArrowDown: Key.DOWN,
  KeyA: Key.LEFT,
  KeyD: Key.RIGHT,
  KeyW: Key.UP,
  KeyS: Key.DOWN,
};

/** The bit a key code holds with the given bindings (0 when unbound). */
export function bitOfCode(code: string, bindings: Bindings): number {
  let bit = FIXED[code] ?? 0;
  for (const a of ACTIONS) if (bindings[a] === code) bit |= ACTION_BIT[a];
  return bit;
}

/** A gamepad's held mask: the d-pad or left stick, A jumps, B / X act, the stick down rolls. */
export function gamepadMask(pad: Gamepad | null): number {
  if (!pad || !pad.connected) return 0;
  const b = (i: number): boolean => !!pad.buttons[i]?.pressed;
  const ax = pad.axes[0] ?? 0,
    ay = pad.axes[1] ?? 0,
    dead = 0.4;
  let m = 0;
  if (b(14) || ax < -dead) m |= Key.LEFT;
  if (b(15) || ax > dead) m |= Key.RIGHT;
  if (b(12) || b(0) || ay < -0.6) m |= Key.UP;
  if (b(13) || ay > 0.6) m |= Key.DOWN;
  if (b(1) || b(2) || b(5) || b(7)) m |= Key.ACTION;
  return m;
}

/**
 * The browser side: keyboard listeners, gamepad polling and on-screen buttons feed one latch
 * each; a step takes the union. While `enabled` is false (menus, text fields) nothing is held.
 */
export class InputSampler {
  bindings: Bindings;
  enabled = true;
  private readonly keys = new HeldLatch();
  private readonly pad = new HeldLatch();
  private readonly touch = new HeldLatch();
  private readonly codes = new Map<string, number>();
  /** Called with the code of every key that went down (menus, rebinding, the recorder). */
  onKey: ((code: string, e: KeyboardEvent) => void) | null = null;

  constructor(bindings: Bindings) {
    this.bindings = { ...bindings };
    addEventListener('keydown', this.down);
    addEventListener('keyup', this.up);
    addEventListener('blur', this.blur);
    addEventListener('gamepadconnected', this.padConnected);
    addEventListener('gamepaddisconnected', this.padDisconnected);
  }

  private pads = 0;
  private readonly padConnected = (): void => {
    this.pads++;
  };
  private readonly padDisconnected = (): void => {
    this.pads = Math.max(0, this.pads - 1);
    if (!this.pads) this.pad.set(0);
  };

  private readonly down = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (!e.repeat) this.onKey?.(e.code, e);
    if (!this.enabled) return;
    const bit = bitOfCode(e.code, this.bindings);
    if (!bit) return;
    e.preventDefault();
    if (e.repeat) return;
    this.codes.set(e.code, bit);
    this.keys.press(bit);
  };

  private readonly up = (e: KeyboardEvent): void => {
    const bit = this.codes.get(e.code);
    if (bit === undefined) return;
    this.codes.delete(e.code);
    // another key may still hold the same bit (A and the left arrow)
    let still = 0;
    for (const b of this.codes.values()) still |= b;
    this.keys.release(bit & ~still);
  };

  private readonly blur = (): void => {
    this.codes.clear();
    this.keys.clear();
    this.touch.clear();
  };

  /** On-screen buttons press and release bits directly. */
  touchPress(bit: number): void {
    if (this.enabled) this.touch.press(bit);
  }
  touchRelease(bit: number): void {
    this.touch.release(bit);
  }

  /** Polls gamepads (once per frame, and only while one is connected). */
  poll(): void {
    if (!this.pads) return;
    let m = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) m |= gamepadMask(pads[i] ?? null);
    this.pad.set(this.enabled ? m : 0);
  }

  /**
   * The held mask without taking the latched presses (for a driver that may run no step this
   * frame); `consume()` once steps did run.
   */
  peek(): number {
    if (!this.enabled) return 0;
    return this.keys.peek() | this.pad.peek() | this.touch.peek();
  }

  consume(): void {
    this.keys.take();
    this.pad.take();
    this.touch.take();
  }

  /** The held mask for the next step. */
  sample(): number {
    if (!this.enabled) {
      this.keys.take();
      this.pad.take();
      this.touch.take();
      return 0;
    }
    return this.keys.take() | this.pad.take() | this.touch.take();
  }

  /** Lets go of every source (when a menu opens). */
  clear(): void {
    this.blur();
    this.pad.clear();
  }

  dispose(): void {
    removeEventListener('keydown', this.down);
    removeEventListener('keyup', this.up);
    removeEventListener('blur', this.blur);
    removeEventListener('gamepadconnected', this.padConnected);
    removeEventListener('gamepaddisconnected', this.padDisconnected);
  }
}
