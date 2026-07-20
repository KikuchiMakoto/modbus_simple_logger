# AGENTS.md

このリポジトリで作業するエージェント向けの簡易ガイドです。

## プロジェクト概要

- **React 19 + TypeScript 6.0 + Vite 8 + Tailwind CSS 4** で構成された Modbus RTU ロガー SPA
- 通信は **Web Serial API**（非対応環境では `web-serial-polyfill` 経由で WebUSB フォールバック）
- **Tauri 2 ホスト** ビルド対応（WebView2 + Rust バックエンドの `serialport` crate）。Web 版と同一の SPA を配布可能
- AI 16ch（HX711 × 8 + ADS1115 × 8）/ AO 8ch（GP8403）のポーリングと制御
- 計測データは IndexedDB（セッション中 FIFO）と TSV（File System Access API ストリーミング）で扱う
- Plotly.js（`react-plotly.js`）によるリアルタイムチャート表示
- Pyodide（Web Worker + SharedArrayBuffer）による ScriptRunner 機能
- PWA: Service Worker によるキャッシュとオフラインフォールバック
- Wake Lock API による計測中の画面スリープ抑止

## 主要コマンド

```bash
bun install
bun run dev            # Web 版 dev (Vite のみ)
bun run build          # Web 版 prod build (GitHub Pages デプロイ)
bun run tauri:dev      # Tauri ホストで dev (Vite + WebView2)
bun run tauri:build    # Tauri リリースビルド (NSIS + MSI)
```

## ディレクトリ構造

```
src/
├── App.tsx                          # UI・計測フロー・ポーリングの中枢（リファクタ済み・カスタムフック使用）
├── main.tsx                         # エントリポイント + SW 登録（PWA時のみ）+ Error Boundary
├── index.css                        # Tailwind + カスタムクラス
├── types.ts                         # 型定義（AiChannel, AoChannel, DataPoint, SerialSettings 等）
├── constants.ts                     # 一元化された定数（AI_CHANNELS, MAX_POINTS_* 等）
├── modbus/
│   ├── modbusClientBase.ts          # Modbus RTU 共通ロジック（mutex・CRC・min-interval・FC 1/3/4/5/6/15/16）
│   ├── webserialClient.ts           # Web Serial トランスポート（ModbusClientBase サブクラス）
│   └── tauriModbusClient.ts         # Tauri トランスポート（serialport crate 経由）
├── pyodideWorker.ts                 # Pyodide ScriptRunner 用 Web Worker
├── hooks/
│   ├── useTheme.ts                  # テーマ管理（localStorage 永続化）
│   ├── useChartAxes.ts              # チャート軸設定（localStorage 永続化）
│   └── useScriptRunner.ts           # Pyodide Worker 管理
├── components/
│   ├── ChartPanel.tsx               # Plotly チャート（X/Y 軸切替、空状態表示）
│   ├── CalibrationPanel.tsx         # キャリブレーションウィンドウ（a·x²+b·x+c）
│   ├── ModbusConfigPanel.tsx        # シリアル設定ウィンドウ（Tauri 時はポート選択 UI 追加）
│   ├── VoltageConfigPanel.tsx       # 電圧表示モード設定（チャネルタイプ別フィルタ）
│   ├── HamburgerMenu.tsx            # スライドインメニュー
│   ├── SlidePanel.tsx               # 共通スライドインパネル（HamburgerMenu 専用・backdrop アニメーション付き）
│   └── FloatingWindow.tsx           # 共通フローティングウィンドウ（react-rnd・ドラッグ/リサイズ/前面化）
├── tauri/
│   └── runtime.ts                   # `isTauri()` 実行時検出 (`window.__TAURI_INTERNALS__`)
└── utils/
    ├── calibration.ts               # キャリブレーション計算（HX711 mV/V・μɛ, ADS1115 V）
    ├── dataStorage.ts               # IndexedDB ラッパー（Singleton・冪等 init）
    ├── tsvExport.ts                 # TSV ストリーミングライター（File System Access / Tauri dialog）
    ├── cookies.ts                   # 後方互換: Cookie 読込 → localStorage 移行
    └── crc16.ts                     # 純粋 CRC16 実装（Modbus RTU 用）
src-tauri/                           # Tauri ホスト（Rust）
├── Cargo.toml                       # serialport 4 + tauri 2 + tauri-plugin-dialog 2
├── tauri.conf.json                  # devUrl=1420, frontendDist=../dist, COOP/COEP ヘッダー
├── capabilities/default.json        # core:default + dialog:default
├── src/{main.rs,lib.rs}             # エントリ + serial/tsv Tauri コマンド
└── icons/                           # `tauri icon public/icon.svg` で生成
public/
├── sw.js                            # Service Worker（COOP/COEP ヘッダー注入付き）
├── manifest.json                    # PWA マニフェスト
└── icon.svg                         # アプリアイコン
.vscode/
├── tasks.json                       # Web/Tauri dev・build、Rust check、icon 再生成
├── launch.json                      # Tauri dev ホストに cppvsdbg でアタッチ
└── extensions.json                  # rust-analyzer / tauri-vscode 等を推奨
.github/workflows/
└── tauri-release.yml                # Windows installer Release draft（tauri-action@v0）
```

