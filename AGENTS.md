# AGENTS.md

このリポジトリで作業するエージェント向けの簡易ガイドです。

## プロジェクト概要

- **React 19 + TypeScript 6.0 + Vite 8 + Tailwind CSS 4** で構成された Modbus RTU ロガー SPA
- 通信は **Web Serial API**（非対応環境では `web-serial-polyfill` 経由で WebUSB フォールバック）
- AI 16ch（HX711 × 8 + ADS1115 × 8）/ AO 8ch（GP8403）のポーリングと制御
- 計測データは IndexedDB（セッション中 FIFO）と TSV（File System Access API ストリーミング）で扱う
- Plotly.js（`react-plotly.js`）によるリアルタイムチャート表示
- Pyodide（Web Worker + SharedArrayBuffer）による ScriptRunner 機能
- PWA: Service Worker によるキャッシュとオフラインフォールバック
- Wake Lock API による計測中の画面スリープ抑止

## 主要コマンド

```bash
bun install
bun run dev
bun run build
```

## ディレクトリ構造

```
src/
├── App.tsx                          # UI・計測フロー・ポーリングの中枢（リファクタ済み・カスタムフック使用）
├── main.tsx                         # エントリポイント + SW 登録 + Error Boundary
├── index.css                        # Tailwind + カスタムクラス
├── types.ts                         # 型定義（AiChannel, AoChannel, DataPoint, SerialSettings 等）
├── constants.ts                     # 一元化された定数（AI_CHANNELS, MAX_POINTS_* 等）
├── modbus/
│   └── webserialClient.ts           # Web Serial トランスポート + Modbus RTU フレーム送受信
├── pyodideWorker.ts                 # Pyodide ScriptRunner 用 Web Worker
├── hooks/
│   ├── useTheme.ts                  # テーマ管理（localStorage 永続化）
│   ├── useChartAxes.ts              # チャート軸設定（localStorage 永続化）
│   └── useScriptRunner.ts           # Pyodide Worker 管理
├── components/
│   ├── ChartPanel.tsx               # Plotly チャート（X/Y 軸切替、空状態表示）
│   ├── CalibrationPanel.tsx         # Calibration Value ウィンドウ（a·x²+b·x+c 直接編集・Tare・Save/Load）
│   ├── CalibrationWizardPanel.tsx   # 共通キャリブレーションウィザード（実測最小二乗 / スペック計算）。HX711(CH00-07)・ADS1115(CH08-15) 両方で使用
│   ├── ModbusConfigPanel.tsx        # シリアル設定ウィンドウ
│   ├── VoltageConfigPanel.tsx       # 電圧表示モード設定（チャネルタイプ別フィルタ）
│   ├── HamburgerMenu.tsx            # スライドインメニュー
│   ├── SlidePanel.tsx               # 共通スライドインパネル（HamburgerMenu 専用・backdrop アニメーション付き）
│   └── FloatingWindow.tsx           # 共通フローティングウィンドウ（react-rnd・ドラッグ/リサイズ/前面化）
└── utils/
    ├── calibration.ts               # キャリブレーション計算（HX711 mV/V・μɛ, ADS1115 V, スペック→a/b/c, 最小二乗フィット）
    ├── dataStorage.ts               # IndexedDB ラッパー（Singleton・冪等 init）
    ├── tsvExport.ts                 # TSV ストリーミングライター（File System Access API）
    ├── cookies.ts                   # 後方互換: Cookie 読込 → localStorage 移行
    └── crc16.ts                     # 純粋 CRC16 実装（Modbus RTU 用）
public/
├── sw.js                            # Service Worker（COOP/COEP ヘッダー注入付き）
├── manifest.json                    # PWA マニフェスト
└── icon.svg                         # アプリアイコン
```

## アーキテクチャ上の重要点

### Modbus 通信（`webserialClient.ts`）
- `AsyncMutex` で転送の排他制御
- CRC16 検証（純粋関数 `utils/crc16.ts`、`buffer`/`modbus-serial` 依存なし）
- 精度モードに応じた最小メッセージ間隔（Normal: 10ms / Extended: 1ms）
- 転送エラー後の受信バッファフラッシュ（`flushReceiveBuffer`）
- タイムアウト時の Reader リカバリ（cancel → releaseLock → reacquire）
- サポート Function Code: 1, 3, 4, 5, 6, 15, 16

