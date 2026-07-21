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

## 2026-07-21 | design | UI 全面見直し + 自動再計算 + 単位切替

ユーザーの UI 指摘を反映し大幅改修:

- **レイアウト**: 縦1カラム → **2カラム**（左: live chart + regression plot / 右: workbench）
- **live readings 廃止**: 現在値は live chart の凡例に表示（Raw / Filtered / mV/V / Phy）
- **Calculate ボタン削除**: points 変更時に回帰を**自動再計算**・再描画
- **x = filtered value**: Add Point 時の x は filtered raw を採用
- **安定判定再変動対応**: allStable 後も値が変動したら即座に Add Point を disabled
- **x の単位切替**: raw counts / mV/V / με を選択可能。係数 a,b,c も換算表示
- **エクスポート簡略化**: CSV/JSON から index, iso8601 を削除
- **コンポーネント**: Hx711LiveCard → LiveChart, RegressionChart → RegressionPlot に置き換え
