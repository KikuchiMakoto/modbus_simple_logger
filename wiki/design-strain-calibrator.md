# Design — ModbusStrainCalibrator

## 0. 目的

`modbus-strain-calibrator` は **ModbusSimpleLogger** の fork として、**HX711 ひずみゲージセンサー専用の検定 Web アプリ** を提供する。

### ユースケース

#### (A) 1ポート検定（外部標準基準）

校正済みの基準器（ゲージブロック、校正済みロードセル、既知質量のおもり等）で**印加値を直接入力**する方式。
- 例: ロードセル校正装置にセンサーを設置し、「0 kg → 1 kg → 2 kg → ...」と負荷を加えていく
- 各負荷点で HX711 の生値（raw）を読み、(raw, applied) ペアを蓄積
- 最小二乗法で **raw → 物理量** の変換係数を求める
- 結果: `physical = a·raw² + b·raw + c`（または `a·raw + b`）

#### (B) 2ポート検定（参照センサー基準）

**校正済みセンサー**（参照）と**未校正センサー**（検定対象）を 2 つの HX711 ポートに同時接続する方式。
- 複数の負荷点で 2 つの HX711 生値を同時記録
- `(target_raw, ref_phy)` のペアを蓄積
- 参照センサーの係数は**ユーザーが別途入力**しておき、その換算値を「正解 y」とみなす
- 最小二乗法で **target_raw → ref_phy（= physical）** の変換係数を求める
- 結果: `physical = a·target_raw² + b·target_raw + c`（または `a·target_raw + b`）

### 非機能要件

- **オフライン動作**（検定現場はネットワークがないことが多い）
- **完全ローカル処理**（生値・係数・検定点が一切外部送信されない）
- **USB 切断の自動検知**（ケーブルが抜けても安全側に倒れる）
- **画面スリープ抑止**（長時間の検定で画面が消えるのを防ぐ）
- **CSV / JSON でのエクスポート**（Excel / R / Python で事後解析できる）

---

## 1. 技術スタック

| レイヤー | 技術 |
|----------|------|
| フレームワーク | React 19 + TypeScript 6 |
| ビルド | Vite 8 + pnpm |
| スタイリング | Tailwind CSS 4 |
| チャート | Plotly.js (`plotly.js/lib/core` + `scattergl`) |
| Modbus 通信 | Web Serial API + `web-serial-polyfill` |
| 永続化 | localStorage（設定・検定結果）+ CSV/JSON ダウンロード |
| PWA | Service Worker（COOP/COEP + 全アセットプリキャッシュ） |

### 削除する依存

- `pyodide` (ScriptRunner 廃止)
- `modbus-serial` / `buffer` (元々未使用、外部依存なし)

※ `react-rnd` は **維持**（FloatingWindow + ModbusConfigPanel は現状のまま流用）

---

## 2. UI 構造

```
┌─────────────────────────────────┬────────────────────────────────┐
│ Header                          │                                │
│ [ModbusStrainCalibrator]        │ [●Connected] [Menu]            │
├─────────────────────────────────┴────────────────────────────────┤
│ Mode: (●)1-port  ( )2-port    Target CH: [CH 00 ▼]              │
│ [2-port] Ref CH: [CH 00 ▼]  Ref Coeffs: a=[0.0001] b=[0.9876] c=[0.0] │
│ Settling: Tolerance [5 cnts]  Window [1.0 s]  Cutoff [1.0 Hz]   │
├─────────────────────────────────┬────────────────────────────────┤
│ ┌───── Live Chart ──────────┐  │ Calibration Workbench           │
│ │  raw + filtered overlay   │  │ [+ Add Point] [Export] [Clear] │
│ │  (legend: current values) │  │ x unit: [raw counts ▼]         │
│ │                           │  │ ──── x_filtered ────┬── y_in ─┐│
│ │  Raw:     12345 ● Stable  │  │       12345         │  0.000  ││
│ │  Filtered: 12347          │  │       23456         │  1.000  ││
│ │  mV/V:     0.123          │  │       ...           │  ...    ││
│ │  Phy:      1.234 kg       │  │ ────────────────────┴─────────┘│
│ └───────────────────────────┘  │ Degree: [1 (linear) ▼]         │
│ ┌─── Regression Plot ───────┐  │ Coefficients (x raw counts):   │
│ │ scatter + regression line │  │ a=0.0001234  R²=0.9998        │
│ │ (auto-update, interactive)│  │ b=0.9876     RMSE=0.0023      │
│ │ 残差プロット(任意トグル)  │  │ c=0                          │
│ └───────────────────────────┘  │                                │
├─────────────────────────────────┴────────────────────────────────┤
│ Modbus Config Panel (FloatingWindow, toggle from [Menu])         │
└──────────────────────────────────────────────────────────────────┘
```

