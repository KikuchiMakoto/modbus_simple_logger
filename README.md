# ModbusStrainCalibrator

**ModbusStrainCalibrator** は、HX711 ひずみゲージセンサーの検定（キャリブレーション）に特化した Web アプリです。ブラウザ上で Modbus RTU デバイスと通信し、最小二乗法による回帰分析でセンサーの変換係数を求めます。

🔌 **デモ**: https://takker.github.io/modbus-strain-calibrator/

---

## 主な機能

| 機能 | 説明 |
|------|------|
| **1-port 検定** | 外部標準基準（分銅・ゲージブロック等）で印加値を直接入力 → 最小二乗 |
| **2-port 検定** | 校正済み参照センサーと検定対象を同時測定 → 参照換算値を正解値に |
| **回帰モデル** | 1次（y = ax + b）/ 2次（y = ax² + bx + c）を選択可能 |
| **自動安定判定** | 1次IIR LPF + 移動窓 range でセンサー安定を自動検出 |
| **リアルタイムチャート** | raw + filtered の time-series 表示（Plotly.js scattergl） |
| **回帰プロット** | 散布図 + 回帰線の自動更新・インタラクティブ操作 |
| **単位切替** | x 軸の表示単位を raw counts / mV/V / με から選択 |
| **エクスポート** | CSV（# コメントヘッダー付き）/ JSON ダウンロード |
| **PWA** | Service Worker によるオフライン対応。検定現場でも安心 |
| **ダークモード** | ライト/ダークテーマ切り替え |

---

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フレームワーク | React 19 + TypeScript 7 |
| ビルドツール | Vite 8 + pnpm |
| スタイリング | Tailwind CSS 4 |
| チャート | Plotly.js（`scattergl` のみのカスタムバンドル） |
| Modbus 通信 | Web Serial API + web-serial-polyfill |
| Lint / Format | Biome |
| テスト | Vitest |

---

## クイックスタート

### 必要条件

- [pnpm](https://pnpm.io/) がインストールされていること
- Chrome / Edge などの Chromium 系最新版ブラウザ（Web Serial API 対応）

### インストール

```bash
pnpm install
```

### 開発サーバー起動

```bash
pnpm dev
```

開発サーバーはデフォルトで `http://localhost:5173` で起動します。

### ビルド

```bash
pnpm build
```

ビルド成果物は `dist/` ディレクトリに出力されます。

### プレビュー

```bash
pnpm preview
```

`http://localhost:4173/modbus_strain_calibrator/` で確認できます。

### テスト

```bash
pnpm test         # Vitest 実行
pnpm test:cov     # カバレッジレポート
pnpm typecheck    # tsc --noEmit
pnpm lint         # Biome チェック
```

---

## ブラウザ要件

| API | 用途 | 備考 |
|-----|------|------|
| Web Serial API | Modbus RTU 通信 | Chrome 89+ / Edge 89+。非対応環境では `web-serial-polyfill` 経由で WebUSB |
| Service Worker | PWA・オフライン対応 | 全モダンブラウザ対応 |
| Wake Lock API | 画面スリープ抑止 | Chrome 84+ / Edge 84+。非対応時は無視 |

> **注意**: Safari / Firefox では Web Serial API が未対応のため動作しません。モバイルは Android + Chrome を推奨。

### Linux シリアルポート権限

```bash
sudo systemctl stop brltty-usb.service brltty.service serial-getty@ttyACM0.service serial-getty@ttyUSB0.service 2>/dev/null || true
sudo systemctl disable brltty-usb.service serial-getty@ttyACM0.service serial-getty@ttyUSB0.service 2>/dev/null || true
sudo usermod -aG dialout $USER
echo 'KERNEL=="ttyACM[0-9]*", GROUP="dialout", MODE="0660"
KERNEL=="ttyUSB[0-9]*", GROUP="dialout", MODE="0660"' | sudo tee /etc/udev/rules.d/99-usb-serial.rules >/dev/null
sudo udevadm control --reload-rules && sudo udevadm trigger
echo "完了。再ログインまたは newgrp dialout で権限を反映してください。"
```

---

## アーキテクチャ

```
src/
├── App.tsx                          # ルート: 接続・レイアウト・状態統合
├── main.tsx                         # エントリポイント + SW 登録 + ErrorBoundary
├── index.css                        # Tailwind CSS 4 + カスタムクラス
├── types.ts                         # 型定義
├── constants.ts                     # HX711_CHANNELS=8, AI_START_REGISTER=0, 等
├── modbus/
│   └── webserialClient.ts           # Web Serial トランスポート + Modbus RTU（fork元流用）
├── hooks/
│   ├── useTheme.ts                  # テーマ管理（localStorage 永続化、fork元流用）
│   ├── useCalibration.ts            # 検定点・回帰の状態管理 + 自動再計算
│   └── useHx711Live.ts              # ポーリング + 安定判定 + 履歴リングバッファ
├── components/
│   ├── AppHeader.tsx                # タイトル・接続ボタン・Menu
│   ├── ModeSelector.tsx             # 1-port / 2-port 切替
│   ├── ChannelSelector.tsx          # CH 00-07 ドロップダウン
│   ├── LiveChart.tsx                # raw + filtered time-series（Plotly）
│   ├── RegressionPlot.tsx           # 散布図 + 回帰線（Plotly）
│   ├── CalibrationWorkbench.tsx     # 右カラム: テーブル・Add/Export/Clear
│   ├── CalibrationRow.tsx           # 1行編集（x, y, delete）
│   ├── RegressionResultPanel.tsx    # 係数・R²・RMSE 表示
│   ├── ModbusConfigPanel.tsx        # シリアル設定（FloatingWindow, fork元流用）
│   └── FloatingWindow.tsx           # react-rnd ドラッグ可能窓（fork元流用）
└── utils/
    ├── regression.ts                # 最小二乗（線形・2次）+ R² + RMSE
    ├── settling.ts                  # 1次IIR LPF + 移動窓 range 安定判定
    ├── csvExport.ts                 # CSV ダウンロード
    ├── jsonExport.ts                # JSON ダウンロード
    ├── calibration.ts               # HX711 raw → mV/V 換算
    ├── cookies.ts                   # localStorage ラッパー
    └── crc16.ts                     # 純粋 CRC16 実装（fork元流用）
```

---

## 検定ワークフロー

### 1-port モード

1. HX711 デバイスを USB 接続し、Connect ボタンで接続
2. 既知の負荷を印加し、安定するまで待機（● Stable 表示）
3. Y 入力欄に印加値を入力し [+ Add Point]
4. 以降 2-3 を繰り返し（最低 2 点、推奨 5 点以上）
5. 自動で回帰計算・プロット更新
6. [CSV] または [JSON] でエクスポート

### 2-port モード

1. 参照センサー（校正済み）と検定対象を 2ch に接続
2. 2-port に切替、参照係数（a, b, c）を画面上部に入力
3. [+ Add Point] で両チャネルが安定した時点の値を同時記録
   - x = 検定対象の filtered raw
   - y = 参照センサーの換算物理量
4. 以下 1-port と同じ

---

## ライセンス

MIT License（フォーク元 [ModbusSimpleLogger](https://github.com/KikuchiMakoto/modbus_simple_logger) より継承）

---

## 関連リンク

- **リポジトリ**: https://github.com/takker/modbus-strain-calibrator
- **Wiki**: [wiki/index.md](wiki/index.md)
