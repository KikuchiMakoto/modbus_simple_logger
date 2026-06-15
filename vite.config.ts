import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_APP_NAME': JSON.stringify(pkg.name),
    // The custom Plotly bundle imports `plotly.js/lib` source, which references
    // Node's `global` (the prebuilt plotly dist shims this internally). esbuild
    // only substitutes free references, so locals named `global` (e.g. regl's
    // codegen) are left intact.
    global: 'globalThis',
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