- **2カラムレイアウト**: 左に live chart + regression plot、右に calibration workbench
- **live readings カードは廃止**: 現在値は live chart の legend 部に表示（Raw / Filtered / mV/V / Phy）
- **live chart**: raw（生）と filtered（LPF 後）の2系列を time-series overlay。凡例に最新値を表示
- **regression plot**: 点の追加/削除/編集ごとに**自動再計算**・再描画（Calculate ボタン不要）
- **[+ Add Point]**: `allStable` の間のみ有効。値が再変動したら即座に disabled に戻る
- **x の単位切替**: workbench の x 列表示と係数 a,b,c を、選択された単位（raw counts / mV/V / με）に換算表示

---

## 3. データモデル

### 検定点

```ts
type CalibrationPoint = {
  index: number;        // 1-based 連番（画面表示には使わない、内部管理用）
  x: number;            // HX711 filtered raw（LPF 適用後の値）
  y: number;            // applied (1-port) / ref_phy from ref coeffs (2-port)
  timestamp: number;    // Date.now()
};

- `x` は常に **filtered raw counts** で保存する（回帰計算は raw counts ベース）
- 画面表示時の単位切替（mV/V / με）は表示換算のみ。保存値は raw counts のまま
```

### 検定結果

```ts
type CalibrationDegree = 1 | 2;

type CalibrationResult = {
  ch: number;                       // 対象 HX711 ポート番号（0-7）
  mode: '1port' | '2port';
  degree: CalibrationDegree;       // 1 or 2
  a: number;
  b: number;
  c: number;                        // degree=2 のみ使用、degree=1 では 0
  r2: number;
  rmse: number;
  points: CalibrationPoint[];
  refCh?: number;                   // mode='2port' のとき参照 CH
  refCoeffs?: { degree: 1 | 2; a: number; b: number; c: number };  // 2-port で使用
  updatedAt: number;                // Date.now()
  label?: string;                   // 任意の名称（例: "Sensor-A 校正 2026-01-15"）
};
```

検定結果は localStorage に save/load せず、CSV/JSON エクスポートで保存する。

### 参照センサー係数（2-port 用）

2-port モードでは参照センサーの係数 (a, b, c) を画面上部のテキストボックスに直接入力する。
ダイアログや別画面は使わず、インラインの入力欄として常時表示する。
前回入力した値は localStorage（`modbus_calibrator_reference_sensors_v1`）に自動保存し、次回起動時に復元する。

```ts
type ReferenceSensorCoeffs = {
  degree: 1 | 2;
  a: number;
  b: number;
  c: number;
};
```

### 安定判定設定

```ts
type SettlingConfig = {
  tolerance: number;        // HX711 raw counts 単位の許容最大レンジ（LPF 後）, default: 5
  windowSeconds: number;    // 安定判定窓の長さ（秒）, default: 1.0
  cutoffFrequency: number;  // 1次IIR LPF のカットオフ周波数（Hz）, default: 1.0
};
```

### 設定

```ts
type AppSettings = {
  mode: '1port' | '2port';
  targetCh: number;                 // 0-7
  refCh: number;                    // 0-7 (2-port のみ)
  degree: 1 | 2;
  settling: SettlingConfig;
  serial: SerialSettings;
  slaveId: number;
  modbusPrecision: 'normal' | 'extended';
  theme: 'light' | 'dark';
};
```

---

## 4. コンポーネント構成

