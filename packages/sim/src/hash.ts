/** FNV-1a, 32 bits, over the four bytes of each integer (little-endian order). */
export const FNV_OFFSET = 0x811c9dc5 | 0;
const FNV_PRIME = 16777619;

export function fnvWord(h: number, word: number): number {
  h = Math.imul(h ^ (word & 255), FNV_PRIME);
  h = Math.imul(h ^ ((word >>> 8) & 255), FNV_PRIME);
  h = Math.imul(h ^ ((word >>> 16) & 255), FNV_PRIME);
  return Math.imul(h ^ ((word >>> 24) & 255), FNV_PRIME);
}

export function fnvWords(h: number, words: ArrayLike<number>, count: number): number {
  for (let i = 0; i < count; i++) h = fnvWord(h, words[i]! | 0);
  return h;
}

export function fnvString(h: number, text: string): number {
  h = fnvWord(h, text.length);
  for (let i = 0; i < text.length; i++) h = fnvWord(h, text.charCodeAt(i));
  return h;
}
