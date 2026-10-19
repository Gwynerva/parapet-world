// Checks the dependency direction between workspace packages by reading import lines.
// A package may import only the packages listed for it below, never a sibling's files by a
// relative path, and `schemas`, `sim`, `protocol` and `net` never touch the DOM or Node built-ins.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ALLOWED = {
  schemas: [],
  sim: ['schemas'],
  protocol: ['schemas', 'sim'],
  net: ['schemas', 'sim', 'protocol'],
  runtime: ['schemas', 'sim'],
  game: ['schemas', 'sim', 'protocol', 'net', 'runtime'],
  server: ['schemas', 'sim', 'protocol', 'net'],
  tools: ['schemas', 'sim'],
};
const PURE = new Set(['schemas', 'sim', 'protocol', 'net']);
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|mts|js|mjs)$/.test(name)) yield p;
  }
}

const problems = [];
for (const pkg of Object.keys(ALLOWED)) {
  const base = join(root, 'packages', pkg);
  for (const dir of ['src', 'test']) {
    for (const file of files(join(base, dir))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT)) {
        const spec = m[1] ?? m[2];
        const where = relative(root, file);
        if (spec.startsWith('@parapet-world/')) {
          const target = spec.slice('@parapet-world/'.length).split('/')[0];
          if (target !== pkg && !ALLOWED[pkg].includes(target)) {
            problems.push(`${where}: ${pkg} may not import ${target}`);
          }
        } else if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          if (!target.startsWith(base + sep)) {
            problems.push(`${where}: relative import leaves the package (${spec})`);
          }
        } else if (PURE.has(pkg) && dir === 'src' && spec.startsWith('node:')) {
          problems.push(`${where}: ${pkg} must not use Node built-ins (${spec})`);
        }
      }
      if (PURE.has(pkg) && dir === 'src' && /\b(window|document|navigator)\./.test(text)) {
        problems.push(`${relative(root, file)}: ${pkg} must not touch the DOM`);
      }
    }
  }
}
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log('boundaries ok');