## アーキテクチャ上の重要点

### Modbus 通信（`modbusClientBase.ts` / `webserialClient.ts` / `tauriModbusClient.ts`）
- `AsyncMutex` で転送の排他制御（基底クラスに集約）
- CRC16 検証（純粋関数 `utils/crc16.ts`、`buffer`/`modbus-serial` 依存なし）
- 精度モードに応じた最小メッセージ間隔（Normal: 10ms / Extended: 1ms）
- 転送エラー後の受信バッファフラッシュ（`flushReceiveBuffer`）
- サポート Function Code: 1, 3, 4, 5, 6, 15, 16
- トランスポート抽象: `ModbusClientBase`（基底）がフレーム構築・CRC・Mutex・min-interval を保持し、`rawTransfer` のみサブクラスが実装
  - `WebSerialModbusClient`: Web Serial / WebUSB polyfill。Reader リカバリ（cancel → releaseLock → reacquire）
  - `TauriModbusClient`: Tauri コマンド `serial_open` / `serial_close` / `serial_transfer` 経由で Rust `serialport` crate と通信。USB 抜けは次の transfer 失敗で検出

### USB転送間隔制約（重要）

USB Serial変換IC（CH340, FT232等）経由で UART→ModbusRTU を受信するデバイスでは、
USBパケット遅延・詰まりによる通信エラーを防ぐため、**Modbus RTU フレーム送信間に
最低10msの間隔が必須**。

- `modbusClientBase.ts` の `transfer()` 内の `minMessageIntervalMs` がこれを担保（Normal: 10ms / Extended: 1ms）
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
  - 保存時: 保存開始〜現在の全期間を `CHART_MAX_POINTS`(4096) へストライド間引き（`saveDecimationStrideRef`/`saveRawCounterRef`、バッファが 2×超で偶数 index 再間引き＆stride 倍化 → メモリ一定）
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
- **TSV**: Web は File System Access API（`showSaveFilePicker`）、Tauri は `@tauri-apps/plugin-dialog` の `save()` + Rust コマンド `tsv_create_file` / `tsv_append`（OpenOptions append）でストリーミング書き出し
  - ヘッダーに `seq` 列を追加
  - `Float32Array` / `number[]` の両方を受け付ける
  - Tauri 時は abort 時に `DOMException(AbortError)` を throw して Web 側と挙動を揃える
- **設定永続化**: **localStorage** にテーマ・チャート軸・キャリブレーションを JSON 保存
  - Cookie からの自動移行機能付き（読込時に localStorage へ移行し Cookie を削除）

### Tauri ホスト（Web 版と共通の SPA を Windows ネイティブシェルで配布）
- 実行時検出: `src/tauri/runtime.ts` の `isTauri()`（`window.__TAURI_INTERNALS__` 存在チェック）。`withGlobalTauri: false` のためグローバル `window.__TAURI__` は使わず `import { invoke } from '@tauri-apps/api/core'` で参照
- トランスポート分岐: `App.tsx` の `tauriMode` フラグで `TauriModbusClient` / `WebSerialModbusClient` を切替。`isTauri()` 時に `navigator.serial` 等の web 経路を一切読まない（バンドル削減と誤動作防止）
- Tauri 時のポート選択: `ModbusConfigPanel` の追加 UI（`availablePorts` / `selectedPort` / `onRefreshPorts` / `portListLoading`）。`list_serial_ports` コマンドで `serialport::available_ports()` を列挙
- サービスワーカー無効化: Tauri では `frontendDist` をカスタムプロトコルで配信するため SW の意味がない。`main.tsx` で `'serviceWorker' in navigator && !isTauri()` により登録自体をスキップ（PWA の `registration.update()` による不要なネット probe も抑止）
- **SharedArrayBuffer**: Tauri の `app.security.headers` で COOP=`same-origin` / COEP=`require-corp` を注入（Vite dev server 側は `server.headers` で同じ設定。`vite.config.ts` の `isTauri` 検出で `TAURI_ENV_PLATFORM` 時に `port: 1420, strictPort: true`）。ScriptRunner は Web 版と同一の Pyodide バンドルで完全オフライン動作
- 通信は `serialport` 4 系（Rust）+ `tauri-plugin-dialog` 2 系。ウィンドウは WebView2。**`tauri-plugin-updater` は導入しない**（オンラインリソース確認ゼロ要件のため）。更新は GitHub Releases のインストーラー差替で配布
- VSCode: `.vscode/tasks.json`（Web / Tauri dev・build、Rust check、icon 再生成）、`launch.json`（`cppvsdbg` で Tauri dev ホストにアタッチ）、`extensions.json`（`rust-analyzer` / `tauri-vscode` 等）
- CI: `.github/workflows/tauri-release.yml` が `v*` タグ push / 手動実行で Windows インストーラー（NSIS + MSI）を `tauri-action@v0` でビルドしドラフト Release に添付

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
| `CHART_MAX_POINTS` | 4096 | チャート描画点数の上限（保存時ダウンサンプル目標） |
| `NON_SAVING_CHART_WINDOW_MS` | 60000 | 非保存時チャートのスライディング時間窓 |
| `BATCH_FLUSH_THRESHOLD` | 5 | バッチフラッシュのペンド件数閾値 |
| `BATCH_FLUSH_INTERVAL_MS` | 100 | バッチフラッシュの最大遅延 |

