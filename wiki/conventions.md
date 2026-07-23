# Code Conventions

このリポジトリ（および派生する検定アプリ）で従うべきコーディング規約のまとめ。

## 言語 / ランタイム

- **TypeScript strict mode**（`tsconfig.json: "strict": true`）
- React 19 の JSX トランスフォーム（`"jsx": "react-jsx"`）
- ESM ネイティブ（`"type": "module"` in `package.json`）

## 命名規則

| 種類 | 規則 | 例 |
|------|------|----|
| ファイル (TS) | PascalCase (component) / camelCase (util) | `ChartPanel.tsx`, `crc16.ts` |
| React コンポーネント | PascalCase | `CalibrationWorkbench` |
| 関数 | camelCase | `fitLinear()` |
| クラス | PascalCase | `WebSerialModbusClient` |
| 型 / interface | PascalCase | `AiCalibration` |
| 定数 | UPPER_SNAKE_CASE | `AI_CHANNELS` |
| enum 値 | camelCase or 'kebab' | `'normal'`, `'extended'` |

## 状態管理

- **React state**: UI 反応が必要なものだけ（モーダル開閉、入力値など）
- **useRef**: ポーリングタイマー、ロックフラグ、最新値の参照
- **DOM 直接書込み**: ステータス表示など、再レンダリングが無駄なもの（既存 `setStatus` パターン）
- **localStorage**: ユーザー設定・検定結果
- **IndexedDB**: **削除予定**（検定アプリでは不要）

## エラーハンドリング

- `try / catch` で握り潰さず、コンソールに `console.error` / `console.warn` でログ
- ユーザー向けエラーは state にメッセージを格納してトースト / ステータス行で表示
- ネットワーク / Modbus エラーは `pruneFailuresInWindow` でリトライレート制限

## ログ出力規約

```ts
const debugPrefix = '[WebSerialModbusClient]';
console.info(`${debugPrefix} initialized`, { ... });
console.debug(`${debugPrefix} transfer() queued`, { ... });
console.warn(`${debugPrefix} flushed stale RX bytes`, { discardedBytes });
console.error(`${debugPrefix} transfer() CRC mismatch`, { ... });
```

- `[ComponentName]` プレフィックスでフィルタ可能に
- 構造化オブジェクトでログ（メッセージ連結ではなく、第二引数に payload）

## コメント

- **WHAT** ではなく **WHY** を書く
- 公開 API には JSDoc 風のコメント（`@param`, `@returns`）
- ファイル冒頭には「責務」と「他との関係」を簡潔に

## Float32Array 規約

- `DataPoint.aiRaw` / `aiPhysical` / `aiVoltage` は `Float32Array`（**TSV 書き出し前に `Array.from()` 変換**）
- メモリ節約と Plotly.js への直接渡しが目的
- 検定アプリでも HX711 生値配列に `Float32Array` を使う

## スタイル

- **Tailwind CSS 4** の utility-first。`@apply` は共通クラス（card, button-*）のみ。
- カスタム CSS は `src/index.css` に集約
- 色は emerald / blue / sky のセマンティックパレットに統一
- ダークモード対応（`dark:` プレフィックス必須）

## UI 配置規約

- **AI Input カード**: 縦レベルメーターは `w-4`、数値色は `getLevelColor()` で Raw/Phy はレベル連動
- **AO カード**: 検定アプリで削除
- **ヘッダー**: アプリタイトルは `<a target="_blank" rel="noopener noreferrer">` で GitHub リポジトリへリンク

## 禁止事項

- `modbus-serial` / `buffer` 等の外部 Modbus ライブラリ使用禁止（純粋実装に統一）
- フル `plotly.js` の import 禁止（カスタム最小バンドルを使う）
- バンドルサイズを膨らませる import 全体 (`import * as Plotly from 'plotly.js'`) 禁止
- `package.json` の `pyodide` への再追加禁止（ScriptRunner 廃止）
- `react-rnd` は維持（FloatingWindow + ModbusConfigPanel は現状維持）

## Lint / Format

- **Biome** を使用（ESLint / Prettier は導入しない）
- `pnpm lint` でチェック、`pnpm lint:fix` で自動修正
- コミット前に `pnpm lint` と `pnpm typecheck` を通す

## テスト

- **Vitest**。`pnpm test` で実行、`pnpm test:cov` でカバレッジ計測
- コアロジック（regression.ts, settling.ts）はカバレッジ 80% 目標
- テストファイルは `*.test.ts` の命名で実装ファイルと同じディレクトリに配置

## 開発サーバー

- 開発時の `base` は `/`（HMR/manifest サブパスの不具合回避）
- ビルド / プレビューは `/modbus_strain_calibrator/`（GitHub Pages の subdir）
- `index.html` と `manifest.json` は **base 相対**で記述（`./icon.svg` のように）

## 関連ページ

- [build.md](build.md) — ビルド設定
- [architecture.md](architecture.md) — 全体構成
