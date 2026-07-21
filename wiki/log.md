# Log

活動の履歴。新しいエントリは **末尾** に追加する。日付と変更種別を必ず含める。

## 2026-07-21 | ingest | ModbusSimpleLogger の wiki 化

- `modbus-strain-calibrator` リポジトリのコードベース全体を wiki 化。
- `raw/` は存在しないため、コードベースを直接読み取り。
- 対象: `src/App.tsx`（1555行）, `src/modbus/webserialClient.ts`（707行）, `src/components/*`（10ファイル）, `src/hooks/*`（3ファイル）, `src/utils/*`（5ファイル）, `public/sw.js`, `vite.config.ts`, `package.json`, `tsconfig.json`, `index.html`, `manifest.json`。
- 作成ページ:
  - `wiki/architecture.md` — 全体構成
  - `wiki/modbus-client.md` — Web Serial + Modbus RTU
  - `wiki/polling.md` — ポーリング・状態管理
  - `wiki/data-persistence.md` — IndexedDB / TSV / localStorage
  - `wiki/calibration.md` — 既存キャリブレーション + 最小二乗数式
  - `wiki/pwa-sw.md` — PWA / Service Worker
  - `wiki/build.md` — Vite / Tailwind / Plotly / pnpm
  - `wiki/conventions.md` — 命名規則・スタイル
  - `wiki/design-strain-calibrator.md` — 検定アプリ設計書（メイン）

## 2026-07-21 | design | 検定アプリの設計

- ユーザー要求: HX711 1〜2 ポートのみ、1-port 外部標準 / 2-port 参照センサーの 2 モード、最小二乗キャリブレーション、bun→pnpm、Python 機能削除。
- 設計確定:
  - モード切替: **画面切替**（タブ UI で 1-port / 2-port を切替）
  - 回帰モデル: **1次・2次を選択式**（`y = a·x + b` または `y = a·x² + b·x + c`）
  - エクスポート: **CSV + JSON**（Blob + a[download]、File System Access API は使わない）
  - PWA: **維持**（オフライン現場対応）
- 主要決定事項:
  - パッケージマネージャ: bun → pnpm（CI も pnpm アクションに置換）
  - 削除: `pyodide`, ScriptRunner / AO / Parameter / HamburgerMenu / SlidePanel / AppInfoPanel / VoltageConfigPanel / ChartPanel / ManualPanel / CalibrationPanel / tsvExport / dataStorage / useChartAxes
  - 維持: `react-rnd`（FloatingWindow + ModbusConfigPanel は現状維持。後日撤回）
  - 維持・流用: `webserialClient.ts`, `crc16.ts`, `useTheme`, `calibration.ts`（HX711部分）
  - 追加: `useHx711Live`, `useCalibration`, `regression.ts`, `settling.ts`, `csvExport.ts`, `jsonExport.ts`, `CalibrationWorkbench`, `LiveChart`, `RegressionPlot` 等
- 詳細は `wiki/design-strain-calibrator.md` を参照。

## 2026-07-21 | refactor | AGENTS.md と llm-wiki.md の再構成

- ユーザー提案: 「AGENTS.md に詰め込んである知見や規約は wiki に分離できるのではないか？代わりに AGENTS.md には llm wiki の workflow などを取り込むべき」
- 敵対的検証の結果、提案を承認（軽微な調整あり）し、以下を実行:
  - AGENTS.md を再構成: §1 Wiki 案内 / §2 llm-wiki Workflow (Ingest/Query/Lint) / §3 プロジェクト概要 / §4 主要コマンド / §5 主要定数 / §6 変更時の注意（運用ルール中心） / §7 バージョンルール
  - wiki との重複（ディレクトリ構造、アーキテクチャ詳細、命名規則詳細など）を AGENTS.md から除去
  - 主要定数と主要コマンドは quick reference として AGENTS.md に残す（起動時のコンテキスト節約のため）
  - `llm-wiki.md` の中核（3 層アーキテクチャ、Ingest/Query/Lint ワークフロー、編集ルール）を AGENTS.md §2 に要約