### USB転送間隔制約（重要）

USB Serial変換IC（CH340, FT232等）経由で UART→ModbusRTU を受信するデバイスでは、
USBパケット遅延・詰まりによる通信エラーを防ぐため、**Modbus RTU フレーム送信間に
最低10msの間隔が必須**。

- `webserialClient.ts` の `transfer()` 内の `minMessageIntervalMs` がこれを担保（Normal: 10ms / Extended: 1ms）
- **この制約をアプリケーション層で再実装してはならない**（`transfer()` が単一責任）
- `constants.ts` に追加の Wait 定数を定義しないこと（`transfer()` の待機と二重になる）
- AO書込みを非ブロック化する場合も、`transfer()` の `AsyncMutex` により AI/AO 送信間の最低間隔が自動保証される
- AO書込みは `doAoWriteAsync` で独立実行され、`aoWriteInProgressRef` で二重投入を防止する

### ポーリング（`App.tsx`）
- 100ms〜5分の定期ポーリング（`setTimeout` 再帰スケジュール）
- **`pollOnce` は AI 読取りのみをブロック** — AO 書込みは `doAoWriteAsync` で非ブロック実行
- AI 読取り / AO 書込みそれぞれ独立のリトライレート制限（60s ウィンドウ内最大10回）
- **IndexedDB 書き込みは fire-and-forget**（非保存時のみ。`flushPendingDataPoints` でバッチ書込み `addDataPoints`）
- **チャート表示は描画点数を抑制**（全データは TSV に全点記録、これは「画面表示」のみの話）:
  - 非保存時: 直近 `NON_SAVING_CHART_WINDOW_MS`（60s）のスライディング時間窓
  - 保存時: 保存開始〜現在の全期間を `CHART_MAX_POINTS`(2048) へストライド間引き（`saveDecimationStrideRef`/`saveRawCounterRef`、バッファが 2×超で偶数 index 再間引き＆stride 倍化 → メモリ一定）
  - 共通上限 `CHART_MAX_POINTS`。`MAX_POINTS_IN_MEMORY`(256) は IndexedDB trim 専用
- ペンドデータポイントのバッチフラッシュ（5件 or 100ms ごと、表示バッファ更新と IndexedDB バッチ書込みを実施）
- `pageshow` / `visibilitychange` による復帰時即時ポーリング（`acquiring` 状態を ref で確認）
- USB 物理抜けの `disconnect` イベント自動検知
- **キャリブレーション変更時もポーリングは継続**（`aiCalibrationRef` で最新値を参照）
- **ステータス更新は ref 経由で直接 DOM を更新**（不要な React 再レンダリングを抑制）

### ScriptRunner（`pyodideWorker.ts`）
- Pyodide v314.0.0（Python 3.14）を**セルフホスト**でロード（Web Worker 内・CDN 非依存）
  - `vite.config.ts` の `pyodide-assets` プラグインが npm パッケージから必要ファイル（`PYODIDE_FILES`）を `dist/pyodide/` へコピー。`precache-manifest` より前（`writeBundle`）に走るためプリキャッシュへ自動的に含まれ、**完全オフライン動作**する。dev では同プラグインの middleware が `/pyodide/` を node_modules から直接配信
  - バージョンは **`package.json` の `pyodide` 依存の完全固定ピン（`^` なし）が一次情報源**。URL 直書き禁止。`AppInfoPanel.tsx` の表示は `VITE_PYODIDE_VERSION`（vite.config.ts の define で注入）経由で自動同期。更新時は README のみ手動同期
  - v314.0 以降は **module worker 必須**（classic worker 非対応）。本 Worker は `{ type: 'module' }` で生成済み
- `SharedArrayBuffer` 経由で AI データを Worker と共有（**Float32Array**）
- `set_ao()` でメインスレッドへ AO 制御命令を postMessage
- `SharedArrayBuffer` による割込み停止（`interruptBuffer[0] = 2`）
- **COOP/COEP ヘッダー必須**（`SharedArrayBuffer` 利用のため）
- Worker init 失敗時は `initPromise` をリセットし再試行可能

