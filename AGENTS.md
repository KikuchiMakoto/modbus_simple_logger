# AGENTS.md

このリポジトリで作業するエージェント向けの簡易ガイドです。

## プロジェクト概要

- **React 19 + TypeScript 6 + Vite 8 + Tailwind CSS 4** で構成された Modbus RTU ロガー SPA
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
├── App.tsx                          # UI・計測フロー・ポーリングの中枢
├── main.tsx                         # エントリポイント + SW 登録
├── index.css                        # Tailwind + カスタムクラス
├── types.ts                         # 型定義（AiChannel, AoChannel, DataPoint, SerialSettings 等）
├── modbus/
│   └── webserialClient.ts           # Web Serial トランスポート + Modbus RTU フレーム送受信
├── pyodideWorker.ts                 # Pyodide ScriptRunner 用 Web Worker
├── components/
│   ├── ChartPanel.tsx               # Plotly チャート（X/Y 軸切替、WebGL 自動検出）
│   ├── CalibrationPanel.tsx         # キャリブレーションサイドパネル（a·x²+b·x+c）
│   ├── ModbusConfigPanel.tsx        # シリアル設定サイドパネル
│   └── HamburgerMenu.tsx            # スライドインメニュー
└── utils/
    ├── calibration.ts               # キャリブレーション計算（HX711 mV/V・μɛ, ADS1115 V）
    ├── dataStorage.ts               # IndexedDB ラッパー（Singleton）
    ├── tsvExport.ts                  # TSV ストリーミングライター（File System Access API）
    └── cookies.ts                   # JSON Cookie 読み書きユーティリティ
public/
├── sw.js                            # Service Worker（COOP/COEP ヘッダー注入付き）
├── manifest.json                    # PWA マニフェスト
└── icon.svg                         # アプリアイコン
```

## アーキテクチャ上の重要点

### Modbus 通信（`webserialClient.ts`）
- `AsyncMutex` で転送の排他制御
- CRC16 検証（`modbus-serial/utils/crc16`）
- 精度モードに応じた最小メッセージ間隔（Normal: 10ms / Extended: 1ms）
- 転送エラー後の受信バッファフラッシュ（`flushReceiveBuffer`）
- サポート Function Code: 1, 3, 4, 5, 6, 15, 16

### ポーリング（`App.tsx`）
- 200ms〜5分の定期ポーリング（`setTimeout` 再帰スケジュール）
- AI 読取り / AO 書込みそれぞれ独立のリトライレート制限（60s ウィンドウ内最大10回）
- チャート表示ポイント上限: 通常 256 / 保存中 65536
- ペンドデータポイントのバッチフラッシュ（5件 or 100ms ごと）
- `pageshow` / `visibilitychange` による復帰時即時ポーリング
- USB 物理抜けの `disconnect` イベント自動検知

### ScriptRunner（`pyodideWorker.ts`）
- Pyodide v0.27.5 を CDN からロード（Web Worker 内）
- `SharedArrayBuffer` 経由で AI データを Worker と共有
- `set_ao()` / `set_ao_all()` でメインスレッドへ AO 制御命令を postMessage
- `SharedArrayBuffer` による割込み停止（`interruptBuffer[0] = 2`）
- **COOP/COEP ヘッダー必須**（`SharedArrayBuffer` 利用のため）

### データ保存
- **IndexedDB**: セッション中の全データポイントを蓄積（`keepLatestPoints` で自動トリム）
- **TSV**: File System Access API（`showSaveFilePicker`）でストリーミング書き出し
- **設定永続化**: Cookie にテーマ・チャート軸・キャリブレーションを JSON 保存

### PWA / Service Worker
- `sw.js` は全レスポンスに COOP/COEP ヘッダーを注入
- ナビゲーション: Network-first + キャッシュフォールバック
- 静的アセット: Stale-While-Revalidate
- `vite.config.ts` の `server.headers` / `preview.headers` でも COOP/COEP を設定

## 主要定数（`App.tsx`）

| 定数 | 値 | 説明 |
|------|------|------|
| `AI_CHANNELS` | 16 | AI チャネル数 |
| `AO_CHANNELS` | 8 | AO チャネル数（GP8403） |
| `AI_START_REGISTER` | 0 | AI Input Register 開始アドレス（Normal） |
| `AI_FLOAT_START_REGISTER` | 5000 | AI Input Register 開始アドレス（Extended） |
| `AO_START_REGISTER` | 0 | AO Holding Register 開始アドレス |
| `MAX_POINTS_IN_MEMORY` | 256 | 通常時のチャート表示上限 |
| `MAX_POINTS_WHILE_SAVING` | 65536 | 保存中のチャート表示上限 |

## 変更時の注意

- 通信方式は「Web Serial API」を基準に記述する（WebUSB は polyfill 経由のフォールバック）
- ScriptRunner は COOP/COEP が必須。`sw.js` と `vite.config.ts` のヘッダー設定と整合させること
- `react-plotly.js` は CJS/ESM interop の問題があるため `ChartPanel.tsx` で正規化済み（直接 `Plot` をインポートしないこと）
- ドキュメント更新時は README の技術スタック・ブラウザ要件と整合させる
- 不要な大規模リファクタリングは避け、目的に対して最小差分で変更する
- `index.css` は `@import "tailwindcss"` + `@custom-variant dark` 構成（Tailwind CSS 4 記法）
