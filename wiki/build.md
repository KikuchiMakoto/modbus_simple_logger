# Build — Vite / Tailwind / Plotly

## パッケージマネージャ: bun → pnpm

リポジトリは元々 **bun** を使っていたが、フォーク先では **pnpm** に統一する。

### 変更点

| 項目 | bun（既存） | pnpm（新規） |
|------|------------|--------------|
| ランタイム | bun (>=1.0) | 不要（Node があれば十分） |
| `package.json` scripts | `bunx vite ...` | `pnpm ...` / `pnpm vite ...` |
| lockfile | `bun.lock` | `pnpm-lock.yaml` |
| CI (`deploy.yml`) | `oven-sh/setup-bun` | `pnpm/action-setup` |
| `.gitignore` | `bun.lock`, `bun.lockb` | `pnpm-lock.yaml` は**コミットする** |

### scripts

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no linter configured'"
  }
}
```

- `tsc --noEmit && vite build` で型チェックを通したうえでビルドする。

## 依存関係の整理

### 残す

| パッケージ | 用途 |
|------------|------|
| `react`, `react-dom` | UI |
| `plotly.js`, `react-plotly.js` | チャート（検定点散布図 + 回帰直線） |
| `web-serial-polyfill` | モバイルフォールバック |
| `vite`, `@vitejs/plugin-react` | ビルド |
| `typescript` | 型 |
| `tailwindcss`, `@tailwindcss/postcss`, `autoprefixer`, `postcss` | スタイル |
| `@types/react`, `@types/react-dom`, `@types/plotly.js`, `@types/w3c-web-serial`, `@types/w3c-web-usb`, `@types/wicg-file-system-access` | 型 |

### 削除

| パッケージ | 理由 |
|------------|------|
| `pyodide` | ScriptRunner 廃止 |
| `react-rnd` | 現状維持（FloatingWindow + ModbusConfigPanel をそのまま流用） |

### 追加（任意）

- 数値入力: 既存の `CalibCell` パターンを流用
- 統計: 自前（外部ライブラリ不要）

## Vite 設定

`vite.config.ts` の主な変更点:

```ts
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), precacheManifest()],   // pyodideAssets() を削除
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_APP_NAME': JSON.stringify(pkg.name),
    global: 'globalThis',                   // Plotly 内部の Node `global` シム
  },
  base: command === 'build' || isPreview ? '/modbus_strain_calibrator/' : '/',
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: /* react-vendor / vendor */ } },
    chunkSizeWarningLimit: 1800,
  },
  server: { headers: { COOP: 'same-origin', COEP: 'require-corp' } },
  preview: { headers: { COOP: 'same-origin', COEP: 'require-corp' } },
}));
```

- Pyodide 関連プラグイン (`pyodideAssets`) を削除
- チャンク分割はそのまま維持（Plotly 等の vendor を分離し PWA キャッシュ効率を保つ）
- チャンクサイズ警告閾値は 1800KB のまま

## Plotly カスタムバンドル

`src/plotly.ts` で最小バンドル:

```ts
import PlotlyCoreImport from 'plotly.js/lib/core';
import scatterglImport from 'plotly.js/lib/scattergl';
import factoryImport from 'react-plotly.js/factory';

const Plotly = interopDefault(PlotlyCoreImport);
const scattergl = interopDefault(scatterglImport);
const createPlotlyComponent = interopDefault(factoryImport);
Plotly.register([scattergl]);
export const Plot = createPlotlyComponent(Plotly);
```

- フル `plotly.js` を import すると**数 MB 膨張**するため禁止。
- 散布図 (`scattergl`) のみで十分（時系列チャートは HX711 raw のリングバッファ可視化のみ）
- `interopDefault()` は CJS/ESM interop の正規化（dev=esbuild / prod=rolldown で挙動が違う）。**絶対に変えない**。

## Tailwind CSS 4

`src/index.css`:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

body {
  @apply bg-slate-50 text-slate-900 min-h-screen dark:bg-slate-950 dark:text-slate-100;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace;
}
.card { @apply rounded-xl bg-white shadow-lg border border-slate-200 p-2 dark:bg-slate-900 dark:border-slate-800; }
.button-primary { @apply rounded-lg bg-emerald-500 px-4 py-1.5 font-semibold text-emerald-950 shadow hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed; }
.button-secondary { @apply rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-50; }
```

- Tailwind CSS 4 記法（`@import "tailwindcss"`, `@custom-variant`）
- 共通クラス: `card`, `button-primary`, `button-secondary` を流用
- ダークモード: `<html>` の `dark` クラスで切替（`useTheme` フック）

## TypeScript 設定

TypeScript 7 + strict mode。`tsconfig.json` はほぼ流用。`types` から `w3c-web-serial` / `w3c-web-usb` / `wicg-file-system-access` を維持（Web Serial API 型定義が必要）。

## Lint / Format

**Biome** を使用。ESLint / Prettier は導入しない。

```bash
pnpm lint       # biome check
pnpm lint:fix   # biome check --write
```

## テスト

**Vitest** を使用。カバレッジ目標 80%（コアロジック: regression.ts, settling.ts）。

```bash
pnpm test      # vitest run
pnpm test:cov  # vitest run --coverage
```

## ビルド成果物

- `dist/index.html`
- `dist/assets/*.js`, `dist/assets/*.css`（チャンク分割済み）
- `dist/manifest.json`
- `dist/icon.svg`
- `dist/sw.js`（プレースホルダ置換済み）

## 関連ページ

- [pwa-sw.md](pwa-sw.md) — Service Worker / プリキャッシュ
- [conventions.md](conventions.md) — 命名規則
- [design-strain-calibrator.md](design-strain-calibrator.md) — 検定アプリ設計
