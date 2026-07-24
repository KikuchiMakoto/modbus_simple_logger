// Compiles the launcher into a single self-contained executable.
//
// Run after `bun run build` and `generate-embed.ts` (see the launcher:build
// script). Keeps the platform-specific `bun build --compile` flags out of
// package.json so the same script works on Windows and Linux.
import { existsSync, mkdirSync, openSync, readSync, writeSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

const isWindows = process.platform === 'win32';
const entry = resolve(import.meta.dir, 'main.ts');
const outDir = resolve(import.meta.dir, 'bin');
mkdirSync(outDir, { recursive: true });
const outfile = resolve(outDir, isWindows ? 'modbus_simple_logger.exe' : 'modbus_simple_logger');

// Force the Windows PE subsystem from Console (3) to GUI (2). Bun's
// --windows-hide-console only hides the console at runtime and leaves the
// binary marked as a console app, so Windows still allocates a console window
// on launch (a visible flash). A GUI-subsystem binary never gets a console at
// all. The launcher writes nothing to stdout in normal operation (child stdio
// is ignored; fatal errors use a GUI message box), so dropping the console is
// safe.
const setGuiSubsystem = (path: string) => {
  const fd = openSync(path, 'r+');
  try {
    const head = Buffer.alloc(0x40);
    readSync(fd, head, 0, 0x40, 0);
    const peOff = head.readUInt32LE(0x3c);
    // Optional header starts at peOff + 24 (4-byte PE sig + 20-byte COFF
    // header). Subsystem is at offset 68 within it for both PE32 and PE32+.
    const subsysOff = peOff + 24 + 68;
    const field = Buffer.alloc(2);
    readSync(fd, field, 0, 2, subsysOff);
    const current = field.readUInt16LE(0);
    if (current === 3) {
      field.writeUInt16LE(2, 0);
      writeSync(fd, field, 0, 2, subsysOff);
      console.log('[launcher:build] Patched PE subsystem Console(3) -> GUI(2): no console window on launch.');
    } else {
      console.log(`[launcher:build] PE subsystem is ${current} (expected 3); left unchanged.`);
    }
  } finally {
    closeSync(fd);
  }
};

// Rasterize the app icon (best effort; skips itself if it cannot).
Bun.spawnSync(['bun', 'run', resolve(import.meta.dir, 'generate-icon.ts')], {
  stdout: 'inherit',
  stderr: 'inherit',
});

const args = ['bun', 'build', '--compile', entry, '--outfile', outfile];
if (isWindows) {
  // Windowed app: no console window at startup. --windows-hide-console handles
  // the runtime side; setGuiSubsystem() below makes it deterministic.
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
  if (isWindows) setGuiSubsystem(outfile);
  console.log(`[launcher:build] Done -> ${outfile}`);
}
process.exit(proc.exitCode ?? 1);