```
src/
├── App.tsx                            # ルート: 接続・モード管理・レイアウト
├── main.tsx                           # エントリ + SW 登録 + ErrorBoundary
├── index.css
├── types.ts                           # CalibrationPoint, CalibrationResult, ...
├── constants.ts                       # AI_CHANNELS=16, HX711_CHANNELS=8, ...
├── modbus/
│   └── webserialClient.ts             # 既存をそのまま流用
├── hooks/
│   ├── useTheme.ts                    # 既存を流用
│   ├── useCalibration.ts              # 検定点・degree・計算の状態管理
│   └── useHx711Live.ts                # 1〜2ch ポーリング + 生値保持
├── components/
│   ├── LiveChart.tsx                  # 左上: raw+filtered time-series + 凡例に現在値
│   ├── RegressionPlot.tsx             # 左下: 散布図 + 回帰線（auto-update, interactive）
│   ├── CalibrationWorkbench.tsx       # 右: 検定テーブル + Add/Export/Clear + Degree 選択 + 単位切替
│   ├── CalibrationRow.tsx             # 1行編集（x, y, time, delete）
│   ├── RegressionResultPanel.tsx      # 係数・R²・RMSE 表示（Workbench 下部）
│   ├── ModeSelector.tsx               # 1-port / 2-port 切替
│   ├── ChannelSelector.tsx            # HX711 ch 0-7 ドロップダウン
│   ├── ModbusConfigPanel.tsx          # 既存をそのまま流用（FloatingWindow）
│   └── AppHeader.tsx                  # タイトル・Connect・Menu ボタン
└── utils/
    ├── crc16.ts                       # 既存を流用
    ├── cookies.ts                     # 既存を流用（キー prefix 変更）
    ├── regression.ts                  # 最小二乗（線形・2次） + R² + RMSE
    ├── settling.ts                    # 1次IIR LPF + 移動窓 range 安定判定
    ├── csvExport.ts                   # CSV ダウンロード (Blob + a[download])
    ├── jsonExport.ts                  # JSON ダウンロード
    └── calibration.ts                 # hx711RawToMvPerV, レベルメーター色
```

### 削除するファイル

- `src/pyodideWorker.ts`
- `src/hooks/useScriptRunner.ts`
- `src/hooks/useChartAxes.ts`
- `src/components/ScriptRunnerPanel.tsx`
- `src/components/VoltageConfigPanel.tsx`
- `src/components/HamburgerMenu.tsx`
- `src/components/SlidePanel.tsx`
- `src/components/AppInfoPanel.tsx` (新 `AppHeader` に統合)
- `src/components/ChartPanel.tsx` (廃止: 新アプリには 1 つの散布図のみ)
- `src/components/ManualPanel.tsx` (取扱説明書、不要)
- `src/components/CalibrationPanel.tsx` (`CalibrationWorkbench` に置換)
- `src/utils/tsvExport.ts` (`csvExport.ts` / `jsonExport.ts` に置換)
- `src/utils/dataStorage.ts` (IndexedDB 廃止)

※ `FloatingWindow.tsx` は **維持**（ModbusConfigPanel のコンテナとして使用）

---

## 5. 安定判定

### 5.1 概要

ユーザーが負荷を加えた後、センサー値が安定するまで [+ Add Point] ボタンを disabled にするための自動安定判定機構。
判定アルゴリズムは **1次IIR LPF + 移動窓 range** の 2段構え。

```
raw ──→ 1st-order IIR LPF ──→ リングバッファ ──→ max-min ≦ tolerance ──→ stable flag
```

### 5.2 アルゴリズム

**1次IIR LPF**:
```
α = 1 - exp(-2π · cutoffFrequency · samplingInterval)
filtered[n] = α · raw[n] + (1 - α) · filtered[n-1]
```

- `samplingInterval = 0.2` (200ms)
- `cutoffFrequency = 1.0 Hz` (default) → `α ≈ 0.714`
- 実装: `utils/settling.ts` の `SettlingDetector` クラス