- 検証中の調整:
  - 「変更時の注意」を「運用ルール」「禁止事項」「UI 規約」「ビルド設定」「データ規約」に細分化
  - 「禁止事項」は AGENTS.md と wiki/conventions.md の両方に記載（運用ルールとしては AGENTS.md が一次情報源、規約としては wiki が詳細）

## 2026-07-21 | lint | wiki 健全性チェック（初回）

- **孤立ページ**: なし。全ページ（11 ページ）が 1 以上の inbound link を持つ
  - index.md はカタログ役のため inbound 0 だが仕様通り
- **矛盾する記述**: なし。AGENTS.md と wiki/conventions.md の禁止事項リストは一致
- **重要概念のページ不足**: 主要概念（HX711、Web Serial、Modbus RTU、最小二乗、PWA、Plotly）はすべて wiki ページでカバー
- **相互リンク**: 主要ページ間（architecture ↔ 各詳細ページ ↔ design-strain-calibrator）は全て相互リンク済み
- **古いコード/型への参照**: wiki には「削除予定」「削除済み」明記済み、ソースコードは現在 fork 元の状態（実装未着手）
- **今後の lint 推奨タイミング**: PR 作成前、wiki 更新が 5 件累積した時、月 1 回

## 2026-07-21 | design | 実装前設計レビュー（8項目の決定）

subagent との相談を踏まえ、設計書の未定義項目を決定・反映:

1. **ModbusConfigPanel UI** → FloatingWindow 現状維持（react-rnd 禁止を撤回）
2. **ReferenceSensorDialog** → 廃止。2-port 上部にインライン a,b,c テキストボックス常時表示
3. **yAuto の手動上書き** → 不可。常に参照係数からの自動計算値を使用
4. **useCalibration.save/load** → 削除。検定結果は CSV/JSON エクスポートのみ。workbench は自動保存
5. **useCsvExport** → hook から util（csvExport.ts / jsonExport.ts）に変更
6. **Live card mini-chart** → v1.0 で実装、既存 ChartPanel デザインを流用
7. **DegreeSelector** → 独立コンポーネント化せず、Workbench 内に直接配置
8. **エラーハンドリング** → throw から discriminated union に変更

合わせて subagent 指摘の削除漏れ（ChartPanel, ManualPanel, useChartAxes）を追記。
Vitest 導入を決定（regression.ts の単体テスト用）。

## 2026-07-21 | design | 安定判定（settling detector）の設計

- センサー値の自動安定判定を追加決定。subagent と相談して手法を選定
- 採用: **1次IIR LPF + 移動窓 range**方式
- パラメータ: tolerance (raw counts), windowSeconds, cutoffFrequency → いずれもユーザー設定可能
- Add Point ボタンは全チャネル allStable になるまで disabled に制御
- mini-chart は raw + filtered の2系列 overlay 表示
- 設計書 §5 として新規セクション追加、全セクション番号を振り直し
- `utils/settling.ts` を新規追加

## 2026-07-21 | design | y 値の編集可能を明記

- 既存のポイントの y も後から編集可能（入力ミス訂正用）、編集のたびに自動再計算

## 2026-07-21 | design | 技術スタック更新

- TypeScript 6 → **7**
- Lint/Format: **Biome** 導入（ESLint/Prettier 不使用）
- Vitest カバレッジ目標 **80%**

## 2026-07-22 | design | Phase 5a — types + hooks

- `src/types.ts`: 既存型を維持 + 検定アプリ固有型を追記（`CalibrationPoint`, `CalibrationResult`, `CalibrationMode`, `ChannelLiveState`, `XUnit`, `AppSettings`, `ReferenceSensorCoeffs`）
- `src/hooks/useCalibration.ts`: 検定状態管理（degree/points/result）、自動再計算（points/degree変更時にfitRegression自動実行）、localStorage自動保存（`modbus_calibrator_workbench_v1`）、discriminated union エラーハンドリング
- `src/hooks/useHx711Live.ts`: ポーリング（setInterval + readInputRegisters）、チャネルごとに `SettlingDetector` インスタンス保持、ring buffer history（raw/filtered Float32Array）、Wake Lock 取得、2-port 時は refCH の physical を refCoeffs で換算

