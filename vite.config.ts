import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

function partiWorkerBundle(outDir: string): Plugin {
  return {
    name: 'parti-worker-bundle',
    async closeBundle() {
      const outfile = path.join(outDir, 'room.worker.js');
      await esbuild({
        entryPoints: ['src/worker/index.ts'],
        outfile,
        bundle: true,
        format: 'esm',
        target: 'es2022',
        sourcemap: true,
        external: ['@parti/worker-sdk'],
      });

      const source = readFileSync(outfile, 'utf8');
      const compatibleSource = source.replace(
        /export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/,
        'export default $1;',
      );
      writeFileSync(outfile, compatibleSource);
    },
  };
}

const outDir = process.env.PARTI_ROOM_BUILD_OUT_DIR ?? 'dist';

export default defineConfig({
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
  },
  plugins: [partiWorkerBundle(outDir)],
});
