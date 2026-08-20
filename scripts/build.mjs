import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findTsc() {
  const local = join(root, 'node_modules', '.bin', 'tsc');
  if (existsSync(local)) return local;
  return 'tsc';
}

function viteAvailable() {
  try { require.resolve('vite/bin/vite.js'); return true; } catch { return false; }
}

function offlineBuild() {
  console.log('[build] Vite is not installed in this offline sandbox; using the deterministic fallback builder.');
  const tmp = join(root, '.offline-build');
  const dist = process.env.PARTI_ROOM_BUILD_OUT_DIR ? resolve(root, process.env.PARTI_ROOM_BUILD_OUT_DIR) : join(root, 'dist');
  rmSync(tmp, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(tmp, 'src', 'game'), { recursive: true });
  mkdirSync(join(tmp, 'src', 'worker'), { recursive: true });
  mkdirSync(join(tmp, 'src', 'ui'), { recursive: true });
  mkdirSync(join(dist, 'assets'), { recursive: true });

  const tsc = findTsc();
  run(tsc, [
    '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'Bundler', '--skipLibCheck',
    '--outDir', tmp, '--rootDir', root,
    'src/game/core.ts', 'src/worker/index.ts', 'src/ui/main.ts', 'src/types/parti.d.ts', 'src/types/worker-sdk.d.ts',
  ]);

  const coreJs = readFileSync(join(tmp, 'src', 'game', 'core.js'), 'utf8')
    .replace(/^export\s+/gm, '');
  const workerPath = join(tmp, 'src', 'worker', 'index.js');
  let workerJs = readFileSync(workerPath, 'utf8');
  workerJs = workerJs.replace(/import\s*\{[^;]*\}\s*from\s*['"]\.\.\/game\/core['"]\;?\s*/m, '');
  const sdkImportMatch = workerJs.match(/import\s*\{[^;]+\}\s*from\s*['"]@parti\/worker-sdk['"]\;?/m);
  if (!sdkImportMatch) throw new Error('worker SDK import missing after transpile');
  workerJs = workerJs.replace(sdkImportMatch[0], '');
  const finalWorker = `${sdkImportMatch[0]}\n${coreJs}\n${workerJs}`;
  writeFileSync(join(dist, 'room.worker.js'), finalWorker);

  copyFileSync(join(root, 'src', 'ui', 'style.css'), join(dist, 'assets', 'style.css'));
  copyFileSync(join(tmp, 'src', 'ui', 'main.js'), join(dist, 'assets', 'main.js'));
  copyFileSync(join(root, 'public', 'parti.room.json'), join(dist, 'parti.room.json'));
  let html = readFileSync(join(root, 'index.html'), 'utf8');
  html = html.replace('/src/ui/style.css', './assets/style.css').replace('/src/ui/main.ts', './assets/main.js');
  writeFileSync(join(dist, 'index.html'), html);
  rmSync(tmp, { recursive: true, force: true });
}

if (viteAvailable()) {
  console.log('[build] Using Vite + esbuild worker bundle.');
  run(process.execPath, [require.resolve('vite/bin/vite.js'), 'build']);
} else {
  offlineBuild();
}
