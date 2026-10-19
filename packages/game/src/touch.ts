/**
 * On-screen held buttons for touch: left, right and down on the left thumb, jump and action on
 * the right. Each button holds its key while a finger is on it (pointer capture, multi-touch).
 */
import { Key } from '@parapet-world/schemas';
import type { InputSampler } from './input.ts';
import { h } from './ui.ts';

export class TouchPad {
  readonly root: HTMLDivElement;
  readonly corner: HTMLDivElement;
  /** Called by the pause button. */
  onPause: (() => void) | null = null;

  constructor(input: InputSampler) {
    const button = (label: string, bit: number, big = false): HTMLButtonElement => {
      const b = h('button', { class: big ? 'tb big' : 'tb', 'aria-label': label }, label);
      const held = new Set<number>();
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          // a pointer the browser no longer tracks: the button still holds until it lifts
        }
        held.add(e.pointerId);
        b.classList.add('held');
        input.touchPress(bit);
      });
      const up = (e: PointerEvent): void => {
        if (!held.delete(e.pointerId)) return;
        if (!held.size) {
          b.classList.remove('held');
          input.touchRelease(bit);
        }
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    this.root = h(
      'div',
      { class: 'touch' },
      h(
        'div',
        { class: 'pad l' },
        button('◀', Key.LEFT),
        button('▼', Key.DOWN),
        button('▶', Key.RIGHT),
      ),
      h('div', { class: 'pad r' }, button('A', Key.ACTION), button('▲', Key.UP, true)),
    );
    this.corner = h(
      'div',
      { class: 'corner' },
      h('button', { class: 'btn', onclick: () => this.onPause?.(), 'aria-label': 'Pause' }, 'II'),
    );
  }

  /** Shows the buttons: always, never, or on devices whose main pointer is coarse. */
  get active(): boolean {
    return this.root.classList.contains('on');
  }

  setMode(mode: 'auto' | 'on' | 'off'): void {
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.root.classList.toggle('on', mode === 'on' || (mode === 'auto' && coarse));
  }
}
