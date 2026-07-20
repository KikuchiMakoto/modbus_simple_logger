import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { relative, resolve, sep } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

// Pyodide runtime files self-hosted out of the npm package (pinned to an exact
// version in package.json — that pin is the single source of truth for the
// Pyodide version). Serving them from our own origin puts them under the
// Service Worker precache, so ScriptRunner works fully offline and never
// depends on a CDN at runtime.
const PYODIDE_DIR = resolve(__dirname, 'node_modules/pyodide');
const PYODIDE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];
const pyodidePkg = JSON.parse(readFileSync(resolve(PYODIDE_DIR, 'package.json'), 'utf-8'));

function pyodideAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pyodide-assets',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    // Build: copy the runtime into <outDir>/pyodide/. writeBundle runs before
    // every closeBundle, so the files are on disk when `precache-manifest`
    // walks dist and they land in PRECACHE_MANIFEST automatically.
    writeBundle() {
      const dest = resolve(__dirname, outDir, 'pyodide');
      mkdirSync(dest, { recursive: true });
      for (const file of PYODIDE_FILES) {
        copyFileSync(resolve(PYODIDE_DIR, file), resolve(dest, file));
      }
    },
    // Dev: serve the same files from node_modules at /pyodide/ (dev base is
    // '/' and the Service Worker is inactive, so no copying is needed).
    configureServer(server) {
      const contentTypes: Record<string, string> = {
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.zip': 'application/zip',
        '.json': 'application/json',
      };
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/pyodide\/([^/?]+)(\?.*)?$/);
        const file = match ? PYODIDE_FILES.find((f) => f === match[1]) : undefined;
        if (!file) return next();
        const ext = file.slice(file.lastIndexOf('.'));
        res.setHeader('Content-Type', contentTypes[ext] ?? 'application/octet-stream');
        res.end(readFileSync(resolve(PYODIDE_DIR, file)));
      });
    },
  };
}

// Inject the full list of built assets into the Service Worker precache list so
// the app shell is cached completely on install and works offline. Without this
// the SW only opportunistically caches assets via stale-while-revalidate, which
// leaves gaps (first load before SW control, freshly hashed bundles after a
// deploy, untriggered lazy chunks) where an offline reload shows a blank page.
function precacheManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'precache-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    // closeBundle runs after every output (including the copied public/ dir, so
    // dist/sw.js exists) has been written to disk.
    closeBundle() {
      const dist = resolve(__dirname, outDir);
      const swPath = resolve(dist, 'sw.js');

      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = resolve(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(relative(dist, full).split(sep).join('/'));
        }
      };
      walk(dist);

      // Precache everything except the SW itself and source maps.
      const manifest = files
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .sort();
      const version = createHash('sha256')
        .update(manifest.join('\n'))
        .digest('hex')
        .slice(0, 8);

      const sw = readFileSync(swPath, 'utf-8')
        .replace("const CACHE_VERSION = 'dev';", `const CACHE_VERSION = '${version}';`)
        .replace("const APP_VERSION = '';", `const APP_VERSION = '${pkg.version}';`)
        .replace('const PRECACHE_MANIFEST = [];', `const PRECACHE_MANIFEST = ${JSON.stringify(manifest)};`);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), pyodideAssets(), precacheManifest()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_APP_NAME': JSON.stringify(pkg.name),
    'import.meta.env.VITE_PYODIDE_VERSION': JSON.stringify(pyodidePkg.version),
    // The custom Plotly bundle imports `plotly.js/lib` source, which references
    // Node's `global` (the prebuilt plotly dist shims this internally). esbuild
    // only substitutes free references, so locals named `global` (e.g. regl's
    // codegen) are left intact.
    global: 'globalThis',
    // react-draggable (via react-rnd) gates its debug logging on
    // `process.env.DRAGGABLE_DEBUG`; without this substitution the bare
    // `process` reference throws in the browser and aborts every drag start.
    'process.env.DRAGGABLE_DEBUG': 'false',
  },
  // GitHub Pages serves this project from a sub-directory, but local `vite dev`
  // is cleaner at the root (avoids sub-path HMR/manifest quirks). The build and
  // `vite preview` (which serves the built output) keep the deploy sub-path;
  // index.html and manifest.json use base-relative URLs so both work.
  base: command === 'build' || isPreview ? '/modbus_simple_logger/' : '/',
  build: {
    // The app targets modern browsers only (Web Serial / SharedArrayBuffer /
    // File System Access API), so we skip down-levelling to keep output lean.
    target: 'es2022',
    // Split the rarely-changing vendor code (Plotly + its WebGL deps, React)
    // into their own chunks. App code changes then no longer invalidate the
    // multi-MB Plotly chunk in the Service Worker cache.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
    },
    // The Plotly vendor chunk is intentionally large and long-term cached.
    chunkSizeWarningLimit: 1800,
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}));
