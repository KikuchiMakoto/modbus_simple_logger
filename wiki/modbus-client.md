# Modbus Client — Web Serial API + Modbus RTU

## 概要

`src/modbus/webserialClient.ts` で定義される `WebSerialModbusClient` クラスが、Modbus RTU デバイスとの通信を全て担う。検定アプリでも**そのまま流用する**前提のレイヤで、検定アプリ固有の改修は基本的に行わない。

## 通信スタック

```
ブラウザ
├── navigator.serial (Chromium)
│   └── requestPort() → SerialPort
│       ├── open({ baudRate, dataBits, stopBits, parity })
│       ├── readable.getReader() / writable.getWriter()
│       └── addEventListener('disconnect', ...)
└── web-serial-polyfill (Android Chrome 等で WebSerial 非対応時)
    └── WebUSB 経由で同等 API を提供
```

- モバイル (`isMobileDevice()` で判定) または WebSerial 非対応環境では `web-serial-polyfill` にフォールバック。
- `src/App.tsx: shouldUsePolyfill` / `serial` の二変数で一括管理。

## クラス構成

```ts
class WebSerialModbusClient {
  private port: SerialPort | null;
  private reader / writer: Readable/WritableStreamDefaultReader<Uint8Array>;
  private transferMutex = new AsyncMutex();
  private lastTransferTime = 0;
  private minMessageIntervalMs: number;  // Modbus RTU のサイレント時間
  private isExtendedPrecision = false;
  // ...
}
```

### AsyncMutex（自前実装）

```ts
class AsyncMutex {
  private locked = false;
  private waiters: Array<() => void> = [];
  async acquire(): Promise<void> { /* waiters に積む or 即時取得 */ }
  release(): void { /* 先頭の waiter を起こす or locked=false */ }
}
```

- `transfer()` の入口で `acquire()`、出口（正常・例外どちらも）で `release()`。
- AO 書込みと AI 読取りが同時に走っても **Modbus RTU フレーム順序が直列化**される。
- さらに `minMessageIntervalMs` スリープで **USB Serial 変換 IC（CH340, FT232 等）の詰まりを防ぐ**（3.5 キャラクタ時間 ≒ 10ms @ 38400bps）。

### `transfer(frame, expectedLength, timeout=1000)`

1. ミューテックス取得
2. 前回転送から `minMessageIntervalMs` 経過していなければ `setTimeout` で待機
3. `writer.write(frame)` でフレーム送信
4. `expectedLength` バイト揃うまで `reader.read()` を回す（タイムアウト 1000ms）
5. 末尾 2 バイトを CRC16 として検証（[`utils/crc16.ts`](../src/utils/crc16.ts)）
6. 失敗時は `flushReceiveBuffer()` で受信バッファを掃除し、Reader を cancel → releaseLock → 再 getReader
7. ミューテックス解放

## サポート Function Code

| FC | 名称 | 用途 |
|----|------|------|
| 1 | Read Coils | デジタル入力読取り（**未使用**） |
| 3 | Read Holding Registers | AO Holding Register 同期 |
| 4 | Read Input Registers | AI 読取り（Normal 精度: i16） |
| 5 | Write Single Coil | 未使用 |
| 6 | Write Single Register | 未使用 |
| 15 | Write Multiple Coils | 未使用 |
| 16 | Write Multiple Holding Registers | AO 8ch 書込み |

精度モードが `'extended'` の場合、AI 読取りは `readInputRegistersAsFloat32Abcd()`（FC4, 2 register = float32, ABCD バイト順）に切り替わる。

## 重要な定数

| 定数 | 値 | 出典 |
|------|----|------|
| `minMessageIntervalMs` | 10ms (Normal) / 1ms (Extended) | `calculateMinInterval()` |
| キャラクタ時間 | `1 + dataBits + (parity?1:0) + stopBits` bits | 同上 |
| CRC16 多項式 | 0xA001（reflected） | `utils/crc16.ts` |
| 既定 SerialSettings | 38400bps / 8 / N / 1 | `App.tsx` |

## エラーハンドリング

- **CRC 検証失敗**: `Error('CRC mismatch: ...')` を投げ、`flushReceiveBuffer()` で次フレームに備える
- **タイムアウト**: `Error('Timeout waiting for response')`、Reader を入れ替えて復帰
- **Reader 復旧失敗**: `disconnect()` を呼んで安全側に倒し、UI に `Disconnected` 状態を表示
- **`disconnect` イベント**（USB 物理抜け）: `App.tsx` の `useEffect` で拾い、`handleDisconnect()` を実行

## 検定アプリでの扱い

- **完全流用**。`src/modbus/webserialClient.ts` と `src/utils/crc16.ts` はそのまま残す。
- `connect()` の引数 `slaveId` と `serialSettings` は Modbus Config パネルから渡す。
- HX711 1〜2ch しか読まないので、`readInputRegisters(start, 1or2, timeoutMs)` を毎ポーリングで呼ぶ。**1 フレームで済むため `minMessageIntervalMs` は問題にならない**。
- 検定時の応答待ち（ユーザーが「点追加」を押すまで数十秒〜数分）でも、定期ポーリングで生の HX711 値を流し続け、UI 側で「現在の値」を表示する。
- モバイル/WebUSB フォールバックの判定は `isMobileDevice()` をそのまま使う（`pnpm` 移行時にパッケージは追加）。

## 関連ページ

- [polling.md](polling.md) — `transfer()` を使った定期ポーリング
- [pwa-sw.md](pwa-sw.md) — COOP/COEP ヘッダの必要性
- [design-strain-calibrator.md](design-strain-calibrator.md) — 検定 UI での使い方
