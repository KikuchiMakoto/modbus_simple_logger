# AGENTS.md

このリポジトリで作業するエージェント（LLM / 人間）向けの**エントリポイント**。
ナレッジ本体は [`wiki/`](wiki/index.md) を参照。

---

## 1. Wiki について

このリポジトリは [LLM Wiki パターン](https://github.com/anomalyco/opencode/wiki)（※ `llm-wiki.md` は作業完了後に削除）に従い、3 層で管理する:

- **Raw sources**: 不変のソース文書（今回は未使用）
- **Wiki** （`wiki/`）: LLM が生成・保守する markdown の知識ベース
- **Schema** （このファイル）: Wiki の構造とワークフローの定義

| 用途 | 場所 |
|------|------|
| ナレッジを探す | [`wiki/index.md`](wiki/index.md) |
| 直近の変更を確認 | [`wiki/log.md`](wiki/log.md) |
| 検定アプリ全体の設計 | [`wiki/design-strain-calibrator.md`](wiki/design-strain-calibrator.md) |
| 命名規則・型・スタイル | [`wiki/conventions.md`](wiki/conventions.md) |
| フォーク元の構造 | [`wiki/architecture.md`](wiki/architecture.md) |

---

## 2. llm-wiki Workflow

このリポジトリでの主な操作は **Ingest / Query / Lint** の 3 つ。**実施した操作は `wiki/log.md` に必ず記録**する（プレフィックス: `## [YYYY-MM-DD] {ingest|query|lint|design|refactor} | <タイトル>`）。

### 2.1 Ingest（情報源の取り込み）

新しい情報（外部記事、新機能の実装、フォーク元の変更など）を wiki に取り込む:

1. 取り込み対象を読む
2. `wiki/index.md` で関連ページを確認
3. 該当ページを追記 / 新規ページ作成
4. ページ末尾の「関連ページ」セクションに**必ず**相互リンクを追加
5. `wiki/index.md` を更新（新規ページは追記、既存ページはリンク確認）
6. `wiki/log.md` にエントリを追加
7. 矛盾・古い記述があれば修正

### 2.2 Query（問い合わせ）

ユーザーや他のエージェントの質問に答える:

1. まず `wiki/index.md` で関連ページを特定
2. 該当ページを読み、出典を確認
3. **`file_path:line_number` 形式**で参照箇所を明示して回答（例: `src/modbus/webserialClient.ts:331`）
4. 重要な発見は新規ページとして wiki に取り込む（Query → Ingest のフィードバック）

### 2.3 Lint（健全性チェック）

定期的に wiki の健康状態を確認:

1. `wiki/log.md` の最新エントリで直近の変更を把握
2. 矛盾する記述がないか（古い情報 vs 新しい情報）
3. 孤立ページがないか（被リンクのないページ）
4. 重要概念のページ不足がないか（頻出名詞で被リンクされないページ）
5. 相互リンクの更新
6. 古いコード / 型への参照が残っていないか
7. 発見した問題は `wiki/log.md` に `## [YYYY-MM-DD] lint | <タイトル>` で記録

### 2.4 編集ルール

- ページは markdown 1ファイル1ページ
- ファイル名は英語kebab-case（例: `data-persistence.md`）
- ページ構造: `# タイトル` → 概要 → 詳細 → 関連ページ
- 末尾の「関連ページ」セクションにリンクをリスト
- コードブロックは言語タグ必須
- 出典は `file_path:line_number` 形式
- 日本語 / 英語混在OK、ただし新規ページは原則日本語

---

## 3. プロジェクト概要

**HX711 ひずみゲージセンサー検定 Web アプリ**。[ModbusSimpleLogger](https://github.com/KikuchiMakoto/modbus_simple_logger) の fork。

- **1-port モード**（外部標準基準）: ゲージブロック・分銅等で印加値を直接入力 → 最小二乗
- **2-port モード**（参照センサー基準）: 校正済みセンサーと対象センサーを同時測定 → 最小二乗
- 回帰モデル: 1次（`y = a·x + b`）/ 2次（`y = a·x² + b·x + c`）を選択
- パッケージマネージャ: **pnpm**（bun ではない）
- 通信: Web Serial API（モバイルは polyfill 経由で WebUSB）
- **削除済み**: ScriptRunner（Pyodide）/ AO 8ch / Parameter 8ch / 多電圧モード / 多チャート / IndexedDB / TSV / HamburgerMenu / SlidePanel

設計の全体像は [`wiki/design-strain-calibrator.md`](wiki/design-strain-calibrator.md) を参照。

---

## 4. 主要コマンド

```bash
pnpm install
pnpm dev          # http://localhost:5173/
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check
pnpm lint:fix     # biome check --write
pnpm test         # vitest
pnpm test:cov     # vitest --coverage (目標 80%)
pnpm build
pnpm preview      # http://localhost:4173/modbus_strain_calibrator/
```

---

## 5. 主要定数

| 定数 | 値 | 説明 |
|------|-----|------|
| `AI_CHANNELS` | 16 | AI チャネル数（HX711 0-7 + ADS1115 8-15） |
| `HX711_CHANNELS` | 8 | HX711 チャネル数（検定対象は 0-7 のうち 1〜2ch） |
| `AI_START_REGISTER` | 0 | AI Input Register 開始アドレス（Normal） |
| `AI_FLOAT_START_REGISTER` | 5000 | AI Input Register 開始アドレス（Extended） |
| `POLLING_INTERVAL_MS` | 200 | 検定時のポーリング間隔（固定） |
| `RETRY_DELAY_MS` | 10 | Modbus 通信リトライ前の待機時間 |

---

## 6. 変更時の注意（運用ルール）

**コード変更時**:
- デザイン変更 → [`wiki/design-strain-calibrator.md`](wiki/design-strain-calibrator.md) を必ず更新
- 通信層の変更 → [`wiki/modbus-client.md`](wiki/modbus-client.md) を必ず更新
- ポーリングの変更 → [`wiki/polling.md`](wiki/polling.md) を必ず更新
- 命名規則・型・スタイルの変更 → [`wiki/conventions.md`](wiki/conventions.md) を必ず更新
- ビルド設定の変更 → [`wiki/build.md`](wiki/build.md) を必ず更新

**設定変更時**:
- 主要コマンドの変更 → §4 を更新
- 主要定数の追加・変更 → `src/constants.ts` と §5 の両方を更新
- log.md に必ず記録

**禁止事項**:
- **pyodide の再導入禁止**（削除済み機能）
- **外部ライブラリ（mathjs / regression-js）使用禁止**（最小二乗は `utils/regression.ts` の自前実装）
- **フル `plotly.js` の import 禁止**（`src/plotly.ts` のカスタム最小バンドルを使う）
- **Pyodide worker 復活禁止**（ScriptRunner は永久に廃止）

**UI 規約**:
- **1-port / 2-port モード切替**は画面内タブ UI で実現（ページ遷移なし）
- ヘッダーリンク: アプリタイトルは `<a target="_blank" rel="noopener noreferrer">` で GitHub リポジトリへリンク
- レベルメーター色は `utils/calibration.ts` の `getLevelColor()` を使う
- 共通クラス: `.card`, `.button-primary`, `.button-secondary`（`index.css` で定義）

**ビルド設定**:
- 開発時の `base` は `/`（HMR/manifest サブパスの不具合回避）
- ビルド / プレビューは `/modbus_strain_calibrator/`
- `index.css` は `@import "tailwindcss"` + `@custom-variant dark`（Tailwind 4 記法）
- 定数は `src/constants.ts` に一元化

**データ規約**:
- **Float32Array** を HX711 raw 配列に採用（メモリ効率・Plotly 互換）
- localStorage キーは `modbus_calibrator_*` プレフィックス（フォーク元の `modbus_logger_*` と区別）
- 出典・ログ・リンクは日本語で書く

---

## 7. バージョンルール

`package.json` の version 更新:

- **小規模変更**（主観）: マイナーバージョンをインクリメント
- **マイナーバージョン 20 到達**: メジャーバージョン更新
- **大規模変更**（主観）: メジャーバージョンをインクリメント
- **メジャーバージョン更新時**: マイナーをゼロに

（参考: Linux, Linus Torvalds の思想）

---

## 8. 関連リンク

- [wiki/index.md](wiki/index.md) — ナレッジベース カタログ
- [wiki/log.md](wiki/log.md) — 活動ログ
- [wiki/design-strain-calibrator.md](wiki/design-strain-calibrator.md) — 検定アプリ設計書
- [wiki/conventions.md](wiki/conventions.md) — 命名規則・型・スタイル
- [wiki/architecture.md](wiki/architecture.md) — フォーク元アーキテクチャ
