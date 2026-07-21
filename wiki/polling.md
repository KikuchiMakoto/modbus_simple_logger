# Polling — 計測ループと状態管理

## 概要

`src/App.tsx` の `runPollingLoop` / `pollOnce` が計測の中核。100ms 〜 5分の再帰 `setTimeout` で HX711 等の Input Register を読み、画面更新・IndexedDB 書込み・TSV 書込み・AO 書込みを駆動する。**検定アプリでは HX711 1〜2ch のみに簡略化する**。

## ポーリングループ

```ts
// src/App.tsx
const runPollingLoop = useCallback(async () => {
  if (pollTimer.current === undefined || pollingInProgressRef.current) return;
  pollingInProgressRef.current = true;
  const loopStart = Date.now();
  if (idealScheduleRef.current === 0) idealScheduleRef.current = loopStart;
  try {
    await pollOnce();
  } finally {
    pollingInProgressRef.current = false;
    if (pollTimer.current === undefined) return;
    idealScheduleRef.current += pollingRate.valueMs;
    const now = Date.now();
    if (idealScheduleRef.current < now - pollingRate.valueMs) idealScheduleRef.current = now;
    const delay = Math.max(0, idealScheduleRef.current - now);
    pollTimer.current = window.setTimeout(() => void runPollingLoop(), delay);
  }
}, [pollOnce, pollingRate.valueMs]);
```

- **`idealScheduleRef`** で「理想スケジュール時刻」を管理し、誤差が累積しないよう毎回 `now - pollingRate` を超えたらリセット。
- `pollingInProgressRef` で多重起動を防ぐ（`runPollingLoop` の再帰的呼び出しも直列化される）。
- 接続時に `acquiring` 状態を `useEffect` で監視 → `startPolling()` / `stopPolling()` を切替。

## pollOnce の責務

1. **AI 読取り**（ブロッキング）: `readInputRegisters(AI_START_REGISTER, AI_CHANNELS, readTimeoutMs)` または Extended 時は `readInputRegistersAsFloat32Abcd(...)`
2. **キャリブレーション適用**: `aiCalibrationRef.current[idx]` で `a·raw² + b·raw + c`
3. **ステータス DOM 更新**: React state は使わず ref 経由で直接書込み（不要な再レンダリング抑制）
4. **`pendingDataPoints` への push**: バッファへ Float32Array で積む
5. **AO 書込み**（ノンブロッキング）: `doAoWriteAsync()` を `void` で fire
6. **バッチフラッシュ**（5件 or 100ms ごとに `flushPendingDataPoints()` を呼ぶ）
7. **エラー処理**: 60s ウィンドウで 10回失敗したら「retry rate exceeded」状態にする

## 復帰時即時ポーリング

```ts
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    if (!acquiringRef.current) return;
    if (pollTimer.current === undefined || pollingInProgressRef.current) return;
    scheduleImmediatePoll();
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pageshow', handleVisibilityChange);
  return () => { /* cleanup */ };
}, [scheduleImmediatePoll]);
```

- スリープ復帰 / タブ切替で「次ポーリング予定」を待たずに即時 1 周。

## リトライレート制限

| 対象 | ウィンドウ | 上限 |
|------|----------|------|
| AI 読取り | `INPUT_READ_RETRY_WINDOW_MS = 60_000`ms | `INPUT_READ_MAX_FAILURES_PER_WINDOW = 10` |
| AO 書込み | `OUTPUT_HOLDING_RETRY_WINDOW_MS = 60_000`ms | `OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW = 10` |

- 60 秒スライディングウィンドウで失敗タイムスタンプを保持、超過時はそのサイクルをスキップ。
- **再試行は 1 回まで**（`RETRY_DELAY_MS = 10` 待機後）。

## Wake Lock

- 計測中（`acquiring === true`）に `navigator.wakeLock.request('screen')` で画面スリープを抑止。
- 切断時 / アンマウント時に `release()`。
- **検定アプリでも維持する**（長時間の検定で画面が消えるのを防ぐ）。

## 検定アプリでの簡略化

- AI 16ch → **HX711 1〜2ch のみ**。`readInputRegisters(0, 1or2, ...)` を毎ポーリングで呼ぶ。
- AO 8ch 書込み → **完全削除**。`doAoWriteAsync` / `setAo` 等のロジック削除。
- Parameter 8ch → **削除**（ScriptRunner と一緒に削除）。
- IndexedDB / TSV は使わない → `pendingDataPoints` 周りの `flushPendingDataPoints` 関数を**ライブ表示用のリングバッファ**に簡略化。
- ポーリング間隔は **fork 元と同じ選択肢（50ms〜5min）からユーザー選択可能**。デフォルトは 200ms。
- `idealScheduleRef` ベースの精密スケジューリングは **過剰**なので、`setInterval` で十分。
- Wake Lock は残す。
- visibilitychange / pageshow 復帰処理は残す（ユーザーが別タブで資料を見ながら戻るシーンを想定）。
- USB 切断イベント処理は残す。

## 削除するもの（リファクタ後）

- `doAoWriteAsync` 関連
- `applyAoRawValues` / `setAo` / `clampAoVoltageToMilliVolt` / `syncAoChannels`
- `useScriptRunner`
- `paramValues` / `paramShare` ミラー
- 4枚の `ChartPanel` を 1〜2 枚に削減
- AO セクション / Parameter セクション / Calibration パネル（独自 UI に置換）

## 関連ページ

- [modbus-client.md](modbus-client.md) — `transfer()` の中身
- [data-persistence.md](data-persistence.md) — IndexedDB / TSV（削除予定）
- [calibration.md](calibration.md) — 既存キャリブレーション
- [design-strain-calibrator.md](design-strain-calibrator.md) — 検定アプリ設計
