// A 5 px tall pixel font for signs and preview labels (upper case, digits, a few marks). Most
// glyphs are 3 px wide; M, N and W are wider so they read.
import type { Canvas, RGBA } from './paint.ts';

/** Five rows of pixels each, separated by spaces. */
const GLYPHS: Readonly<Record<string, string>> = {
  A: '.#. #.# ### #.# #.#',
  B: '##. #.# ##. #.# ##.',
  C: '.## #.. #.. #.. .##',
  D: '##. #.# #.# #.# ##.',
  E: '### #.. ##. #.. ###',
  F: '### #.. ##. #.. #..',
  G: '.## #.. #.# #.# .##',
  H: '#.# #.# ### #.# #.#',
  I: '### .#. .#. .#. ###',
  J: '..# ..# ..# #.# .#.',
  K: '#.# #.# ##. #.# #.#',
  L: '#.. #.. #.. #.. ###',
  M: '#...# ##.## #.#.# #...# #...#',
  N: '#..# ##.# #.## #..# #..#',
  O: '.#. #.# #.# #.# .#.',
  P: '##. #.# ##. #.. #..',
  Q: '.#. #.# #.# ##. .##',
  R: '##. #.# ##. #.# #.#',
  S: '.## #.. .#. ..# ##.',
  T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###',
  V: '#.# #.# #.# #.# .#.',
  W: '#...# #...# #.#.# ##.## #...#',
  X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.',
  Z: '### ..# .#. #.. ###',
  '0': '### #.# #.# #.# ###',
  '1': '.#. ##. .#. .#. ###',
  '2': '##. ..# .#. #.. ###',
  '3': '##. ..# .#. ..# ##.',
  '4': '#.# #.# ### ..# ..#',
  '5': '### #.. ##. ..# ##.',
  '6': '.## #.. ### #.# ###',
  '7': '### ..# .#. .#. .#.',
  '8': '### #.# ### #.# ###',
  '9': '### #.# ### ..# ##.',
  '.': '... ... ... ... .#.',
  ',': '... ... ... .#. #..',
  ':': '... .#. ... .#. ...',
  '-': '... ... ### ... ...',
  '/': '..# ..# .#. #.. #..',
  ' ': '... ... ... ... ...',
};

const glyph = (ch: string): string[] => (GLYPHS[ch] ?? GLYPHS[' ']!).split(' ');

/** Width in px of a text drawn with `text`. */
export const textWidth = (s: string): number =>
  Math.max(0, [...s.toUpperCase()].reduce((w, ch) => w + glyph(ch)[0]!.length + 1, 0) - 1);

/** Draws a text with its top-left at (x, y); returns its width. */
export const text = (g: Canvas, x: number, y: number, s: string, c: RGBA): number => {
  let at = x;
  for (const ch of s.toUpperCase()) {
    const rows = glyph(ch);
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') g.set(at + i, y + j, c);
    });
    at += rows[0]!.length + 1;
  }
  return at - x - 1;
};
