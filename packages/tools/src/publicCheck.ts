/**
 * The public-build check: `npm run check:public`. It fails while any build output contains the
 * clips lifted from Parapet Classic (`clips/classic/`), which are a temporary stand-in that must
 * never ship publicly (docs/MVP-PLAN.md, section 8). It looks at the built game
 * (`packages/game/dist`) and the baked content (`packages/content/dist`).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputs = ['packages/game/dist', 'packages/content/dist'].map((p) => join(root, p));

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const offending: string[] = [];
for (const out of outputs) {
  if (!existsSync(out)) continue;
  for (const file of walk(out)) {
    const rel = relative(out, file).replace(/\\/g, '/');
    if (rel.startsWith('clips/classic/') || rel.includes('/clips/classic/'))
      offending.push(relative(root, file));
  }
}
if (offending.length) {
  console.log(
    `Not publishable: ${offending.length} file(s) lifted from Parapet Classic are in the build, e.g.\n  ` +
      offending.slice(0, 5).join('\n  ') +
      '\nReplace content/clips/classic with our own clips before a public release.',
  );
  process.exit(1);
}
console.log('public check ok: no Classic-derived clips in the build outputs');
