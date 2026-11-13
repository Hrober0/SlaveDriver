// Bundles main, preload and renderer into dist/ with esbuild. Type checking is separate
// (`npm run typecheck`) so starting the app stays fast.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'fs/promises';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, target: 'es2022', logLevel: 'warning' };

const targets = [
  // dbus-next stays a runtime dependency (loaded lazily on Linux only).
  { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron', 'dbus-next'] },
  // Sandboxed preloads can't require local files, so it must be a single bundle.
  { ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] },
  { ...common, entryPoints: ['src/renderer/overlay.ts'], outfile: 'dist/overlay.js', platform: 'browser', format: 'iife' },
];

await mkdir('dist', { recursive: true });
await copyFile('src/renderer/overlay.html', 'dist/overlay.html');

if (watch) {
  const { context } = await import('esbuild');
  for (const t of targets) await (await context(t)).watch();
  console.log('Watching src/ ...');
} else {
  await Promise.all(targets.map((t) => build(t)));
}
