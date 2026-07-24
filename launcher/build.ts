// Compiles the launcher into a single self-contained executable.
//
// Run after `bun run build` and `generate-embed.ts` (see the launcher:build
// script). Keeps the platform-specific `bun build --compile` flags out of
// package.json so the same script works on Windows and Linux.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const isWindows = process.platform === 'win32';
const entry = resolve(import.meta.dir, 'main.ts');
const outfile = resolve(ROOT, isWindows ? 'modbus_simple_logger.exe' : 'modbus_simple_logger');

// Rasterize the app icon (best effort; skips itself if it cannot).
Bun.spawnSync(['bun', 'run', resolve(import.meta.dir, 'generate-icon.ts')], {
  stdout: 'inherit',
  stderr: 'inherit',
});

const args = ['bun', 'build', '--compile', entry, '--outfile', outfile];
if (isWindows) {
  // Windowed app: no console window at startup.
  args.push('--windows-hide-console');
  const ico = resolve(import.meta.dir, 'icon.ico');
  if (existsSync(ico)) {
    args.push(`--windows-icon=${ico}`);
  } else {
    console.warn('[launcher:build] icon.ico missing — compiling without a custom icon.');
  }
}

console.log('[launcher:build]', args.join(' '));
const proc = Bun.spawnSync(args, { stdout: 'inherit', stderr: 'inherit' });
if (proc.exitCode === 0) {
  console.log(`[launcher:build] Done -> ${outfile}`);
}
process.exit(proc.exitCode ?? 1);
