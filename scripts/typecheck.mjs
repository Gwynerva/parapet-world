// Runs `tsc` (no emit) for every workspace package that has a tsconfig.json, and for every
// further `tsconfig.*.json` beside it (the build configuration of a package).
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = join(
  dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'bin',
  'tsc',
);
const projects = [];
for (const name of readdirSync(join(root, 'packages'))) {
  const dir = join(root, 'packages', name);
  if (!existsSync(join(dir, 'tsconfig.json'))) continue;
  for (const file of readdirSync(dir).sort()) {
    if (/^tsconfig(\.[\w-]+)?\.json$/.test(file)) {
      const label = file === 'tsconfig.json' ? name : `${name} (${file})`;
      projects.push({ label, config: join(dir, file) });
    }
  }
  // Development pages with their own tsconfig: packages/<name>/dev/<page>/tsconfig.json.
  const dev = join(dir, 'dev');
  if (existsSync(dev)) {
    for (const page of readdirSync(dev).sort()) {
      const config = join(dev, page, 'tsconfig.json');
      if (existsSync(config)) projects.push({ label: `${name} (dev/${page})`, config });
    }
  }
}
if (existsSync(join(root, 'tsconfig.json'))) {
  projects.push({ label: 'root', config: join(root, 'tsconfig.json') });
}

let failed = false;
for (const { label, config } of projects) {
  process.stdout.write(`typecheck ${label}... `);
  // No shell: the paths go to tsc as they are, spaces and all.
  const r = spawnSync(process.execPath, [tsc, '-p', config], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: root,
  });
  if (r.status === 0) {
    console.log('ok');
  } else {
    failed = true;
    console.log('FAILED');
    process.stdout.write(r.stdout.toString());
    process.stderr.write(r.stderr.toString());
  }
}
process.exit(failed ? 1 : 0);
