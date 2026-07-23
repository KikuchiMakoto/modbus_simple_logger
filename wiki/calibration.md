# Calibration — 既存キャリブレーション機能

## 概要

`src/utils/calibration.ts` に集約された既存の `a·x² + b·x + c` キャリブレーション機能。検定アプリでは「検定点を手動で集めて係数を最小二乗で求める」ため、**既存実装を置き換える**。

## 型

```ts
type AiCalibration = { a: number; b: number; c: number };
```

- 16ch 分の配列で保持（`loadAiCalibration(AI_CHANNELS)`）。
- デフォルトは全 ch `{ a: 0, b: 1, c: 0 }`。

## 物理値変換

```ts
const aiToPhysical = (raw, cal) => cal.a * raw * raw + cal.b * raw + cal.c;
```

- 各 ch の `raw` を `a·raw² + b·raw + c` に変換して `physical` に格納。

## レベルメーター

```ts
const getAiStatus = (raw) => {
  const ratio = Math.abs(raw) / 32767;
  if (ratio >= 0.9) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'normal';
};
```

- |raw| / 32767 を比として、3 段階の色（normal / warning / danger）を返す。
- HX711 の A/D 変換が 24bit だが `int16` に丸めて格納される前提の閾値。
- 検定アプリでも **レベルメーターは表示**する（`getAiStatus` / `getLevelColor` を流用）。

## HX711 変換

```ts
const hx711RawToMvPerV = (raw) => raw / 32768.0 / 128.0 / 2 * 1e3;
const hx711RawToMicroStrain = (raw) => hx711RawToMvPerV(raw) * 2e3;
```

- 24bit ADC / ゲイン 128（CH0-CH7 のデフォルト）→ mV/V
- ひずみ 1 με = 0.5 mV/V (ゲージ率 2.0) → μɛ = mV/V × 2000
- 検定アプリは **mV/V を中間表示**として残す。μɛ 表示は任意。

## ADS1115 変換

```ts
const ads1115RawToVolt = (raw) => raw / 32768.0 * 6.144;
```

- ±6.144V レンジがデフォルト。検定アプリでは**削除**。

## VoltageMode

```ts
type VoltageMode = 'unknown' | 'hx711_mv_per_v' | 'hx711_micro_strain'
                 | 'ads1115_10v' | 'ads1115_6144mv' | 'ads1115_4096mv'
                 | 'ads1115_2048mv' | 'ads1115_1024mv' | 'ads1115_512mv' | 'ads1115_256mv';
```

- チャネルごとの表示モードを 16ch 配列で管理（`loadVoltageConfig()` / `saveVoltageConfig()`）
- 検定アプリでは **削除**（HX711 1〜2ch しか扱わないため、表示モード切替が不要）

## キャリブレーション UI

`src/components/CalibrationPanel.tsx` に以下の機能:
- ch ごとに a / b / c を 3 カラムで編集
- `CalibCell` で `onFocus` 中はローカル state、`onBlur` で `Number()` パース
- Save / Load (JSON) ボタン

JSON 形式:
```json
{
  "type": "Calibration",
  "00": { "a": 0.0, "b": 1.0, "c": 0.0 },
  "01": { "a": 0.0, "b": 1.0, "c": 0.0 },
  ...
}
```

- 検定アプリでは **JSON 形式を流用**してキャリブレーション結果のエクスポートに使う。

## 検定アプリで必要な機能（最小二乗）

### 1. 線形回帰（1次）: y = a0 + a1·x (a2=0)

```ts
// x: HX711 raw, y: 印加値 or 参照センサ値
// y = a0 + a1·x  (a2 = 0)
function fitLinear(points: { x: number; y: number }[]): { a0: number; a1: number; a2: 0; r2: number; rmse: number } {
  const n = points.length;
  if (n < 2) throw new Error('At least 2 points are required for linear regression');
  const mean = (k: 'x' | 'y') => points.reduce((s, p) => s + p[k], 0) / n;
  const mx = mean('x'), my = mean('y');
  let sxx = 0, sxy = 0;
  for (const p of points) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  const a1 = sxy / sxx;
  const a0 = my - a1 * mx;
  // R² と RMSE
  const ssRes = points.reduce((s, p) => s + (p.y - (a1 * p.x + a0)) ** 2, 0);
  const ssTot = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / n);
  return { a0, a1, a2: 0, r2, rmse };
}
```

### 2. 多項式回帰（2次）: y = a0 + a1·x + a2·x²

```ts
function fitQuadratic(points: { x: number; y: number }[]): { a0: number; a1: number; a2: number; r2: number; rmse: number } {
  const n = points.length;
  if (n < 3) throw new Error('At least 3 points are required for quadratic regression');
  // Normal equations: A^T A β = A^T y
  // A = [x_i², x_i, 1]
  let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (const p of points) {
    const x = p.x, x2 = x * x;
    s00 += x2 * x2; s01 += x2 * x;  s02 += x2;
    s11 += x * x;   s12 += x;        s22 += 1;
    t0 += x2 * p.y; t1 += x * p.y;  t2 += p.y;
  }
  // Solve via Cramer's rule for 3x3 (small & clear).
  const det = (m: number[][]) => /* ... */;
  const A = [[s00, s01, s02], [s01, s11, s12], [s02, s12, s22]];
  const bVec = [t0, t1, t2];
  const d = det(A);
  const a2 = det([[bVec[0], s01, s02], [bVec[1], s11, s12], [bVec[2], s12, s22]]) / d;
  const a1 = det([[s00, bVec[0], s02], [s01, bVec[1], s12], [s02, bVec[2], s22]]) / d;
  const a0 = det([[s00, s01, bVec[0]], [s01, s11, bVec[1]], [s02, s12, bVec[2]]]) / d;
  // R² / RMSE
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const ssRes = points.reduce((s, p) => s + (p.y - (a2 * p.x * p.x + a1 * p.x + a0)) ** 2, 0);
  const ssTot = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / n);
  return { a0, a1, a2, r2, rmse };
}
```

- **CLineReg** / **mathjs** 等の外部ライブラリは使わず、Cramer's rule で 3x3 を手計算。
- 数値安定性は実用的には十分（HX711 の生値は `int16` レンジで、データ点数 N は 100 以下を想定）。

## 検定アプリで保持すべき型

```ts
type CalibrationPoint = { x: number; y: number; timestamp: number };
type CalibrationDegree = 1 | 2;
type CalibrationResult = {
  ch: number;                       // HX711 ポート番号
  degree: CalibrationDegree;       // 1 or 2
  // y = a0 + a1·x + a2·x²
  // degree=1 では a2=0
  a0: number; a1: number; a2: number;
  r2: number;
  rmse: number;
  points: CalibrationPoint[];
  updatedAt: number;
};
```

## 関連ページ

- [data-persistence.md](data-persistence.md) — localStorage 保存
- [design-strain-calibrator.md](design-strain-calibrator.md) — 検定 UI での使い方
