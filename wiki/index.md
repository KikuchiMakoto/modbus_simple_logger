# Wiki Index — ModbusStrainCalibrator

`modbus-strain-calibrator` リポジトリのナレッジベース。LLM Wiki パターン（[`llm-wiki.md`](../llm-wiki.md)）に基づき、コードベースを体系的にまとめたもの。

## カタログ

### 設計 (Design)

| ページ | 概要 | 状態 |
|--------|------|------|
| [design-strain-calibrator.md](design-strain-calibrator.md) | 検定アプリ全体の設計書。UI・データモデル・ワークフロー・最小二乗・エクスポート | ✅ 確定 |

### コードベース (Codebase)

フォーク元 `ModbusSimpleLogger` の構造をまとめる。検定アプリでは多くの部分を簡略化 / 削除するため、**取捨選択の判断材料**として残す。

| ページ | 概要 | 状態 |
|--------|------|------|
| [architecture.md](architecture.md) | 全体構成・主要モジュール一覧・検定アプリでの変更方針 | ✅ 確定 |
| [modbus-client.md](modbus-client.md) | `webserialClient.ts` の中身・AsyncMutex・CRC16・Function Code | ✅ 確定 |
| [polling.md](polling.md) | ポーリングループ・状態管理・リトライ・Wake Lock | ✅ 確定 |
| [data-persistence.md](data-persistence.md) | IndexedDB・TSV ストリーミング・localStorage | ✅ 確定 |
| [calibration.md](calibration.md) | 最小二乗（`y = a0 + a1·x + a2·x²`） + 既存キャリブレーション | ✅ 確定 |
| [pwa-sw.md](pwa-sw.md) | PWA・Service Worker・COOP/COEP・プリキャッシュ | ✅ 確定 |
| [build.md](build.md) | Vite・Tailwind・Plotly 設定・pnpm 移行 | ✅ 確定 |
| [conventions.md](conventions.md) | 命名規則・エラーハンドリング・禁止事項 | ✅ 確定 |

### メタ (Meta)

| ページ | 概要 |
|--------|------|
| [log.md](log.md) | 活動ログ（ingest / 設計変更 / 実装 / lint） |

---

## 読む順序（初めて読む人へ）

1. **[architecture.md](architecture.md)** — fork 元の全体像
2. **[design-strain-calibrator.md](design-strain-calibrator.md)** — 検定アプリの設計書（メイン）
3. **[modbus-client.md](modbus-client.md)** — 通信層（流用前提）
4. **[calibration.md](calibration.md)** — 最小二乗の数式
5. **[build.md](build.md)** + **[conventions.md](conventions.md)** — 開発を始める前に
6. 必要に応じて [polling.md](polling.md) / [data-persistence.md](data-persistence.md) / [pwa-sw.md](pwa-sw.md) を参照

---

## 用語集

| 用語 | 意味 |
|------|------|
| **HX711** | 24bit ADC 搭載のひずみゲージアンプ IC。ロードセル直結用。 |
| **Modbus RTU** | シリアル通信上の Modbus プロトコル。CRC16 でフレーム検証。 |
| **Web Serial API** | Chromium 系ブラウザが提供する `navigator.serial` インタフェース。 |
| **raw** | ADC から出てくる整数値（int16 レンジ）。物理量変換前。 |
| **mV/V** | ひずみゲージの出力単位。励起電圧 1V あたりの出力 mV。 |
| **με** | マイクロストレイン。1×10⁻⁶ のひずみ。 |
| **1-port 検定** | 外部標準器で印加値を直接入力して検定する方式。 |
| **2-port 検定** | 参照センサーと対象センサーを同時測定して検定する方式。 |
| **最小二乗法** | `(x_i, y_i)` データから `y = f(x)` の係数を推定する標準的手法。 |
| **R²** | 決定係数。1.0 に近いほど回帰の当てはまりが良い。 |
| **RMSE** | 二乗平均平方根誤差。残差の標準偏差。 |
| **COOP/COEP** | Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy。SharedArrayBuffer に必要。 |
| **PWA** | Progressive Web App。Service Worker でオフライン対応。 |
| **Pyodide** | WebAssembly 上の Python 実装。本リポジトリでは**削除**。 |
| **ScriptRunner** | Pyodide による Python スクリプト実行機能。本リポジトリでは**削除**。 |
| **web-serial-polyfill** | WebSerial 非対応環境向けの WebUSB フォールバック。 |
| **scattergl** | Plotly.js の WebGL 散布図トレース。本リポジトリのチャートは全てこれ。 |
