import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
function run(label, cmd, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run('typecheck', npm, ['run', 'typecheck']);
run('tests', npm, ['run', 'test']);
run('build', npm, ['run', 'build']);
run('worker harness', process.execPath, ['scripts/harness.mjs']);

console.log('\n== artifact checks ==');
for (const file of ['dist/parti.room.json', 'dist/index.html', 'dist/room.worker.js']) {
  if (!existsSync(join(root, file))) throw new Error(`missing ${file}`);
  console.log(`✓ ${file}`);
}
const worker = readFileSync(join(root, 'dist', 'room.worker.js'), 'utf8');
if (!worker.includes('@parti/worker-sdk')) throw new Error('missing @parti/worker-sdk import');
if (!worker.includes('defineRoom')) throw new Error('missing defineRoom');
if (/from\s*["']\.\.?\//.test(worker)) throw new Error('worker contains unresolved relative import');
console.log('✓ room.worker.js preserves @parti/worker-sdk import');
console.log('✓ room.worker.js preserves defineRoom');
console.log('✓ room.worker.js has no internal relative imports');
console.log('\nValidation complete. Runtime loading / actual gameplay still requires a human pass inside Parti, per quick-start guidance.');