### データ保存
- **IndexedDB**: セッション中の全データポイントを蓄積（`keepLatestPoints` で自動トリム）
  - `init()` は冪等（複数回呼び出し安全）
  - `StoredDataPoint` に `seq` 連番を付与（重複検出・TSV 整合性）
- **TSV**: File System Access API（`showSaveFilePicker`）でストリーミング書き出し
  - ヘッダーに `seq` 列を追加
  - `Float32Array` / `number[]` の両方を受け付ける
- **設定永続化**: **localStorage** にテーマ・チャート軸・キャリブレーションを JSON 保存
  - Cookie からの自動移行機能付き（読込時に localStorage へ移行し Cookie を削除）

### PWA / Service Worker
- `sw.js` は全レスポンスに COOP/COEP ヘッダーを注入
- **プリキャッシュ（オフライン対応の要）**: install 時に**全ビルドアセット**（ハッシュ付き JS/CSS バンドル・Pyodide ワーカーチャンク・**Pyodide ランタイム一式（`pyodide/` 配下 約14MB）**・`index.html`・`manifest.json`・`icon.svg`）をキャッシュ。これによりオンライン初回訪問（＝SW install 完了）以降は ScriptRunner 含め完全オフライン動作。
  - プリキャッシュ一覧は **`vite.config.ts` の `precache-manifest` プラグイン**がビルド時に `dist/sw.js` へ注入（`const PRECACHE_MANIFEST = [];` を実ファイル一覧へ置換）。手書き禁止
  - `CACHE_VERSION` も同プラグインがマニフェスト内容のハッシュへ置換（`'dev'` → 8桁ハッシュ）。デプロイ毎に新キャッシュへ切替わり旧キャッシュは activate で削除
  - 未ビルドの `vite dev` ではプレースホルダのまま（空配列／`'dev'`）。dev は base が `/` で BASE_PATH 不一致のため SW は実質無効、問題なし
- ナビゲーション: Network-first + キャッシュフォールバック
  - キャッシュ保存時に `request` と `BASE_PATH + 'index.html'` の両方に保存（キー不一致防止）
- 静的アセット: Stale-While-Revalidate（プリキャッシュ済みアセットの裏での更新用。オフライン時はプリキャッシュから配信）
- `vite.config.ts` の `server.headers` / `preview.headers` でも COOP/COEP を設定
- **SW 更新はユーザー承諾ゲート**（計測中断防止・バージョン固定）: `sw.js` の install は `skipWaiting()` を呼ばず、新 SW は **waiting に留まる**（旧バージョンが旧キャッシュのまま配信継続）。`main.tsx` は起動時検出（`registration.waiting`）・セッション中検出（`updatefound`）の**いずれでも** `window.confirm()` 承諾時のみ `SKIP_WAITING` を送信（無確認の自動適用経路は存在しない）→ activate（旧キャッシュ削除）→ `controllerchange` で無条件リロード。辞退時は waiting のまま保持され、次回起動時に再確認される。プロンプトのバージョン表示（`vX → vY`）は waiting ワーカーへの `GET_VERSION` メッセージで取得（500ms タイムアウト。旧ビルドの SW は非応答のためバージョン無し表示へフォールバック）。**activate 後の controllerchange で confirm してはならない**（その時点で旧キャッシュは削除済みのため、拒否すると未読込アセットの取得が壊れる）
- 定期 update チェックの `setInterval` は `pagehide` でクリーンアップ

### Float32 内部表現
- `DataPoint.aiRaw` / `aiPhysical` / `aiVoltage` は `Float32Array`
- Modbus ADC 最高精度 ≈ 22bit < Float32 仮数部 24bit → 精度ロスなし
- メモリ使用量: 65,536点時に約 **8MB 節約**（128B → 64B / チャネルセット）
- Plotly.js は `Float32Array` をそのまま描画可能
- TSV 書き出し時に `Array.from()` で変換

## 主要定数（`src/constants.ts`）

