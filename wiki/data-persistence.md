# Data Persistence — IndexedDB / TSV / Cookie

## 概要

`modbus-simple-logger` には3層のデータ永続化があるが、**検定アプリでは CSV + JSON + localStorage に集約**するため、ほとんどを削除する。本ページは参考のため残す。

## IndexedDB (`src/utils/dataStorage.ts`)

```ts
class DataStorage {
  async init(): Promise<void>;                              // 冪等
  async addDataPoint(point: StoredDataPoint): Promise<number>;
  async addDataPoints(points: StoredDataPoint[]): Promise<void>;  // バッチ
  async keepLatestPoints(maxPoints: number): Promise<number>;     // FIFO trim
  async clearAllData(): Promise<void>;
}
export const dataStorage = new DataStorage();
```

- DB: `ModbusLoggerDB` v1、ObjectStore: `dataPoints` (autoIncrement `id`)
- インデックス: `timestamp` (非一意)
- バッチ書込みで 1 トランザクションにまとめ、毎ポーリングの add を抑制
- **非保存時のみ** IndexedDB に書込み。保存中は TSV が本体で IndexedDB は空

### 検定アプリでの扱い

- **完全削除**。検定アプリではライブ表示用リングバッファ（最大 N 件）+ CSV エクスポートで十分。
- 削除対象: `src/utils/dataStorage.ts` 全体

## TSV ストリーミング (`src/utils/tsvExport.ts`)

File System Access API (`showSaveFilePicker`) で `FileSystemWritableFileStream` を取得し、ヘッダー + 1 行ずつ `write()`。

```
timestamp  ai_raw_00  ai_raw_01  ...  ai_phy_00  ...  ao_raw_00  ...  ai_vlt_00  ...  param_00  ...
2026/01/01 12:00:00.000  12345  ...  0.123  ...  5000  ...  1.234  ...  0.0  ...
```

- `Float32Array` / `number[]` の両方を受け付け
- `flushBuffer` を `setInterval(60_000)` で定期フラッシュ
- 60s 経過 or Stop Save で `close()`

### 検定アプリでの扱い

- **完全削除**し、軽量な **CSV ライター**に置換。
- 出力は検定点 (x, y)、係数 (a0, a1, a2, モデル次数, R², RMSE, 計測日時)
- File System Access API は使わず、Blob + `URL.createObjectURL` + `<a download>` で十分（モダンブラウザで動く）
- もしくは File System Access API を残して「続行」ボタン付きダイアログ対応も可（後述の設計ドキュメント参照）

## 設定永続化 (`src/utils/cookies.ts`)

```ts
readJsonStorage<T>(key): T | null
writeJsonStorage(key, value): void
removeJsonStorage(key): void
readJsonCookie<T>(key): T | null   // 後方互換: localStorage が空なら Cookie から読む
writeJsonCookie(key, value): void   // localStorage への書き込み（Cookie には書かない）
```

- キーには `modbus_logger_` プレフィックスを自動付与
- 永続化キー: `theme_preference_v1`, `ai_calibration_v1`, `voltage_config_v1`, `ai_free_labels_v1`, `ao_free_labels_v1`, `param_free_labels_v1`, `chart_axes_v1`, `scriptRunnerCode`

### 検定アプリでの扱い

- **残す**（ただし簡略化）。
- 永続化する値:
  - キャリブレーション結果（チャネルごと、`{degree, a0, a1, a2, r2, rmse, updatedAt, points}`）
  - 選択中のモード（1-port / 2-port）
  - 選択中の HX711 ポート番号
  - ダーク/ライトテーマ
- キーは `modbus_calibrator_` プレフィックスに統一（既存 fork とのデータ混在を避ける）
- `readJsonCookie` 経由で旧キーからのマイグレーションを任意実装（必須ではない）

## 関連ページ

- [polling.md](polling.md) — `pendingDataPoints` のフラッシュ元
- [calibration.md](calibration.md) — 既存キャリブレーション保存
- [design-strain-calibrator.md](design-strain-calibrator.md) — 検定アプリでの永続化設計