**移動窓 range 判定**:
- リングバッファに LPF 後の値 `windowSamples` 個を保持
- 窓内の max - min を計算
- `range <= tolerance` が `windowSamples` 回連続 → `stable = true`
- 1回でも超えたら即座に `stable = false`（リセット）

**windowSamples** はユーザーの `windowSeconds` から計算:
```
windowSamples = Math.ceil(windowSeconds / 0.2)
```
例: `windowSeconds = 1.0` → `windowSamples = 5`

### 5.3 パラメータ

| パラメータ | ユーザー指定 | デフォルト | 範囲 | 内部変換 |
|-----------|------------|-----------|------|---------|
| `tolerance` | HX711 raw counts | 5 | 1-50 | そのまま `max-min ≤ tolerance` |
| `windowSeconds` | 秒 | 1.0 | 0.2-4.0 | → `windowSamples` |
| `cutoffFrequency` | Hz | 1.0 | 0.1-5.0 | → IIR α |

### 5.4 状態管理との統合

- `useHx711Live` が内部でチャネルごとに `SettlingDetector` インスタンスを保持
- 200ms ポーリングループ内で `SettlingDetector.update(raw)` を呼ぶ
- 結果（`stable`, `filtered`, `range`）は `ChannelLiveState` として親コンポーネントに公開
- 全チャネルが `stable` になったとき `allStable = true`
- 負荷変更後はユーザーが明示的にリセットする必要はなく、自然に unstable になり stable に遷移する

### 5.5 mini-chart との連携

Live カード内の mini-chart には **raw 値（生）と filtered 値（LPF 後）** の 2 系列をオーバーレイ表示する。
両系列とも `useHx711Live` の `history`（Float32Array リングバッファ）から取得。

---

## 6. 状態管理

### `useHx711Live`

```ts
type ChannelLiveState = {
  raw: number;
  filtered: number;          // 1次IIR LPF 適用後
  voltage: number;           // mV/V
  physical: number;          // 物理量（換算後、2-port では参照係数使用）
  stable: boolean;           // 安定判定結果
  range: number;             // 現在の窓内 range
};

function useHx711Live(opts: {
  client: WebSerialModbusClient | null;
  channels: number[];          // 1個（1-port）または2個（2-port）
  pollingMs: number;           // 200ms 固定
  precision: 'normal' | 'extended';
  settling: SettlingConfig;
  refCoeffs?: ReferenceSensorCoeffs;  // 2-port のみ
}): {
  channels: Record<number, ChannelLiveState>;
  allStable: boolean;          // 全チャネルが安定
  timestamp: number;
  isPolling: boolean;
  history: Record<number, { raw: Float32Array; filtered: Float32Array }>;  // mini-chart 用
};
```

- 内部でチャネルごとに `SettlingDetector`（`utils/settling.ts`）を保持
- 200ms ポーリングごとに `SettlingDetector.update(raw)` → stable 判定を更新
- `history` は直近 N 秒分の raw/filtered 配列（mini-chart 描画用、リングバッファ）
- 2-port 時は `refCoeffs` を使って target ch の y 値を自動計算（`physical`）

### `useCalibration`

```ts
function useCalibration(): {
  result: CalibrationResult | null;
  points: CalibrationPoint[];
  degree: 1 | 2;
  validationError: string | null;
  setDegree: (d: 1 | 2) => void;
  addPoint: (x: number, y: number) => void;
  removePoint: (index: number) => void;
  clearPoints: () => void;
};
```

- **自動再計算**: points または degree が変更されるたびに、自動で回帰計算を実行し `result` を更新する
- **y は編集可能**: 既存のポイントの y も後から自由に書き換えられる（入力ミスの訂正用）。編集のたびに自動再計算
  - `fitRegression()` が `{ ok: false }` を返した場合 → `result` を `null` に、`validationError` にエラーメッセージをセット
  - ユーザーが [Calculate] を押す操作は**不要**
- points / degree の変更は自動で localStorage（`modbus_calibrator_workbench_v1`）に保存
- `validationError` は points と degree から常に導出（`points.length < degree + 1` ならエラーメッセージ）
- CSV/JSON エクスポートは util 関数
- **[Add Point] ボタンの disabled 制御**: 親コンポーネントで `useHx711Live.allStable` を参照

