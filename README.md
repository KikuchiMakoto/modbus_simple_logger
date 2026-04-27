# ModbusSimpleLogger

**ModbusSimpleLogger** は、ブラウザ上で動作する Modbus RTU ロガー SPA です。Web Serial API を利用してローカルの Modbus RTU デバイスと通信し、AI（Analog Input）16ch のリアルタイム計測、キャリブレーション、データ保存、チャート表示を行います。

🔌 **デモ**: https://kikuchimakoto.github.io/modbus_simple_logger/

---

## 主な機能

| 機能 | 説明 |
|------|------|
| **Modbus RTU 通信** | Web Serial API（`navigator.serial`）によるローカルデバイス接続。非対応環境では `web-serial-polyfill` 経由の WebUSB フォールバック |
| **AI 16ch ポーリング** | HX711 × 8ch + ADS1115 × 8ch の定期読み取り（200ms〜5分間隔で設定可能） |
| **AO 8ch 制御** | GP8403（Holding Register）への書き込み・同期。ScriptRunner による自動制御も可能 |
| **2 精度モード** | Normal（i16）/ Extended（f32）の切り替え対応 |
| **キャリブレーション** | 各チャネルごとに `a·x² + b·x + c` の多項式キャリブレーションを編集・保存（localStorage）・JSON インポート/エクスポート |
| **電圧表示モード** | HX711（mV/V、με）/ ADS1115（V、mV）の計測モードをチャネルごとに設定可能 |
| **リアルタイムチャート** | Plotly.js による 2 画面チャート。X/Y 軸を任意のチャネル（Raw/Physical）に切り替え可能 |
| **データ保存** | File System Access API による TSV ストリーミング保存。IndexedDB でセッション中のデータを FIFO 管理 |
| **ScriptRunner** | Pyodide（Web Worker + SharedArrayBuffer）による Python スクリプト実行。`set_ao()` / `set_ao_all()` で AO 制御 |
| **PWA** | Service Worker によるオフライン対応。COOP/COEP ヘッダー注入で SharedArrayBuffer を有効化 |
| **画面スリープ抑止** | Wake Lock API による計測中の画面スリープ防止（対応ブラウザ） |
| **ダークモード** | ライト/ダークテーマ切り替え（localStorage 永続化） |

---

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | React | ^19.2.5 |
| 言語 | TypeScript | ^6.0.3 |
| ビルドツール | Vite | ^8.0.9 |
| スタイリング | Tailwind CSS | ^4.2.3 |
| チャート | Plotly.js + react-plotly.js | ^3.5.0 / ^2.6.0 |
| Modbus 通信 | Web Serial API + web-serial-polyfill | ^1.0.15 |
| スクリプト実行 | Pyodide（CDN v0.27.5） | — |
| パッケージマネージャ | Bun | — |

---

## クイックスタート

### 必要条件

