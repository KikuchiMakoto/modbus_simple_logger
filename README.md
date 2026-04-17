# modbus_simple_logger

Bun + React + TypeScript + Tailwind CSS 製の Modbus RTU ロガー SPA です。  
通信は **Web Serial API** を使用し、非対応環境では `web-serial-polyfill`（WebUSB 経由）を利用します。  
AI 16ch のポーリング、キャリブレーション、TSV保存、チャート表示に対応しています。

## WebApp
https://kikuchimakoto.github.io/modbus_simple_logger/

## セットアップ

```bash
bun install
bun run dev
```

## ビルド

```bash
bun run build
```

## 利用技術

- **フロントエンド**: React 19 / TypeScript / Vite 7 / Tailwind CSS
- **Modbus 通信**: Web Serial API（`navigator.serial`）+ `modbus-serial` の CRC16 実装
- **フォールバック**: `web-serial-polyfill`（主にモバイル/非対応環境で WebUSB 経由）
- **保存機能**:
  - File System Access API（`showSaveFilePicker`）で TSV ストリーミング保存
  - IndexedDB でセッション中データ管理（FIFO）
  - Cookie でテーマ・チャート軸・キャリブレーション設定を保持
- **可視化**: Plotly（`react-plotly.js`）
- **PWA**: Service Worker によるキャッシュ更新とオフライン時のフォールバック
- **電源管理**: Wake Lock API による計測中の画面スリープ抑止（対応ブラウザ）

## 主な機能

- Modbus RTU デバイス接続（デフォルト 38400bps、7/8 data bits・parity・stop bits 設定可）
- AI 16ch の定期ポーリング（200ms〜5分）と AO 8ch（Holding Register）の同期
- Modbus 精度モード（Normal(i16) / Extended(f32)）
- キャリブレーション `ax²+bx+c` の編集・Cookie保存・JSONダウンロード
- 計測データの TSV 出力（ヘッダー付き追記）
- 2 つのチャートで X/Y 軸を任意チャンネルに切り替え可能

## 動作要件

- 推奨ブラウザ: Chrome / Edge など Chromium 系最新版
- Web Serial API / File System Access API / Service Worker が有効な環境
- ScriptRunner（Pyodide）は COOP/COEP が有効なオリジン（`crossOriginIsolated`）でのみ利用可能（GitHub Pages では Service Worker 適用後の再読込で有効化）