### 親コンポーネント

`App.tsx` で:
1. 接続状態（`connected`, `client`）
2. モード（`mode`）とモードに応じたチャネル・係数設定
3. 安定判定設定（`settling`）
4. live 生値・安定状態（`useHx711Live`）
5. 検定テーブル（`useCalibration`）
6. レイアウト

これらを縦並びで配置。Modal/Dialog は使用しない。ModbusConfigPanel のみ FloatingWindow（既存 react-rnd 流用）。

**[Add Point] は `allStable` が false の間 disabled**。ただしワークベンチ上の y 入力（1-port）は常時有効。

---

## 7. 検定ワークフロー詳細

### 7.1 1-port モード

```
1. ユーザーがデバイスに既知の負荷を印加（例: 0 kg）
2. Live Chart で raw + filtered の収束を確認
   → allStable になると [+ Add Point] が有効になる（凡例に ● Stable 表示）
3. 入力欄「y」に 0.000 を入力
4. [+ Add Point] クリック
   → { x: currentFilteredRaw, y: 0.000, timestamp: now } が追加される
   → 回帰が自動再計算され、Regression Plot が更新される
5. 負荷を変更 (例: 1 kg)
   → 値が変動し allStable = false → [+ Add Point] が disabled に
   → 再び allStable になるのを待って ↑ を繰り返す
6. 3点以上追加 → Regression Plot に回帰線が自動表示
7. [Export CSV / Export JSON] で外部に保存
```

### 7.2 2-port モード

```
1. 参照センサー（既校正）と検定対象センサーを 2 ch に接続
2. 2-port モードに切り替えると、ヘッダー直下に参照センサー係数入力欄（a, b, c）が表示
   → 前回の値があれば自動復元、なければ手入力
3. [+ Add Point] クリック時（両 ch が allStable になったときのみ有効）:
   - target CH の filtered raw → x
   - ref CH の filtered raw を ref 係数で物理値に換算 → y（自動計算）
4. 以下 1-port と同じ
```

### 7.3 リアルタイム可視化

- **Live Chart**（左上）: raw + filtered の time-series overlay。凡例に現在値（Raw, Filtered, mV/V, Phy）と安定状態を表示
- **Regression Plot**（左下）: 散布図 + 回帰線。点追加/削除ごとに自動再描画。インタラクティブ操作（拡大/縮小/ホバー）
- ダークモード対応（既存パレット）

### 7.4 x の単位切替

Calibration Workbench 内の `x unit` セレクトボックスで、x 列の表示単位を切り替えられる。

| 単位 | 換算 | 説明 |
|------|------|------|
| raw counts | `x_display = x` | デフォルト。filtered raw counts |
| mV/V | `x_display = hx711RawToMvPerV(x)` | センサー出力電圧比 |
| με | `x_display = hx711RawToMvPerV(x) * 2000` | マイクロストレイン（ゲージ率2.0仮定） |

**回帰計算は常に raw counts で行い**、表示だけを換算する。単位切替時には係数 a, b, c もそれに応じて換算表示する:

- raw → mV/V: `a' = a * factor`, `b' = b`, `c' = c / factor`（1次式の場合）
  - ただし `factor` は raw→mV/V の線形変換係数（`1 / 32768 / 128 * 2 * 1000`）
- 詳細な換算式は `utils/calibration.ts` の既存関数を流用

---

## 8. 最小二乗実装

`src/utils/regression.ts`:

```ts
export type RegressionInput = { x: number; y: number }[];
export type RegressionDegree = 1 | 2;
export type RegressionResult = {
  degree: RegressionDegree;
  // degree=1: y = a·x + b
  // degree=2: y = a·x² + b·x + c
  a: number;
  b: number;
  c: number;        // degree=1 では 0
  r2: number;
  rmse: number;
  n: number;
};

export function fitRegression(points: RegressionInput, degree: RegressionDegree): RegressionResult {
  if (degree === 1) return fitLinear(points);
  return fitQuadratic(points);
}

function fitLinear(points: RegressionInput): RegressionResult { /* 既存 wiki/calibration.md 参照 */ }
function fitQuadratic(points: RegressionInput): RegressionResult { /* 同 */ }
```