| 定数 | 値 | 説明 |
|------|------|------|
| `AI_CHANNELS` | 16 | AI チャネル数 |
| `AO_CHANNELS` | 8 | AO チャネル数（GP8403） |
| `AI_START_REGISTER` | 0 | AI Input Register 開始アドレス（Normal） |
| `AI_FLOAT_START_REGISTER` | 5000 | AI Input Register 開始アドレス（Extended） |
| `AO_START_REGISTER` | 0 | AO Holding Register 開始アドレス |
| `RETRY_DELAY_MS` | 10 | Modbus 通信リトライ前の待機時間 |
| `INPUT_READ_RETRY_WINDOW_MS` | 60000 | AI 読取りリトライ制限の評価ウィンドウ |
| `INPUT_READ_MAX_FAILURES_PER_WINDOW` | 10 | ウィンドウ内 AI 読取り最大失敗回数 |
| `OUTPUT_HOLDING_RETRY_WINDOW_MS` | 60000 | AO 書込みリトライ制限の評価ウィンドウ |
| `OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW` | 10 | ウィンドウ内 AO 書込み最大失敗回数 |
| `MAX_POINTS_IN_MEMORY` | 256 | 非保存時の IndexedDB 保持点数（trim 専用） |
| `CHART_MAX_POINTS` | 2048 | チャート描画点数の上限（保存時ダウンサンプル目標）。v3.1 で 1024→2048 |
| `NON_SAVING_CHART_WINDOW_MS` | 60000 | 非保存時チャートのスライディング時間窓 |
| `BATCH_FLUSH_THRESHOLD` | 5 | バッチフラッシュのペンド件数閾値 |
| `BATCH_FLUSH_INTERVAL_MS` | 100 | バッチフラッシュの最大遅延 |

## 変更時の注意

