# Architecture — ModbusSimpleLogger

## 目的

`modbus-strain-calibrator` リポジトリは、元プロジェクト **ModbusSimpleLogger**（KikuchiMakoto 氏作の Modbus RTU ロガー SPA）を fork したものです。**HX711 ひずみゲージセンサーの検定**に特化した Web アプリへ派生させる予定で、本 wiki は fork 元コードベースの構造と、その上で新たに設計する検定アプリ（[design-strain-calibrator.md](design-strain-calibrator.md)）を取りまとめます。

## 全体構成

```
ブラウザ (SPA)
├── React 19 + TypeScript UI (src/App.tsx, src/components/*)
│   ├── AI 16ch カード（HX711 × 8 + ADS1115 × 8）
│   ├── AO 8ch カード（GP8403）
│   ├── Parameter 8ch カード（ScriptRunner scratch）
│   ├── Plotly チャート 4 枚
│   └── フローティング / スライドインパネル（react-rnd）
│
├── Modbus 通信層 (src/modbus/webserialClient.ts)
│   ├── Web Serial API（モバイルは web-serial-polyfill 経由）
│   ├── AsyncMutex によるフレーム送受信の排他制御
│   ├── 純粋 CRC16 (src/utils/crc16.ts)
│   └── Function Code: 1, 3, 4, 5, 6, 15, 16
│
├── ポーリング層 (src/App.tsx: pollOnce / runPollingLoop)
│   ├── 100ms 〜 5分の再帰 setTimeout
│   ├── リトライレート制限（60s ウィンドウで 10回まで）
│   ├── USB 物理抜け検知
│   └── pageshow / visibilitychange 復帰時即時ポーリング
│
├── データ層
│   ├── IndexedDB (src/utils/dataStorage.ts) — セッション FIFO
│   └── TSV ストリーミング (src/utils/tsvExport.ts) — File System Access API
│
├── ScriptRunner (src/pyodideWorker.ts, src/hooks/useScriptRunner.ts)
│   ├── Pyodide v314（v314.0.0 固定）を Web Worker にロード
│   ├── SharedArrayBuffer で AI データ共有
│   └── set_ao() でメインスレッドへ AO 制御
│
├── PWA (public/sw.js)
│   ├── 全レスポンスに COOP/COEP ヘッダ注入
│   ├── 全ビルドアセットをプリキャッシュ（オフライン対応）
│   └── ユーザー承諾ゲート付き SW 更新
│
└── 設定永続化 (src/utils/cookies.ts)
    ├── localStorage を一次情報源
    └── Cookie からの自動マイグレーション
```

## 主要モジュール

| パス | 役割 | 重要度 |
|------|------|--------|
| `src/App.tsx` | UI・計測フロー・ポーリングの中枢（カスタムフック多用、1500行超） | ★★★ |
| `src/modbus/webserialClient.ts` | Web Serial + Modbus RTU フレーム送受信 | ★★★ |
| `src/utils/calibration.ts` | 既存の `a·x²+b·x+c` キャリブレーション + 電圧変換 | ★★ |
| `src/utils/crc16.ts` | 純粋 CRC16 実装（外部依存なし） | ★ |
| `src/components/ChartPanel.tsx` | Plotly scattergl チャート（軸切替対応） | ★★ |
| `src/components/FloatingWindow.tsx` | react-rnd ベース フローティングウィンドウ | ★ |
| `src/constants.ts` | 全チャネル数・タイミング定数 | ★ |
| `src/hooks/useTheme.ts` | ダーク/ライト切替（localStorage） | ★ |
| `src/pyodideWorker.ts` | Pyodide ワーカー（**検定アプリでは削除予定**） | ★ |

## 検定アプリ（派生）での変更方針

- 残す: Modbus 通信層・CRC16・チャートの最小構成・localStorage 設定・PWA
- 削る: ScriptRunner（Pyodide ワーカー、フック、UI）、AO 8ch、Parameter 8ch、Voltage モード切替、ADS1115 関連コード、HamburgerMenu、SlidePanel、`AppInfoPanel`（簡略化）、`tsvExport`（CSV/JSON 軽量版に置換）
- 追加: 検定ワークベンチ UI、最小二乗法モジュール、回帰プロット
- 置換: パッケージマネージャを bun → **pnpm** に変更。`Hx711` 1〜2ch 専用に UI を作り直し

詳細は [design-strain-calibrator.md](design-strain-calibrator.md) を参照。

## 関連ページ

- [modbus-client.md](modbus-client.md) — Modbus 通信層の詳細
- [polling.md](polling.md) — ポーリング・状態管理
- [data-persistence.md](data-persistence.md) — IndexedDB / TSV
- [calibration.md](calibration.md) — 既存キャリブレーション
- [pwa-sw.md](pwa-sw.md) — PWA / Service Worker
- [build.md](build.md) — Vite / Tailwind / Plotly 設定
- [conventions.md](conventions.md) — 命名規則・型・スタイル
- [design-strain-calibrator.md](design-strain-calibrator.md) — 新アプリ設計