- 数値安定性: HX711 raw が `int16` レンジ (`-32768` 〜 `32767`)、データ点数 N ≲ 100。Cramer's rule で十分。
- 外部ライブラリ（mathjs / regression-js）は使用しない。
- 異常系は throw ではなく discriminated union（`{ ok: true; value } | { ok: false; error: string }`）で表現
  - `points.length < degree + 1` → `{ ok: false, error: 'At least N points are required' }`
  - 同次座標 `(x_i = constant)` → `{ ok: false, error: 'All x values are identical' }`
- 呼び出し側（useCalibration / CalibrationWorkbench）は戻り値の ok で分岐、try/catch 不要

---

## 9. 永続化

### localStorage キー

| キー | 型 | 備考 |
|------|-----|------|
| `modbus_calibrator_settings_v1` | `AppSettings` | UI 状態・接続設定・テーマ |
| `modbus_calibrator_workbench_v1` | `{ mode, points, degree }` | 作業中の検定（中断復元用）、変更のたびに自動保存 |
| `modbus_calibrator_reference_sensors_v1` | `{ a, b, c, degree }` | 2-port 参照センサー係数（直前の値のみ、次回起動時に復元） |

※ 検定結果（`CalibrationResult`）は localStorage に保存しない。CSV/JSON エクスポートのみ。

- キーのプレフィックスは既存 fork と区別するため **`modbus_calibrator_`** に統一。
- `utils/cookies.ts` の `readJsonStorage` / `writeJsonStorage` をそのまま使う。

### エクスポート

#### CSV

```csv
# ModbusStrainCalibrator vX.Y.Z
# ch=0
# mode=1port
# degree=1
# a=0.0001234
# b=0.9876
# c=0
# r2=0.9998
# rmse=0.0023
# updated_at=2026-01-15T12:34:56.789Z
timestamp_ms,x_filtered_raw,y_applied
1737015296789,12345,0.000
1737015301234,23456,1.000
...
```

- ヘッダー行は `#` でコメント化（pandas / R で `comment='#'` で読込可能）
- Excel 互換: `\t` 区切りではなく `,` 区切り

#### JSON

```json
{
  "app": "ModbusStrainCalibrator",
  "version": "X.Y.Z",
  "exportedAt": "2026-01-15T12:34:56.789Z",
  "ch": 0,
  "mode": "1port",
  "degree": 1,
  "coefficients": { "a": 0.0001234, "b": 0.9876, "c": 0 },
  "metrics": { "r2": 0.9998, "rmse": 0.0023 },
  "points": [
    { "timestamp": 1737015296789, "x": 12345, "y": 0.000 },
    { "timestamp": 1737015301234, "x": 23456, "y": 1.000 }
  ]
}
```

#### 実装

`src/utils/csvExport.ts` / `src/utils/jsonExport.ts`:

```ts
export function downloadCsv(filename: string, content: string): void;
export function downloadJson<T>(filename: string, data: T): void;
```

- `Blob` + `URL.createObjectURL` + `<a download>` パターン（既存 `downloadJson` を流用）
- File System Access API は**使わない**（オーバースペック）
- デフォルトファイル名: `calibration_ch0_1port_2026-01-15T12-34-56.csv`

---

## 10. PWA / Service Worker

既存 `public/sw.js` を維持。`BASE_PATH` を `/modbus_strain_calibrator/` に変更。

```js
const BASE_PATH = '/modbus_strain_calibrator/';
const CACHE_NAME = `modbus-calibrator-${CACHE_VERSION}`;
```

- プリキャッシュ対象から `pyodide/` 配下が消える（**約 14MB 削減**）
- COOP/COEP ヘッダは維持（将来 SharedArrayBuffer を使う拡張に備える）

---

## 11. ディレクトリ構造（最終形）