- [Bun](https://bun.sh/) がインストールされていること
- Chrome / Edge などの Chromium 系最新版ブラウザ（Web Serial API / File System Access API 対応）

### インストール

```bash
bun install
```

### 開発サーバー起動

```bash
bun run dev
```

開発サーバーはデフォルトで `http://localhost:5173` で起動します。

### ビルド

```bash
bun run build
```

ビルド成果物は `dist/` ディレクトリに出力されます。

### プレビュー

```bash
bun run preview
```

---

## ブラウザ要件

| API | 用途 | 備考 |
|-----|------|------|
| Web Serial API | Modbus RTU 通信 | Chrome 89+ / Edge 89+。モバイルでは `web-serial-polyfill` 経由で WebUSB を利用 |
| File System Access API | TSV ファイル保存 | Chrome 86+ / Edge 86+。非対応環境では保存機能が利用不可 |
| Service Worker | PWA・オフライン対応 | 全モダンブラウザ対応 |
| SharedArrayBuffer | Pyodide Worker との高速データ共有 | COOP/COEP ヘッダーが必要。`vite.config.ts` と `sw.js` で設定済み |
| Wake Lock API | 画面スリープ抑止 | Chrome 84+ / Edge 84+。非対応環境では無視して継続 |

> **注意**: Safari / Firefox では Web Serial API が未対応のため、基本的に動作しません。モバイル環境では Android + Chrome の組み合わせを推奨します。

### Linux でのシリアルポート権限設定

Linux で Web Serial API を使うと「アクセスが拒否された」「ポートが見つからない」などのエラーが出ることがあります。以下をコピーしてターミナルで一括実行してください。

```bash
sudo systemctl stop brltty-usb.service brltty.service serial-getty@ttyACM0.service serial-getty@ttyUSB0.service 2>/dev/null || true
sudo systemctl disable brltty-usb.service serial-getty@ttyACM0.service serial-getty@ttyUSB0.service 2>/dev/null || true
sudo usermod -aG dialout $USER
echo 'KERNEL=="ttyACM[0-9]*", GROUP="dialout", MODE="0660"
KERNEL=="ttyUSB[0-9]*", GROUP="dialout", MODE="0660"' | sudo tee /etc/udev/rules.d/99-usb-serial.rules >/dev/null
sudo udevadm control --reload-rules && sudo udevadm trigger
echo "完了。再ログインまたは newgrp dialout で権限を反映してください。"
```

**このスクリプトがやっていること**
1. `brltty`（点字支援サービス）がシリアルポートを掴むのを止める
2. `serial-getty`（シリアルコンソールログイン）がポートを占有するのを止める
3. あなたを `dialout` グループに追加 → `/dev/ttyACM*` や `/dev/ttyUSB*` の読み書きが可能に
4. udev で「CDC-ACM / USB-シリアル デバイス全体」に対して自動で `dialout` 権限を付与

> **再ログインが必要**: グループ変更は新しいセッションで初めて反映されます。
>
> **ModemManager を使っている場合**: `sudo systemctl stop ModemManager.service` も追加で実行してください。

---

## アーキテクチャ概要

### Modbus 通信（`src/modbus/webserialClient.ts`）

- `AsyncMutex` による転送排他制御
- 純粋 CRC16 実装（`src/utils/crc16.ts`）。外部ライブラリ `buffer` / `modbus-serial` への依存なし
- 精度モードに応じた最小メッセージ間隔（Normal: 10ms / Extended: 1ms）
- タイムアウト時の Reader リカバリ（cancel → releaseLock → reacquire）
- サポート Function Code: 1, 3, 4, 5, 6, 15, 16

### ポーリング（`src/App.tsx`）

- `setTimeout` 再帰スケジュールによる 200ms〜5分間隔のポーリング
- AI 読取り / AO 書込みの独立したリトライレート制限（60秒ウィンドウ内最大10回）
- `pageshow` / `visibilitychange` による復帰時即時ポーリング
- USB 物理抜けの `disconnect` イベント自動検知
- ステータス更新は `ref` 経由で直接 DOM を更新し、不要な React 再レンダリングを抑制

### データ保存

- **IndexedDB**: セッション中の全データポイントを蓄積。`keepLatestPoints` で自動トリム
- **TSV**: File System Access API（`showSaveFilePicker`）でストリーミング書き出し。ヘッダーに `seq` 連番列を追加
- **設定永続化**: localStorage にテーマ・チャート軸・キャリブレーション・電圧モードを JSON 保存。Cookie からの自動移行機能付き

### ScriptRunner（`src/pyodideWorker.ts`）

- Pyodide v0.27.5 を CDN から Web Worker 内にロード
- `SharedArrayBuffer` 経由で AI データ（Float32Array）を Worker と共有
- `set_ao()` / `set_ao_all()` でメインスレッドへ AO 制御命令を postMessage
- `interruptBuffer[0] = 2` による割込み停止
- Worker init 失敗時は `initPromise` をリセットし再試行可能

### PWA / Service Worker（`public/sw.js`）

- 全レスポンスに COOP/COEP ヘッダーを注入（SharedArrayBuffer 利用のため）
- ナビゲーション: Network-first + キャッシュフォールバック
- 静的アセット: Stale-While-Revalidate
- SW 更新時は `window.confirm()` でユーザー確認（計測中断防止）

---

## ディレクトリ構造

```
src/
├── App.tsx                          # UI・計測フロー・ポーリングの中枢
├── main.tsx                         # エントリポイント + SW 登録 + Error Boundary
├── index.css                        # Tailwind CSS 4 + カスタムクラス
├── types.ts                         # 型定義
├── constants.ts                     # 一元化された定数
├── modbus/
│   └── webserialClient.ts           # Web Serial トランスポート + Modbus RTU フレーム送受信
├── pyodideWorker.ts                 # Pyodide ScriptRunner 用 Web Worker
├── hooks/
│   ├── useTheme.ts                  # テーマ管理（localStorage 永続化）
│   ├── useChartAxes.ts              # チャート軸設定（localStorage 永続化）
│   └── useScriptRunner.ts           # Pyodide Worker 管理
├── components/
│   ├── ChartPanel.tsx               # Plotly チャート
│   ├── CalibrationPanel.tsx         # キャリブレーションサイドパネル
│   ├── ModbusConfigPanel.tsx        # シリアル設定サイドパネル
│   ├── VoltageConfigPanel.tsx       # 電圧表示モード設定
│   ├── HamburgerMenu.tsx            # スライドインメニュー
│   └── SlidePanel.tsx               # 共通スライドインパネル
└── utils/
    ├── calibration.ts               # キャリブレーション計算 + レベルメーター色関数
    ├── dataStorage.ts               # IndexedDB ラッパー（Singleton・冪等 init）
    ├── tsvExport.ts                 # TSV ストリーミングライター
    ├── cookies.ts                   # 後方互換: Cookie 読込 → localStorage 移行
    └── crc16.ts                     # 純粋 CRC16 実装
public/
├── sw.js                            # Service Worker（COOP/COEP ヘッダー注入付き）
├── manifest.json                    # PWA マニフェスト
└── icon.svg                         # アプリアイコン
```

---

## 主要定数

| 定数 | 値 | 説明 |
|------|------|------|
| `AI_CHANNELS` | 16 | AI チャネル数 |
| `AO_CHANNELS` | 8 | AO チャネル数（GP8403） |
| `AI_START_REGISTER` | 0 | AI Input Register 開始アドレス（Normal） |
| `AI_FLOAT_START_REGISTER` | 5000 | AI Input Register 開始アドレス（Extended） |
| `MAX_POINTS_IN_MEMORY` | 256 | 通常時のチャート表示上限 |
| `MAX_POINTS_WHILE_SAVING` | 65536 | 保存中のチャート表示上限 |

---

## HX711 ケーブル接続指南

**注意**: ケーブルの色は一般的な慣例であり、実際の配線はロードセルや変位計のデータシートを必ず参照してください。メーカーによって色の割り当てが異なる場合があります。

| 色 | 機能（英） | 機能（日）| NDISコネクタ |
|----------------------|----------------|----------------------|--------------|
| Red / R / 紅 | Excitation+ / E+ | 入力 + / 電源 | A |
| Black / B / 黒 | Excitation− / E− | 入力 − / グランド | C |
| Green / G / 緑 | Signal+ / S+ | 出力 + / 正出力 | B |
| White / W / 白 | Signal− / S− | 出力 − / 負出力 | D |
| Yellow / Y / 黄 | Shield / SH | シールド / シールド | E |

**参考資料**: [昭和測器 — コネクタ種類と接続方法](https://www.showa-sokki.co.jp/technology/%E3%82%B3%E3%83%8D%E3%82%AF%E3%82%BF%E7%A8%AE%E9%A1%9E%E3%81%A8%E6%8E%A5%E7%B6%9A%E6%96%B9%E6%B3%95/)

---

## スクリューコネクタ配線（ADS1115 / GP8403）

基板上の 01×02 スクリューコネクタは、**シルク印刷に `G` と表示されているピンがグランド（GND）** です。
`A`や`D` はチャンネル番号で **16進数** で示されています（例: `10 -> A`, `15 -> F`）。  
ADS1115 側は 8〜15 のため、`8`〜`F` となります。

---

## ライセンス

MIT License

---

## 関連リンク

- **作者**: [Makoto KUNO](https://github.com/KikuchiMakoto)
- **リポジトリ**: https://github.com/KikuchiMakoto/modbus_simple_logger
- **デモ**: https://kikuchimakoto.github.io/modbus_simple_logger/