- 通信方式は「Web Serial API」を基準に記述する（WebUSB は polyfill 経由のフォールバック）
- ScriptRunner は COOP/COEP が必須。`sw.js` と `vite.config.ts` のヘッダー設定と整合させること
- **Plotly はカスタム最小バンドル**（`src/plotly.ts`）。`plotly.js/lib/core` + `scattergl` トレースのみを登録し `react-plotly.js/factory` でコンポーネント化する。フル `plotly.js`（3D・地図・全トレース）を import すると本番バンドルが数 MB 肥大化するため禁止。チャートが `scattergl` 以外のトレースを使う場合のみ `src/plotly.ts` に登録を追加する
- **`scattergl` は性能上の選択ではなくデータモデル上の必然**。X 軸は `time` 以外に任意チャネル（`raw_*`/`phy_*`/`par_*`、計49種・`App.tsx` の `axisOptions`）を選べ、ひずみ-応力の繰り返しヒステリシスループのような **x が非単調・非一意のパラメトリック曲線 (x(t), y(t))** を描く。scatter トレースは点列を**配列順に結線**するためこれを表現できるが、一般的な line チャートは y = f(x) を前提に **x 昇順ソートを要求**する。チャートライブラリを差し替える場合、**scatter 相当のパラメトリック描画モデルを持つことが絶対条件**であり、これを満たさない uPlot（x は数値・一意・昇順が必須）・dygraphs・TradingView Lightweight Charts・TimeChart は**どれだけ軽量でも採用不可**。詳細と比較は `docs/chart-library-comparison.md`
- **`hoverinfo: 'skip'` + `hovermode: false` を外さないこと**（`ChartPanel.tsx`）。scattergl はホバー判定用の空間インデックスを毎更新で構築し、そのコストは `CHART_MAX_POINTS` に比例する。本アプリは `hovertemplate` も `onHover`/`onClick` も使っていないため純粋な無駄であり、これを止めた前提で `CHART_MAX_POINTS` を 2048 に上げている。**ホバーでの値読みを復活させる場合は `CHART_MAX_POINTS` を 1024 に戻すこと**
- **WebGL コンテキストは明示的に解放する**（`ChartPanel.tsx` の `releaseWebglContext`）。`Plotly.purge()`（react-plotly.js がアンマウント時に呼ぶ）は scattergl の WebGL コンテキストを破棄しない（plotly.js #2852 / #6365、後者は未解決）。解放しないとチャート差し替えのたびにコンテキストが増え、ブラウザ上限（概ね 8〜16）に達した時点で**古いチャートが黙って描画を停止する**。v3.1 以前にあった定期パージ（15分ごとの remount）はこの問題を悪化させるだけだったため廃止した。**「GPU 状態が溜まるから定期的に作り直す」という対策を再導入しないこと**
- **チャート間引きは描画モードで手法を変えること。** 時系列モード（X=time）は 1px ごとの **min/max 間引き**が使え、描画コストを O(点数)→O(ピクセル幅) に落としつつ尖頭値を保存できる。**XY パラメトリックモードでは min/max は使用不可** — 同一 x に往路と復路の異なる y が乗るため、列ごとの集約はループ形状（囲む面積＝散逸エネルギー）を破壊する。XY では連続ピクセルセル重複除去や RDP を用い、**周回ごとのドリフト情報を消さないこと**（グローバル重複除去は不可）。なお現行の stride 間引き（`App.tsx`）は 2 点に 1 点を無条件に捨てるため**単サンプル幅のスパイクを取りこぼす**。トレードオフ分析は `docs/chart-library-comparison.md` §4-4
- **間引き・描画の計算を主スレッドで重くしないこと。** 本アプリはデータロガーであり Modbus ポーリングも主スレッドで回るため、**描画側の負荷はポーリング周期のジッタ＝計測品質の劣化に直結する**。取り込み時の間引きは O(1)/点 を維持し、再描画時の走査が数 ms を超えるなら Worker へ移すこと（`tsvWriterWorker` / `pyodideWorker` に前例あり）
- **`detectRenderBackend()`（`ChartPanel.tsx`）の GPU/CPU バッジは概算**。Canvas2D は Chromium で GPU アクセラレーション対象だが、Skia は**アンチエイリアス付きの凹パス**（長い折れ線）を GPU でラスタライズできず CPU 経路に落ちるため、「Canvas2D=CPU」「WebGL=GPU」の二分法は**どちらの方向にも不正確**。描画方式の性能判断は必ず実機計測で行い、この表示を根拠にしないこと
- **ビルドチャンク分割**（`vite.config.ts`）: Plotly 等の vendor を `vendor` / React を `react-vendor` チャンクへ分離（PWA キャッシュ効率のため）。`build.target` は `es2022`（モダンブラウザ限定のため down-level 不要）
- **プリキャッシュ注入**（`vite.config.ts` の `precache-manifest` プラグイン）: ビルド時に `dist` の全アセットを走査し `dist/sw.js` の `PRECACHE_MANIFEST` / `CACHE_VERSION` / `APP_VERSION` を置換。`sw.js` 側のプレースホルダ（`const PRECACHE_MANIFEST = [];` / `const CACHE_VERSION = 'dev';` / `const APP_VERSION = '';`）の文字列を変更するとマッチしなくなり**オフライン動作や更新プロンプトのバージョン表示が壊れる**ため注意。アセット追加時は手書き不要（自動で含まれる）
- **`base` はコマンド分岐**（`vite.config.ts`）: `build` / `preview` は `/modbus_simple_logger/`（GitHub Pages）、`dev` は `/`（sub-path HMR/manifest の不具合回避）。`index.html` の `manifest.json` / `icon.svg` と `manifest.json` 内の `start_url`/`scope`/`icons` は **base 相対**で記述すること（subdir 直書き禁止）。SW 登録は `import.meta.env.BASE_URL` 経由で base 追従
- **`global` シム**（`vite.config.ts` の `define: { global: 'globalThis' }`）: カスタム Plotly バンドルが `plotly.js/lib` ソースの Node `global` 参照を含むため必須。削除しないこと
- **CJS interop**: `src/plotly.ts` の `interopDefault()` は `plotly.js/lib/*`・`react-plotly.js/factory` の CJS default を dev(esbuild)/prod(rolldown) 両対応で正規化する。これらの import を直接呼ばないこと
- ドキュメント更新時は README の技術スタック・ブラウザ要件と整合させる
- 不要な大規模リファクタリングは避け、目的に対して最小差分で変更する
- `index.css` は `@import "tailwindcss"` + `@custom-variant dark` 構成（Tailwind CSS 4 記法）
- 定数は `src/constants.ts` に一元化し、`App.tsx` や `dataStorage.ts` で重複定義しないこと
- `DataPoint` の `aiRaw`/`aiPhysical`/`aiVoltage` は `Float32Array` — 新規追加時も同様にすること
- **UI レイアウト**: AI Input カードの縦レベルメーターは `w-4`、AO カードにはレベルメーターを設けない。数値色は `getLevelColor()` で Raw/Phy はレベル連動、Voltage は固定青 (`text-sky-600`) を維持する
- **配色ルール（重要）**: 明示的な指示がない限り、新規 UI 要素の色指定は **他と同じ緑（emerald）か通常のグレー（slate）のみ**を使う。青(blue/sky)・琥珀(amber)・赤(red)などを新規に持ち込まない。
  - 緑はライト/ダークで濃淡を変える: 塗り = `bg-emerald-500 text-emerald-950 hover:bg-emerald-400`（`.button-primary` と同一）、文字/枠 = `text-emerald-600 dark:text-emerald-400` / `hover:border-emerald-400`、選択タブなどの塗り = `bg-emerald-500 text-emerald-950`
  - 通知/注意バナー等も緑（成功）かグレー（中立・ロック等）で表現し、赤や琥珀の警告色は使わない
  - UI 表示文言は英語で統一する（アプリ既存 UI に合わせる）
  - 既存コードの確立済みセマンティック色（危険表示の red、レベルメーターの red/yellow、電圧表示の sky 等）は現状維持でよいが、これらを新規要素へ拡張しない