```
modbus-strain-calibrator/
├── package.json                  # pnpm, pyodide 削除（react-rnd は維持）
├── pnpm-lock.yaml                # コミットする
├── pnpm-workspace.yaml           # 任意（モノレポ化する場合）
├── tsconfig.json
├── vite.config.ts                # pyodideAssets 削除, base path 変更
├── tailwind.config.js
├── postcss.config.js
├── index.html                    # title 変更
├── public/
│   ├── sw.js                     # BASE_PATH 変更
│   ├── manifest.json             # name/description 変更
│   └── icon.svg
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── types.ts
│   ├── constants.ts              # HX711_CHANNELS=8, ...
│   ├── modbus/
│   │   └── webserialClient.ts    # 既存流用
│   ├── hooks/
│   │   ├── useTheme.ts           # 既存流用
│   │   ├── useHx711Live.ts       # 新規
│   │   └── useCalibration.ts     # 新規
│   ├── components/
│   │   ├── AppHeader.tsx         # 新規（タイトル・接続・設定ボタン）
│   │   ├── ModeSelector.tsx      # 新規
│   │   ├── ChannelSelector.tsx   # 新規
│   │   ├── LiveChart.tsx         # 新規: raw+filtered time-series + 凡例に現在値
│   │   ├── RegressionPlot.tsx    # 新規（Plotly scatter + 回帰線, auto-update）
│   │   ├── CalibrationWorkbench.tsx  # 新規（Degree 選択 + 単位切替 + Add/Export/Clear）
│   │   ├── CalibrationRow.tsx    # 新規（x 単位切替対応）
│   │   ├── RegressionResultPanel.tsx # 新規（係数・R²・RMSE 表示）
│   │   └── ModbusConfigPanel.tsx # 既存をそのまま流用（FloatingWindow）
│   └── utils/
│       ├── crc16.ts              # 既存流用
│       ├── cookies.ts            # 既存流用（プレフィックス変更）
│       ├── calibration.ts        # 既存（HX711部分）を流用、ADS1115 削除
│       ├── regression.ts         # 新規（最小二乗）
│       ├── settling.ts           # 新規（1次IIR + range 安定判定）
│       ├── csvExport.ts          # 新規
│       └── jsonExport.ts         # 新規
└── wiki/                         # 設計ドキュメント
    ├── index.md
    ├── log.md
    ├── architecture.md
    ├── modbus-client.md
    ├── polling.md
    ├── data-persistence.md
    ├── calibration.md
    ├── pwa-sw.md
    ├── build.md
    ├── conventions.md
    └── design-strain-calibrator.md  # このファイル
```

---

## 12. 開発フロー

```bash
# 初回
pnpm install

# 開発
pnpm dev
# → http://localhost:5173/

# 型チェック
pnpm typecheck

# ビルド
pnpm build
# → dist/

# プレビュー（GitHub Pages の subdir 確認用）
pnpm preview
# → http://localhost:4173/modbus_strain_calibrator/

# デプロイ: GitHub Pages へ push で自動デプロイ (.github/workflows/deploy.yml)
```

`deploy.yml` は `pnpm` アクションに置換:

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 9
- name: Setup Node
  uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: pnpm
- name: Install
  run: pnpm install --frozen-lockfile
- name: Build
  run: pnpm build
