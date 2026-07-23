# PWA / Service Worker

## 概要

`public/sw.js` を中心とした PWA 機能。**検定アプリでも維持する**。検定現場はオフライン環境（研究室の計測器専用 PC が多い）でも動作する必要があるため。

## 役割

1. **全レスポンスに COOP/COEP ヘッダ注入**（SharedArrayBuffer 利用のための前提条件）
2. **全ビルドアセットのプリキャッシュ**（オフライン対応）
3. **ナビゲーション: cache-first**（オンライン初回訪問後の完全オフライン動作）
4. **静的アセット: cache-first**（プリキャッシュから即配信）
5. **ユーザー承諾ゲート付き SW 更新**（検定中断を防ぐ）

## COOP/COEP ヘッダ

```js
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
```

- 全てのレスポンスに注入。`opaque` / `opaqueredirect` レスポンスは触らずパススルー。
- 開発サーバ (`vite dev`) では `vite.config.ts` の `server.headers` で別途設定。
- プレビュー (`vite preview`) も `preview.headers` で設定。
- **検定アプリでも COOP/COEP が必要**（Pyodide を削除しても Web Serial / File System Access / Worker のため `SharedArrayBuffer` 周りの将来拡張を見越して残す）。

## プリキャッシュ

- ビルド時に `vite.config.ts` の `precache-manifest` プラグインが `dist` を再帰的に走査し、プレースホルダを置換:
  - `const PRECACHE_MANIFEST = [];` → 全アセットの配列
  - `const CACHE_VERSION = 'dev';` → マニフェストの sha256 ハッシュ 8 桁
  - `const APP_VERSION = '';` → `package.json` の version
- プレースホルダ文字列を**変更しない**（ビルドプラグインが文字列マッチで置換する）

## 更新フロー（ユーザー承諾ゲート）

```
新 SW install
  → skipWaiting() しない（既定）
  → 旧 SW はアクティブのまま、旧キャッシュは保持
  → 新 SW は waiting に留まる
  → main.tsx が controllerchange / updatefound / waiting を検出
  → window.confirm('vX → vY に更新しますか?') 
     - はい → SKIP_WAITING 送信 → 新 SW activate → controllerchange → reload
     - いいえ → 新 SW は waiting のまま、次回起動時に再確認
```

- 検定中の強制リロードで検定が中断されるのを防ぐため、**必ずユーザー同意**を得てから切替。
- `registration.waiting` 初期検出（前回未承諾の更新）でも同じフローを通す。

## Service Worker メッセージ

| 受信 | 動作 |
|------|------|
| `SKIP_WAITING` | `self.skipWaiting()` で activate 開始 |
| `GET_VERSION` (port 付き) | `port.postMessage({ appVersion, cacheVersion })` を返信 |

## `vite.config.ts` の SW 関連設定

```ts
plugins: [react(), pyodideAssets(), precacheManifest()]   // pyodideAssets は検定アプリで削除
base: command === 'build' || isPreview ? '/modbus_strain_calibrator/' : '/',
server:  { headers: { 'COOP': 'same-origin', 'COEP': 'require-corp' } },
preview: { headers: { 'COOP': 'same-origin', 'COEP': 'require-corp' } },
```

- `base` は GitHub Pages の subdir に合わせる。`index.html` と `manifest.json` は **base 相対**で記述する。
- 検定アプリ用に subdir を `/modbus_strain_calibrator/` に変更する（リポジトリ名に合わせる）。

## 検定アプリでの簡略化

- `pyodide-assets` プラグインを削除（Pyodide 同梱不要）
- プリキャッシュ対象から `pyodide/` 配下が消える（**14MB 削減**）
- `sw.js` の `BASE_PATH` を新 subdir に変更
- `public/manifest.json` の name / short_name / description を検定アプリ向けに書換
- `index.html` の `theme-color` / title を検定アプリ向けに書換

## 関連ページ

- [build.md](build.md) — Vite ビルド設定
- [modbus-client.md](modbus-client.md) — Web Serial 接続
- [design-strain-calibrator.md](design-strain-calibrator.md) — 検定アプリ設計
