import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const pkg = JSON.parse(
	readFileSync(resolve(__dirname, "package.json"), "utf-8"),
);

// Inject the full list of built assets into the Service Worker precache list so
// the app shell is cached completely on install and works offline. Without this
// the SW only opportunistically caches assets via stale-while-revalidate, which
// leaves gaps (first load before SW control, freshly hashed bundles after a
// deploy, untriggered lazy chunks) where an offline reload shows a blank page.
function precacheManifest(): Plugin {
	let outDir = "dist";
	return {
		name: "precache-manifest",
		apply: "build",
		configResolved(config) {
			outDir = config.build.outDir;
		},
		// closeBundle runs after every output (including the copied public/ dir, so
		// dist/sw.js exists) has been written to disk.
		closeBundle() {
			const dist = resolve(__dirname, outDir);
			const swPath = resolve(dist, "sw.js");

			const files: string[] = [];
			const walk = (dir: string) => {
				for (const entry of readdirSync(dir, { withFileTypes: true })) {
					const full = resolve(dir, entry.name);
					if (entry.isDirectory()) walk(full);
					else files.push(relative(dist, full).split(sep).join("/"));
				}
			};
			walk(dist);

			// Precache everything except the SW itself and source maps.
			const manifest = files
				.filter((f) => f !== "sw.js" && !f.endsWith(".map"))
				.sort();
			const version = createHash("sha256")
				.update(manifest.join("\n"))
				.digest("hex")
				.slice(0, 8);

			const sw = readFileSync(swPath, "utf-8")
				.replace(
					"const CACHE_VERSION = 'dev';",
					`const CACHE_VERSION = '${version}';`,
				)
				.replace(
					"const APP_VERSION = '';",
					`const APP_VERSION = '${pkg.version}';`,
				)
				.replace(
					"const PRECACHE_MANIFEST = [];",
					`const PRECACHE_MANIFEST = ${JSON.stringify(manifest)};`,
				);
			writeFileSync(swPath, sw);
		},
	};
}

export default defineConfig(({ command, isPreview }) => ({
	plugins: [react(), precacheManifest()],
	define: {
		"import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
		"import.meta.env.VITE_APP_NAME": JSON.stringify(pkg.name),
		global: "globalThis",
		"process.env.DRAGGABLE_DEBUG": "false",
	},
	// GitHub Pages serves this project from a sub-directory, but local `vite dev`
	// is cleaner at the root (avoids sub-path HMR/manifest quirks). The build and
	// `vite preview` (which serves the built output) keep the deploy sub-path;
	// index.html and manifest.json use base-relative URLs so both work.
	base: command === "build" || isPreview ? "/modbus_strain_calibrator/" : "/",
	build: {
		// The app targets modern browsers only (Web Serial / SharedArrayBuffer /
		// File System Access API), so we skip down-levelling to keep output lean.
		target: "es2022",
		// Split the rarely-changing vendor code (Plotly + its WebGL deps, React)
		// into their own chunks. App code changes then no longer invalidate the
		// multi-MB Plotly chunk in the Service Worker cache.
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) return;
					if (
						/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)
					) {
						return "react-vendor";
					}
					return "vendor";
				},
			},
		},
		// The Plotly vendor chunk is intentionally large and long-term cached.
		chunkSizeWarningLimit: 1800,
	},
	server: {
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
	preview: {
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
}));