```

---

## 13. マイグレーション手順

1. `package.json` を pnpm 用に書換、削除する依存を抜く
2. `src/pyodideWorker.ts`, `src/hooks/useScriptRunner.ts`, 関連コンポーネントを削除
3. `vite.config.ts` から `pyodideAssets` プラグイン削除、base path 変更
4. `public/sw.js` の `BASE_PATH` 変更
5. `public/manifest.json` の name/description 変更
6. `index.html` の title 変更
7. `src/utils/regression.ts` 新規
8. `src/utils/settling.ts` 新規
9. `src/utils/csvExport.ts` / `jsonExport.ts` 新規
10. `src/hooks/useHx711Live.ts` / `useCalibration.ts` 新規
11. 各種コンポーネントを新規実装
12. `src/App.tsx` を新レイアウトに置換

---

## 14. テスト方針

- **ユニットテスト**（Vitest）:
  - `regression.ts`: 線形/2次フィットに対して既知データで検証
    - 傾き 2.0, 切片 1.0 の完全直線データ → `{ ok: true, value.r2 = 1.0 }`
    - ノイズを含むデータ → R² が想定範囲内
    - 同次 x データ → `{ ok: false, error: 'All x values are identical' }`
    - データ点数不足 → `{ ok: false, error: 'At least N points are required' }`
  - `settling.ts`: `SettlingDetector` の安定判定ロジック
    - 一定値入力 → 即座に stable
    - 変動入力 → stable にならない
    - 変動後一定入力 → windowSamples 後に stable
- **手動 E2E**: 実機 HX711 + 既知負荷で 1-port / 2-port 両モード
- **モダンブラウザ互換**: Chrome / Edge 最新版で動作確認

`pnpm add -D vitest` で導入、`pnpm test` で実行。

---

## 15. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| 最小二乗の数値不安定性 | 係数が発散 | データ点数 N 制限、特異点（x_i すべて同じ）は discriminated union でエラー通知 |
| HX711 raw のドリフト | 検定中の生値ずれ | 自動安定判定により安定検出後のみ Add Point 可能 |
| 安定判定が敏感すぎ/鈍感すぎ | ユーザーを待たせる or 不安定な状態で記録 | tolerance / windowSeconds / cutoffFrequency をユーザー設定可能に |
| 2-port で参照係数の入力ミス | 検定対象係数全体が狂う | 参照係数入力時にライブ値 + 換算値プレビュー |
| USB 切断で検定中断 | 作業中の points 消失 | localStorage に作業中データを毎変更で保存 |
| ブラウザ非対応 (Safari / Firefox) | Web Serial 不可 | README で Chrome/Edge のみサポートと明記 |
| localStorage クォータ超過 | 検定結果保存失敗 | JSON サイズ警告 (5MB 超で警告) |
| COOP/COEP 設定ミス | SharedArrayBuffer 使えなくなる | vite.config.ts と sw.js の両方で設定、pre-commit チェック |

---

## 16. ロードマップ（将来）

1. **v1.0**: 1-port / 2-port 検定、線形/2次回帰、CSV/JSON エクスポート
2. **v1.1**: 多項式回帰 (3次・4次)、残差プロット、Bland-Altman
3. **v1.2**: 不確かさ評価（タイプA・B）、検定レポート PDF 出力
4. **v2.0**: 複数センサー同時検定（最大 8 ポート）、検定履歴のタイムライン表示

---

## 付録 A: HX711 仕様整理

- ADC: 24bit シグマデルタ
- ゲイン: 128 (デフォルト CH A) / 64 (CH B)
- データレート: 10 Hz / 80 Hz
- 出力: int16 レンジ（Modbus レジスタ 0〜15 が AI 16ch）
- mV/V 換算: `raw / 32768 / 128 / 2 * 1000` (mV/V)
- μɛ 換算: `mV/V * 2000` (ゲージ率 2.0 仮定)
- 推奨励起: 5V (負荷セルの定格に合わせる)
- ひずみ限界: ±3000 με 程度（ゲージ率 2.0 なら）

## 付録 B: ロードセル検定の教科書的手順（参考）

1. **零点調整**: 無負荷で raw を記録 → オフセット c の確認
2. **スパン校正**: 定格容量の 0% → 25% → 50% → 75% → 100% → 0% と往復
3. **ヒステリシス**: 上昇列と下降列の差を確認
4. **繰返し性**: 同じ負荷で 3回以上測定
5. **非直線性**: ベストフィット直線からの偏差

検定アプリでは (1)(2)(3) をサポート。(4)(5) は CSV エクスポート後に外部ツールで実施。

---

## 関連ページ

- [architecture.md](architecture.md) — fork 元の全体構成
- [modbus-client.md](modbus-client.md) — 通信層（流用）
- [polling.md](polling.md) — ポーリング簡略化方針
- [data-persistence.md](data-persistence.md) — 永続化方針
- [calibration.md](calibration.md) — 最小二乗の数式
- [pwa-sw.md](pwa-sw.md) — Service Worker 設定
- [build.md](build.md) — Vite + pnpm 設定
- [conventions.md](conventions.md) — 命名規則
