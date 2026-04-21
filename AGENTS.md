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
│   ├── CalibrationPanel.tsx         # キャリブレーションサイドパネル（a·x²+b·x+c）
│   ├── ModbusConfigPanel.tsx        # シリアル設定サイドパネル
│   ├── VoltageConfigPanel.tsx       # 電圧表示モード設定（チャネルタイプ別フィルタ）
│   ├── HamburgerMenu.tsx            # スライドインメニュー
│   └── SlidePanel.tsx               # 共通スライドインパネル（backdrop アニメーション付き）
└── utils/
    ├── calibration.ts               # キャリブレーション計算（HX711 mV/V・μɛ, ADS1115 V）
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

### ポーリング（`App.tsx`）
- 200ms〜5分の定期ポーリング（`setTimeout` 再帰スケジュール）
- AI 読取り / AO 書込みそれぞれ独立のリトライレート制限（60s ウィンドウ内最大10回）
- チャート表示ポイント上限: 通常 256 / 保存中 65536
- ペンドデータポイントのバッチフラッシュ（5件 or 100ms ごと）
- `pageshow` / `visibilitychange` による復帰時即時ポーリング（`acquiring` 状態を ref で確認）
- USB 物理抜けの `disconnect` イベント自動検知
- **キャリブレーション変更時もポーリングは継続**（`aiCalibrationRef` で最新値を参照）
- **ステータス更新は ref 経由で直接 DOM を更新**（不要な React 再レンダリングを抑制）

### ScriptRunner（`pyodideWorker.ts`）
- Pyodide v0.27.5 を CDN からロード（Web Worker 内）
- `SharedArrayBuffer` 経由で AI データを Worker と共有（**Float32Array**）
- `set_ao()` / `set_ao_all()` でメインスレッドへ AO 制御命令を postMessage
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
- ナビゲーション: Network-first + キャッシュフォールバック
  - キャッシュ保存時に `request` と `BASE_PATH + 'index.html'` の両方に保存（キー不一致防止）
- 静的アセット: Stale-While-Revalidate
- `vite.config.ts` の `server.headers` / `preview.headers` でも COOP/COEP を設定
- SW 更新時は `window.confirm()` でユーザー確認（計測中断防止）
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
| `MAX_POINTS_IN_MEMORY` | 256 | 通常時のチャート表示上限 |
| `MAX_POINTS_WHILE_SAVING` | 65536 | 保存中のチャート表示上限 |
| `BATCH_FLUSH_THRESHOLD` | 5 | バッチフラッシュのペンド件数閾値 |
| `BATCH_FLUSH_INTERVAL_MS` | 100 | バッチフラッシュの最大遅延 |

## 変更時の注意

- 通信方式は「Web Serial API」を基準に記述する（WebUSB は polyfill 経由のフォールバック）
- ScriptRunner は COOP/COEP が必須。`sw.js` と `vite.config.ts` のヘッダー設定と整合させること
- `react-plotly.js` は CJS/ESM interop の問題があるため `ChartPanel.tsx` で正規化済み（直接 `Plot` をインポートしないこと）
- ドキュメント更新時は README の技術スタック・ブラウザ要件と整合させる
- 不要な大規模リファクタリングは避け、目的に対して最小差分で変更する
- `index.css` は `@import "tailwindcss"` + `@custom-variant dark` 構成（Tailwind CSS 4 記法）
- 定数は `src/constants.ts` に一元化し、`App.tsx` や `dataStorage.ts` で重複定義しないこと
- `DataPoint` の `aiRaw`/`aiPhysical`/`aiVoltage` は `Float32Array` — 新規追加時も同様にすること
- **UI レイアウト**: AI Input カードの縦レベルメーターは `w-4`、AO カードにはレベルメーターを設けない。数値色は `getLevelColor()` で Raw/Phy はレベル連動、Voltage は固定青 (`text-sky-600`) を維持する
- **ヘッダーリンク**: アプリタイトル `ModbusSimpleLogger` は `<a>` タグで GitHub リポジトリへリンクし、`target="_blank" rel="noopener noreferrer"` を付与する
