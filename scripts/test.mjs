import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const out = join(root, '.test-build');
rmSync(out, { recursive: true, force: true });
const localTsc = join(root, 'node_modules', '.bin', 'tsc');
const tsc = existsSync(localTsc) ? localTsc : 'tsc';
const compile = spawnSync(tsc, [
  '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'Bundler', '--skipLibCheck',
  '--strict', '--outDir', out, '--rootDir', root,
  'src/game/core.ts', 'tests/core.test.ts',
], { cwd: root, stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const run = spawnSync(process.execPath, [join(out, 'tests', 'core.test.js')], { cwd: root, stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
process.exit(run.status ?? 1);