## 変更時の注意

- 通信方式は「Web Serial API」を基準に記述する（WebUSB は polyfill 経由のフォールバック）。Tauri 時は Rust 経由のネイティブシリアルに自動切替（`isTauri()` 判定）
- ScriptRunner は COOP/COEP が必須。`sw.js`（Web）と `tauri.conf.json > app.security.headers`（Tauri）と `vite.config.ts`（dev/preview）のヘッダー設定を**すべて**整合させること
- **Plotly はカスタム最小バンドル**（`src/plotly.ts`）。`plotly.js/lib/core` + `scattergl` トレースのみを登録し `react-plotly.js/factory` でコンポーネント化する。フル `plotly.js`（3D・地図・全トレース）を import すると本番バンドルが数 MB 肥大化するため禁止。チャートが `scattergl` 以外のトレースを使う場合のみ `src/plotly.ts` に登録を追加する
- **ビルドチャンク分割**（`vite.config.ts`）: Plotly 等の vendor を `vendor` / React を `react-vendor` チャンクへ分離（PWA キャッシュ効率のため）。`build.target` は `es2022`（モダンブラウザ限定のため down-level 不要）
- **プリキャッシュ注入**（`vite.config.ts` の `precache-manifest` プラグイン）: ビルド時に `dist` の全アセットを走査し `dist/sw.js` の `PRECACHE_MANIFEST` / `CACHE_VERSION` / `APP_VERSION` を置換。`sw.js` 側のプレースホルダ（`const PRECACHE_MANIFEST = [];` / `const CACHE_VERSION = 'dev';` / `const APP_VERSION = '';`）の文字列を変更するとマッチしなくなり**オフライン動作や更新プロンプトのバージョン表示が壊れる**ため注意。アセット追加時は手書き不要（自動で含まれる）
- **`base` は `isTauri` 分岐**（`vite.config.ts`）: Tauri CLI 実行中（`process.env.TAURI_ENV_PLATFORM` 真）は常に `/`（カスタムプロトコルの root）、それ以外は `build` / `preview` で `/modbus_simple_logger/`（GitHub Pages）、`dev` で `/`（sub-path HMR/manifest の不具合回避）。`index.html` の `manifest.json` / `icon.svg` と `manifest.json` 内の `start_url`/`scope`/`icons` は **base 相対**で記述すること（subdir 直書き禁止）。SW 登録は `import.meta.env.BASE_URL` 経由で base 追従
- **`global` シム**（`vite.config.ts` の `define: { global: 'globalThis' }`）: カスタム Plotly バンドルが `plotly.js/lib` ソースの Node `global` 参照を含むため必須。削除しないこと
- **CJS interop**: `src/plotly.ts` の `interopDefault()` は `plotly.js/lib/*`・`react-plotly.js/factory` の CJS default を dev(esbuild)/prod(rolldown) 両対応で正規化する。これらの import を直接呼ばないこと
- **Tauri リリースで `tauri-plugin-updater` を安易に追加しない**（オンラインリソース確認ゼロ要件を破る）。バージョンアップは GitHub Releases への新規インストーラー添付で配布し、ユーザーは手動でインストール
- ドキュメント更新時は README の技術スタック・ブラウザ要件と整合させる
- 不要な大規模リファクタリングは避け、目的に対して最小差分で変更する
- `index.css` は `@import "tailwindcss"` + `@custom-variant dark` 構成（Tailwind CSS 4 記法）
- 定数は `src/constants.ts` に一元化し、`App.tsx` や `dataStorage.ts` で重複定義しないこと
- `DataPoint` の `aiRaw`/`aiPhysical`/`aiVoltage` は `Float32Array` — 新規追加時も同様にすること
- **UI レイアウト**: AI Input カードの縦レベルメーターは `w-4`、AO カードにはレベルメーターを設けない。数値色は `getLevelColor()` で Raw/Phy はレベル連動、Voltage は固定青 (`text-sky-600`) を維持する
- **ヘッダーリンク**: アプリタイトル `ModbusSimpleLogger` は `<a>` タグで GitHub リポジトリへリンクし、`target="_blank" rel="noopener noreferrer"` を付与する

## 変更stage前やcommit前のpackage.json更新のための絶対的なルール
- 小規模変更(主観でいいです)ではマイナーバージョンをインクリメント
- マイナーバージョンが20になる場合は、メジャーバージョンを更新(Linux,Linus Torvaldsの思想)
- 大規模変更(主観でいいです)ではメジャーバージョンをインクリメント
- メジャーバージョンのインクリメント時は、マイナーをゼロに