## 2026-07-22 | design | Phase 5b — 全 8 UI コンポーネント

- `src/components/AppHeader.tsx`: タイトル + Connect/Disconnect + Menu ボタン
- `src/components/ModeSelector.tsx`: 1-port / 2-port タブ切替
- `src/components/ChannelSelector.tsx`: CH 00-07 ドロップダウン
- `src/components/LiveChart.tsx`: Plotly scattergl（raw + filtered 2系列、凡例に現在値）
- `src/components/RegressionPlot.tsx`: Plotly scattergl（散布図 + 回帰線、R²表示）
- `src/components/CalibrationRow.tsx`: 1行表示（番号・x・y編集・削除ボタン）
- `src/components/CalibrationWorkbench.tsx`: 右カラム本体（Add Point / Export / Clear / Degree選択 / XUnit切替 / テーブル / RegressionResultPanel）
- `src/components/RegressionResultPanel.tsx`: 係数a,b,c + R² + RMSE + n 表示
- ついでに `src/constants.ts` に `HX711_CHANNELS = 8` を追加
- `src/plotly.ts` の `<Plot>` 型を `ComponentType<any>` に修正（JSX 非互換のため）
- typecheck ✅ lint ✅ test 15/15 ✅

## 2026-07-22 | ingest | Phase 4 — regression / settling / csvExport / jsonExport

