/**
 * The determinism "lint": the simulation may use only integer arithmetic that every JavaScript
 * engine computes alike. In `packages/sim/src` (except `view.ts`, which is presentation):
 *
 * - no `Math.*` but `Math.imul`;
 * - every division is truncated: `(a / b) | 0`;
 * - no float literals, `**`, `Date`, `performance`, `Intl`, locale functions, `parseFloat`,
 *   float typed arrays, `Number.EPSILON`;
 * - no sorting (the compiler sorts by hand) and no iteration methods that could walk a `Map` or
 *   `Set` in insertion order (`forEach`, `keys`, `values`, `entries`, `for ... of`, `for ... in`);
 *   `Object.keys` of plain JSON objects is allowed (its order is specified).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src/', import.meta.url);
const EXEMPT = new Set(['view.ts']);

/** Source with comments, strings and template literals blanked out (lengths kept). */
function codeOnly(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const n = text[i + 1];
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && n === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      out += ' ';
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') {
          out += ' ';
          i++;
        }
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += ' ';
      i++;
    } else if (c === '/' && /[=(,:;!&|?{}\[]\s*$/.test(out.slice(-8))) {
      // A regular expression literal.
      out += ' ';
      i++;
      while (i < text.length && text[i] !== '/') {
        if (text[i] === '\\') {
          out += ' ';
          i++;
        }
        out += ' ';
        i++;
      }
      out += ' ';
      i++;
      while (i < text.length && /[a-z]/.test(text[i]!)) {
        out += ' ';
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const BANNED: Array<[RegExp, string]> = [
  [/\bMath\.(?!imul\b)\w+/, 'Math other than Math.imul'],
  [/\b\d+\.\d+|\b\d+e[+-]?\d+\b/i, 'float literal'],
  [/\*\*/, 'exponent operator'],
  [/\bDate\b/, 'Date'],
  [/\bperformance\b/, 'performance'],
  [/\bIntl\b|toLocale\w*|localeCompare/, 'locale function'],
  [/\bparseFloat\b|\bFloat(32|64)Array\b|Number\.EPSILON/, 'floats'],
  [/\.sort\s*\(|\.toSorted\s*\(/, 'sort'],
  [/\.forEach\s*\(|(?<!Object)\.(keys|values|entries)\s*\(/, 'collection iteration'],
  [/\bfor\s*\([^;)]*\b(of|in)\b/, 'for-of / for-in'],
  [/\bMath\.random\b|crypto/, 'randomness'],
];

/** Every `/` operator must sit inside a group that is truncated with `| 0`. */
function untruncatedDivisions(code: string): number[] {
  const bad: number[] = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '/') continue;
    // Find the end of the enclosing parenthesised group.
    let depth = 0;
    let j = i + 1;
    for (; j < code.length; j++) {
      const c = code[j];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && (c === ';' || c === ',' || c === '\n')) {
        j = -1;
        break;
      }
    }
    if (j < 0 || code[j] !== ')' || !/^\)\s*\|\s*0\b/.test(code.slice(j, j + 8))) bad.push(i);
  }
  return bad;
}

function files(dir: URL): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.ts'))
    .map((n) => join(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1'), n));
}

describe('determinism lint', () => {
  const list = files(SRC);

  it('finds the sources', () => {
    expect(list.length).toBeGreaterThan(5);
  });

  for (const file of list) {
    const name = file.split(/[\\/]/).pop()!;
    if (EXEMPT.has(name)) continue;
    it(`${name} uses integer arithmetic only`, () => {
      const code = codeOnly(readFileSync(file, 'utf8'));
      const problems: string[] = [];
      const lines = code.split('\n');
      lines.forEach((line, n) => {
        for (const [re, what] of BANNED) if (re.test(line)) problems.push(`${n + 1}: ${what}`);
      });
      for (const at of untruncatedDivisions(code)) {
        const line = code.slice(0, at).split('\n').length;
        problems.push(`${line}: division without | 0`);
      }
      expect(problems).toEqual([]);
    });
  }

  it('catches violations', () => {
    const code = codeOnly('const a = x / 2;\nconst b = (x / 2) | 0;\nconst c = Math.floor(x);');
    expect(untruncatedDivisions(code).length).toBe(1);
    expect(BANNED[0]![0].test(code)).toBe(true);
    expect(codeOnly('// a / b\nconst s = "1.5";').includes('/')).toBe(false);
  });
});