- **ヘッダーリンク**: アプリタイトル `ModbusSimpleLogger` は `<a>` タグで GitHub リポジトリへリンクし、`target="_blank" rel="noopener noreferrer"` を付与する
- **キャリブレーションのロック**: ScriptRunner 実行中（`scriptRunner.scriptRunning`）は、スケール係数の書き換えを凍結する。`CalibrationPanel` は a・b セルと Load を無効化し、**オフセット c の直接編集と Tare は許可**（c調整は Tare と等価な原点調整のため）。`HX711CalibrationPanel` は「適用」（a/b/c 一括上書き）のみ無効化し、プレビューまでは可能。スクリプトからのキャリブレーション書込み口は `set_ai_tare`（c のみ）だけなので、Tare 系のみ通せば実行中の制御ループの Phy スケールが動く事故を防げる。Save 中はロックしない（TSV に raw も常時記録されるため phy は復元可能）
- **キャリブレーションウィザードの2方式**（`CalibrationWizardPanel` + `utils/calibration.ts`）: HX711(CH00-07)・ADS1115(CH08-15) 共通コンポーネントを2インスタンスで使用。**既定タブは実測フィット**（仕様書が手元に無い前提。Measured を先頭・初期表示に）。
  - ①実測フィット = `fitCalibration()`（2点→直線 a=0 / 3点以上・3種以上のRaw→2次最小二乗 / Raw2種→直線最小二乗 / それ未満→null）。各行の Grab は タップ=瞬間Raw / 長押し=離すまでの平均Raw。UI は3ゾーン（上部固定=ch/タブ/XYプロット(自前SVG・X:Raw Y:Phy＋フィット曲線)/点数コントロール/列見出し「# Physical Raw」、中央=測定点行のみスクロール、下部固定=プレビュー/適用）で、点数が増えてもプロットと見出しが見え続ける。
  - ②スペック計算 = `specToCalibration(感度, slopePerRaw)` で `b = 感度 × slopePerRaw`, a=0, c=0。`slopePerRaw` は基準（分母）単位ごとに `getDenominatorOptions(ch)` が供給する: HX711 は μV/V・mV/V・με の固定傾き（`hx711SlopePerRaw`）、ADS1115 は Raw（傾き1）と V/mV（`rawToDisplayValue(1, voltageConfig[ch])` から算出、レンジ Unknown 時は Raw のみ）。
  - 物理量(Phy)側の単位ラベルは持たない（従来どおり単位なしの Phy 表記）。適用は当該chの a/b/c を丸ごと上書き。

## 変更stage前やcommit前のpackage.json更新のための絶対的なルール
- 小規模変更(主観でいいです)ではマイナーバージョンをインクリメント
- マイナーバージョンが20になる場合は、メジャーバージョンを更新(Linux,Linus Torvaldsの思想)
- 大規模変更(主観でいいです)ではメジャーバージョンをインクリメント
- メジャーバージョンのインクリメント時は、マイナーをゼロに