- `src/utils/regression.ts`: 線形・2次最小二乗 + R² + RMSE、discriminated union エラー、Cramer's rule
- `src/utils/regression.test.ts`: 9 tests（完全一致・ノイズ耐性・エラーケース）
- `src/utils/settling.ts`: `SettlingDetector` クラス（1次IIR LPF + 移動窓 range, consecutiveStable 制御）
- `src/utils/settling.test.ts`: 6 tests（定常・振動・収束後安定・reset）
- `src/utils/csvExport.ts`: `calibrationToCsv()` + `downloadCsv()` (# コメントヘッダー)
- `src/utils/jsonExport.ts`: `calibrationToJson()` + `downloadJson()`（app/version/metadata）
- 全 15 tests pass ✅

## 2026-07-22 | lint | Biome エラー修正（全 20+ 件対応）

Phase 0-3 までに残っていた Biome lint エラーを修正:
- `ModbusConfigPanel.tsx`: 全 label に `htmlFor` 追加（a11y, 7件）
- `FloatingWindow.tsx`: `role="dialog"` に biome-ignore（react-rnd 非互換）+ SVG title 追加
- `modules.d.ts`: `any` → `Record<string, unknown>`
- `sw.js`: `forEach` → `for...of`
- `webserialClient.ts`: 3箇所の noNonNullAssertion を `as` キャストに変更
- `App.tsx`: noNonNullAssertion, noUnsafeFinally, useSemanticElements, SVG titles 修正
- `vite.config.ts`, `main.tsx`, `sw.js`: unsafe 自動修正（node: protocol, template literal）
- 未対応: `noArrayIndexKey` 1件（App.tsx paramValues, App.tsx 書き換え時に解消予定）

## 2026-07-22 | design | Phase 6 — App.tsx 書き換え + 全統合

- App.tsx を 3000+ 行から 280 行に完全書き換え
- 接続/切断フロー、settings（localStorage永続化）、1-port/2-port モード切替、ref係数インライン編集
- useHx711Live + useCalibration を統合、2カラムレイアウト
- エクスポート（CSV/JSON）コールバック
- main.tsx は既存のまま（ErrorBoundary + SW登録）

## 2026-07-22 | refactor | Phase 7 — デッドコード一掃 + README + ビルド検証

**デッドコード削除**:
- constants.ts: AO_CHANNELS, PARAM_CHANNELS, MAX_POINTS_IN_MEMORY 等 17 定数を削除
- types.ts: AiCalibration, AiChannel, AoChannel, DataPoint, VoltageMode,
  VOLTAGE_MODES, DEFAULT_VOLTAGE_CONFIG, FileSystemAccessAPI 型 全削除
- calibration.ts: hx711RawToMicroStrain, getLevelColor 削除（1関数のみに）
- cookies.ts: removeJsonStorage, ONE_YEAR_SECONDS 削除
- index.css: .button-stop-save-pulse, .input-compact, .input-raw 削除

**その他**:
- README.md: ModbusSimpleLogger → ModbusStrainCalibrator に全面書き換え
- `pnpm build`: ✅ 成功（JS ~1.7 MB, Pyodide 14 MB 削減）
- `pnpm test`: ✅ 15/15
- `pnpm typecheck`: ✅
- `pnpm lint`: ✅

## 2026-07-22 | design | UI 全面見直し + 自動再計算 + 単位切替

ユーザーの UI 指摘を反映し大幅改修:

- **レイアウト**: 縦1カラム → **2カラム**（左: live chart + regression plot / 右: workbench）
- **live readings 廃止**: 現在値は live chart の凡例に表示（Raw / Filtered / mV/V / Phy）
- **Calculate ボタン削除**: points 変更時に回帰を**自動再計算**・再描画
- **x = filtered value**: Add Point 時の x は filtered raw を採用
- **安定判定再変動対応**: allStable 後も値が変動したら即座に Add Point を disabled
- **x の単位切替**: raw counts / mV/V / με を選択可能。係数 a,b,c も換算表示
- **エクスポート簡略化**: CSV/JSON から index, iso8601 を削除
- **コンポーネント**: Hx711LiveCard → LiveChart, RegressionChart → RegressionPlot に置き換え

## 2026-07-22 | refactor | ポーリング間隔選択肢・設定UI 拡張

- **Polling rate**: fork 元と同じ 13 選択肢（50ms〜5min）を追加、ユーザー選択を localStorage に永続化
- **Settling 設定**: プリセット（Normal/Slow/Fast）の dropdown を廃止し、tolerance / windowSeconds / cutoffFrequency の 3 つの数値入力に置き換え
- 変更範囲: `src/App.tsx`, `wiki/polling.md`, `wiki/design-strain-calibrator.md`

## 2026-07-22 | refactor | PostCSS 除去 + Tailwind standalone CLI 移行

- `postcss`, `@tailwindcss/postcss`, `autoprefixer` を削除
- `@tailwindcss/cli` を追加（standalone CLI）
- `postcss.config.js`, `tailwind.config.js` を削除
- `src/tailwind.src.css` を作成（CLI 入力: `@import "tailwindcss"` + `@custom-variant dark`）
- `src/index.css` の `@apply` を CSS カスタムプロパティによるテーマ変数に置き換え
- `main.tsx` に生成ファイル `tailwind.gen.css` の import を追加
- ビルドパイプライン: `dev:css (--watch) & vite dev` / `build:css && vite build`

## 2026-07-22 | refactor | raw counts display shows 4 decimal places

- `CalibrationWorkbench.tsx:40` の `formatX()` で raw 単位の表示を `x.toFixed(0)` → `x.toFixed(4)` に変更
- EMA フィルタ後の浮動小数点値が確認できるようになった

## 2026-07-22 | refactor | グラフ横軸をサンプル数から時間（秒）に変更

## 2026-07-22 | refactor | 2-port モードで y を ref ch の physical 値で自動入力

- `CalibrationWorkbench.tsx`: mode と currentRefPhysical を props に追加。2-port では y テキストボックスの代わりに read-only 表示、Add Point 時に currentRefPhysical を y として自動投入
- `CalibrationRow.tsx`: mode を props に追加。2-port では y 列を read-only 表示に変更
- `App.tsx`: refState から currentRefPhysical を取得し CalibrationWorkbench に渡す
- typecheck ✅ lint ✅

- `useHx711Live.ts`: `HISTORY_SECONDS` 固定値（10）を削除し、`historyWindowSeconds` をパラメータ化
- `LiveChart.tsx`: x 軸をサンプルインデックス → 相対時間（秒、負値で過去を表す）に変更、x 軸を表示するよう変更
- `App.tsx`: `chartWindowSeconds` 状態を追加（localStorage 永続化）、ツールバーに Chart 時間選択 dropdown（5s〜10min）を追加
- `LiveChart.tsx` に `historyWindowSeconds` prop を追加、x 軸ラベルに `ticksuffix: " s"` を設定
