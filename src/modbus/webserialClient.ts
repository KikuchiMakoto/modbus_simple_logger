/*
 * Web Serial API transport using modbus-serial helpers for CRC16.
 * Designed for CDC-ACM USB-Serial converters that work with OS drivers.
 */
import { crc16 } from '../utils/crc16';
import { SerialSettings } from '../types';
// Both timers below sit inside a transfer, holding the mutex: a throttled
// window timer would stretch a 10 ms inter-frame gap or a 1 s read deadline to
// a whole minute the moment the window stops being visible (see
// utils/backgroundTimer.ts).
import { clearBackgroundTimer, setBackgroundTimeout } from '../utils/backgroundTimer';

/**
 * Simple async mutex implementation for exclusive access control
 */
class AsyncMutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    // Wait until the mutex is released
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    if (this.waiters.length > 0) {
      const resolve = this.waiters.shift()!;
      resolve();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Result of one `reader.read()`, with rejections captured instead of thrown.
 *
 * A read that is abandoned because its deadline expired stays pending in
 * `pendingRead`; if it later rejects and nobody is awaiting it yet, a raw
 * promise would surface as an unhandled rejection. Capturing the error keeps
 * the parked promise inert until the next reader picks it up.
 */
type ReadOutcome =
  | { ok: true; result: ReadableStreamReadResult<Uint8Array> }
  | { ok: false; error: unknown };

/** Minimum spacing between automatic port-reopen attempts after a dead stream. */
const REOPEN_THROTTLE_MS = 2000;

export class WebSerialModbusClient {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  /**
   * The read() that is currently in flight, if any. Parked here (never
   * cancelled) so a transfer that gives up waiting does not destroy the
   * stream — see readChunk() for why cancelling is fatal on mobile.
   */
  private pendingRead: Promise<ReadOutcome> | null = null;
  /** True once a read reported `done` or threw: the stream can never recover. */
  private streamDead = false;
  private lastReopenAttemptAt = 0;
  private slaveId: number;
  private serialSettings: SerialSettings;
  private serialApi: Serial;
  private transferMutex = new AsyncMutex();
  private lastTransferTime = 0;
  private minMessageIntervalMs: number;
  private isExtendedPrecision = false;
  private readonly isUsingPolyfill: boolean;
  private readonly debugPrefix = '[WebSerialModbusClient]';
  private readonly verboseFrameLogging: boolean;
  private disconnecting = false;

  /**
   * @param slaveId - Modbus slave ID.
   * @param serialSettings - Serial communication settings.
   * @param serialApi - Web Serial API implementation (native or polyfill).
   * @param isExtendedPrecision - True when float32 extended precision mode is used.
   * @param verboseFrameLogging - True to include per-frame hex dumps in debug logs.
   */
  constructor(
    slaveId = 1,
    serialSettings: SerialSettings = {
      baudRate: 38400,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
    serialApi?: Serial,
    isExtendedPrecision = false,
    isUsingPolyfillOverride?: boolean,
    verboseFrameLogging = false,
  ) {
    this.slaveId = slaveId;
    this.serialSettings = serialSettings;
    this.serialApi = serialApi || navigator.serial;
    this.isExtendedPrecision = isExtendedPrecision;
    this.verboseFrameLogging = verboseFrameLogging;
    this.isUsingPolyfill =
      isUsingPolyfillOverride ??
      (typeof navigator === 'undefined' || !('serial' in navigator) || !('requestPort' in navigator.serial));
    this.minMessageIntervalMs = this.calculateMinInterval();
    console.info(
      `${this.debugPrefix} initialized`,
      {
        slaveId: this.slaveId,
        serialSettings: this.serialSettings,
        isExtendedPrecision: this.isExtendedPrecision,
        isUsingPolyfill: this.isUsingPolyfill,
        verboseFrameLogging: this.verboseFrameLogging,
        minMessageIntervalMs: this.minMessageIntervalMs,
      },
    );
  }

  /**
   * Convert byte array to space-separated lowercase hex string for debug logs.
   * @param bytes - Target byte array.
   * @returns Hex string like "01 03 00 00".
   */
  private toHexString(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
  }

  /**
   * Calculate minimum message interval based on Modbus RTU specification
   * and precision mode.
   *
   * Modbus RTU requires 3.5 character times of silent interval.
   * For stability, we use 5 character times.
   *
   * Normal mode: minimum 10ms after each message.
   * Extended mode: minimum 1ms after each message.
   *
   * @returns Minimum interval in milliseconds
   */
  private calculateMinInterval(): number {
    // Base interval depends on precision mode
    const baseIntervalMs = this.isExtendedPrecision ? 1 : 10;

    // Calculate 5 character times based on serial settings
    // 1 character = 1 start bit + data bits + parity bit (if any) + stop bits
    const bitsPerChar = 1 +
                        this.serialSettings.dataBits +
                        (this.serialSettings.parity !== 'none' ? 1 : 0) +
                        this.serialSettings.stopBits;

    // 5 characters worth of time in milliseconds
    const silentIntervalMs = (bitsPerChar * 5 * 1000) / this.serialSettings.baudRate;

    // Use the larger of the two
    return Math.max(baseIntervalMs, silentIntervalMs);
  }

  /**
   * Update precision mode and recalculate minimum interval
   */
  setPrecisionMode(isExtended: boolean): void {
    console.info(`${this.debugPrefix} setPrecisionMode`, {
      from: this.isExtendedPrecision,
      to: isExtended,
    });
    this.isExtendedPrecision = isExtended;
    this.minMessageIntervalMs = this.calculateMinInterval();
    console.info(`${this.debugPrefix} minMessageIntervalMs updated`, this.minMessageIntervalMs);
  }

  async connect(): Promise<boolean> {
    console.info(`${this.debugPrefix} connect() start`, {
      slaveId: this.slaveId,
      serialSettings: this.serialSettings,
      isExtendedPrecision: this.isExtendedPrecision,
    });
    if (!this.serialApi) {
      throw new Error('Web Serial API is not supported in this browser');
    }

    // Clean up existing connection if any
    if (this.port) {
      await this.disconnect();
    }

    // Request port from user
    this.port = await this.serialApi.requestPort();
    const portInfo = this.port.getInfo?.();
    const portInfoReason = portInfo === undefined ? 'no info from getInfo()' : undefined;
    console.info(`${this.debugPrefix} port selected`, {
      portInfo: portInfo ?? null,
      reason: portInfoReason,
    });

    // Open with serial settings
    console.info(`${this.debugPrefix} opening port`, this.serialSettings);
    await this.port.open({
      baudRate: this.serialSettings.baudRate,
      dataBits: this.serialSettings.dataBits,
      stopBits: this.serialSettings.stopBits,
      parity: this.serialSettings.parity,
    });
    console.info(`${this.debugPrefix} port opened`);

    // Get readable and writable streams
    if (!this.port.readable || !this.port.writable) {
      throw new Error('Port streams are not available');
    }

    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.pendingRead = null;
    this.streamDead = false;
    this.lastReopenAttemptAt = 0;
    console.info(`${this.debugPrefix} streams ready (reader/writer locked)`);

    return true;
  }

  async disconnect() {
    if (this.disconnecting) return;
    this.disconnecting = true;
    console.info(`${this.debugPrefix} disconnect() start`);

    if (this.reader) {
      console.info(`${this.debugPrefix} cancelling reader`);
      try { await this.reader.cancel(); } catch (err) { console.warn(`${this.debugPrefix} reader cancel failed`, err); }
      try { this.reader.releaseLock(); } catch (err) { console.warn(`${this.debugPrefix} reader releaseLock failed`, err); }
      this.reader = null;
    }

    if (this.writer) {
      console.info(`${this.debugPrefix} closing writer`);
      try { await this.writer.close(); } catch (err) { console.warn(`${this.debugPrefix} writer close failed`, err); }
      // close() finishes the stream but keeps the writer's lock; port.close()
      // throws on a still-locked writable, which would leave the USB device
      // claimed and make the next Connect fail.
      try { this.writer.releaseLock(); } catch (err) { console.warn(`${this.debugPrefix} writer releaseLock failed`, err); }
      this.writer = null;
    }

    if (this.port) {
      console.info(`${this.debugPrefix} closing port`);
      try { await this.port.close(); } catch (err) { console.warn(`${this.debugPrefix} port close failed`, err); }
      this.port = null;
    }

    this.pendingRead = null;
    this.streamDead = false;
    this.disconnecting = false;
    console.info(`${this.debugPrefix} disconnect() complete`);
  }

  getPort(): SerialPort | null {
    return this.port;
  }

  private ensureReady() {
    if (!this.port || !this.reader || !this.writer) {
      throw new Error('Device not connected');
    }
  }

  /**
   * Like ensureReady(), but first tries to rebuild the stream locks when the
   * port is still open and only its readable/writable side was lost (e.g. a
   * previous reopen attempt failed halfway). Without this, one failed reopen
   * would leave every later transfer failing at ensureReady() with no path
   * back — the device would stay silent until the user reconnects by hand.
   * Must be called while holding the transfer mutex.
   */
  private async ensureReadyOrRecover(): Promise<void> {
    if (this.port && !this.disconnecting && (!this.reader || !this.writer)) {
      const now = Date.now();
      if (now - this.lastReopenAttemptAt >= REOPEN_THROTTLE_MS) {
        this.lastReopenAttemptAt = now;
        console.warn(`${this.debugPrefix} streams missing; reopening port`);
        try {
          await this.reopenPort();
          console.info(`${this.debugPrefix} port reopened before transfer`);
        } catch (err) {
          console.error(`${this.debugPrefix} port reopen failed`, err);
        }
      }
    }
    this.ensureReady();
  }

  private buildFrame(functionCode: number, payload: number[]): Uint8Array {
    const frame = [this.slaveId, functionCode, ...payload];
    const crc = crc16(frame);
    frame.push(crc & 0xff, (crc >> 8) & 0xff);
    const rawFrame = new Uint8Array(frame);
    const logData: Record<string, unknown> = {
      functionCode,
      payload,
    };
    if (this.verboseFrameLogging) {
      logData.frameHex = this.toHexString(rawFrame);
    }
    console.debug(`${this.debugPrefix} buildFrame`, logData);
    return rawFrame;
  }

  /**
   * Read one chunk from the serial port, giving up after `timeoutMs`.
   *
   * The in-flight `read()` is parked in `this.pendingRead` and re-awaited by
   * the next caller instead of being cancelled. Cancelling is deliberately
   * avoided: it is unrecoverable behind the WebUSB polyfill used on mobile.
   * That polyfill's `UsbEndpointUnderlyingSource` has no `cancel` hook, so
   * `reader.cancel()` merely closes the ReadableStream while
   * `SerialPort.readable` keeps handing back that same closed stream — every
   * later `read()` then resolves `{ done: true }` forever, which stalls
   * polling at 0 Hz with the UI still showing a live connection. Parking the
   * read also keeps the bytes: they are handed to whoever reads next rather
   * than thrown away with the reader.
   *
   * @param timeoutMs - How long to wait for bytes before giving up.
   * @returns The chunk, or null when the deadline expired first.
   * @throws If the stream is closed or errored (marks the stream dead).
   */
  private async readChunk(timeoutMs: number): Promise<Uint8Array | null> {
    const reader = this.reader;
    if (!reader) {
      throw new Error('Device not connected');
    }
    if (!this.pendingRead) {
      this.pendingRead = reader.read().then(
        (result): ReadOutcome => ({ ok: true, result }),
        (error): ReadOutcome => ({ ok: false, error }),
      );
    }
    const pending = this.pendingRead;

    let timeoutId: number | undefined;
    const outcome = await Promise.race<ReadOutcome | null>([
      pending,
      new Promise<null>((resolve) => {
        timeoutId = setBackgroundTimeout(() => resolve(null), Math.max(0, timeoutMs));
      }),
    ]);
    if (timeoutId !== undefined) {
      clearBackgroundTimer(timeoutId);
    }

    // Deadline hit first: leave `pendingRead` in place so the bytes are not
    // lost and the reader stays usable.
    if (outcome === null) {
      return null;
    }

    this.pendingRead = null;
    if (!outcome.ok) {
      this.streamDead = true;
      throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
    }
    const { value, done } = outcome.result;
    if (done) {
      this.streamDead = true;
      throw new Error('Stream closed unexpectedly');
    }
    return value ?? new Uint8Array(0);
  }

  /**
   * Drain and discard stale bytes from the receive buffer.
   *
   * Runs after a failed transfer so a late response cannot be mistaken for
   * the answer to the next request. Uses a short read window to avoid
   * blocking regular polling, and never cancels the reader (see readChunk).
   *
   * @param maxFlushMs - Drain window; defaults to 80 ms on the WebUSB
   *   polyfill (slower turnaround) and 30 ms on native Web Serial.
   */
  private async flushReceiveBuffer(maxFlushMs?: number): Promise<void> {
    if (!this.reader || this.streamDead) {
      return;
    }
    const effectiveMaxFlushMs = maxFlushMs ?? (this.isUsingPolyfill ? 80 : 30);

    const start = Date.now();
    let discardedBytes = 0;

    while (true) {
      const remainingMs = effectiveMaxFlushMs - (Date.now() - start);
      if (remainingMs <= 0) break;

      let chunk: Uint8Array | null;
      try {
        chunk = await this.readChunk(remainingMs);
      } catch (readError) {
        // Stream is closed or errored; recoverAfterTransferError() reopens it.
        console.warn(`${this.debugPrefix} flushReceiveBuffer() read failed`, readError);
        break;
      }
      // No more stale bytes arrived within the window.
      if (chunk === null) break;

      discardedBytes += chunk.length;
    }

    if (discardedBytes > 0) {
      console.warn(`${this.debugPrefix} flushed stale RX bytes`, { discardedBytes });
    }
  }

  /**
   * Close and re-open the port, rebuilding both stream locks.
   *
   * The only way back from a dead ReadableStream: `SerialPort.readable` keeps
   * returning the closed stream until the port is re-opened (the WebUSB
   * polyfill rebuilds it in `close()`, native Web Serial in `open()`). No user
   * gesture is needed — the port permission is already granted.
   *
   * @throws If the port cannot be re-opened.
   */
  private async reopenPort(): Promise<void> {
    const port = this.port;
    if (!port) {
      throw new Error('Device not connected');
    }

    // Both streams must be unlocked before close(), or it throws.
    try { this.reader?.releaseLock(); } catch (err) { console.debug(`${this.debugPrefix} reopenPort() reader releaseLock failed`, err); }
    try { this.writer?.releaseLock(); } catch (err) { console.debug(`${this.debugPrefix} reopenPort() writer releaseLock failed`, err); }
    this.reader = null;
    this.writer = null;
    this.pendingRead = null;

    try { await port.close(); } catch (err) { console.warn(`${this.debugPrefix} reopenPort() close failed`, err); }
    await port.open({
      baudRate: this.serialSettings.baudRate,
      dataBits: this.serialSettings.dataBits,
      stopBits: this.serialSettings.stopBits,
      parity: this.serialSettings.parity,
    });
    if (!port.readable || !port.writable) {
      throw new Error('Port streams are not available after reopen');
    }

    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.streamDead = false;
    this.lastTransferTime = 0;
  }

  /**
   * Best-effort recovery run after every failed transfer.
   *
   * A live stream only needs its stale bytes drained. A dead one needs the
   * port re-opened, throttled to REOPEN_THROTTLE_MS so a permanently
   * unplugged device does not spin on reopen attempts every polling cycle.
   */
  private async recoverAfterTransferError(): Promise<void> {
    if (!this.streamDead) {
      try {
        await this.flushReceiveBuffer();
      } catch (flushErr) {
        console.warn(`${this.debugPrefix} flush after error failed`, flushErr);
      }
    }
    if (!this.streamDead) return;

    const now = Date.now();
    if (now - this.lastReopenAttemptAt < REOPEN_THROTTLE_MS) return;
    this.lastReopenAttemptAt = now;

    console.warn(`${this.debugPrefix} serial stream is dead; reopening port`);
    try {
      await this.reopenPort();
      console.info(`${this.debugPrefix} port reopened after dead stream`);
    } catch (reopenErr) {
      console.error(`${this.debugPrefix} port reopen failed`, reopenErr);
    }
  }

  private async transfer(frame: Uint8Array, expectedLength: number, timeout = 1000): Promise<DataView> {
    if (!this.port) {
      throw new Error('Device not connected');
    }
    console.debug(`${this.debugPrefix} transfer() queued`, {
      expectedLength,
      timeout,
      txLength: frame.length,
      ...(this.verboseFrameLogging ? { txHex: this.toHexString(frame) } : {}),
    });

    // Acquire mutex to ensure only one transfer at a time
    await this.transferMutex.acquire();
    console.debug(`${this.debugPrefix} transfer() mutex acquired`);

    const startTime = Date.now();
    try {
      // Inside the mutex so a recovering reopen cannot race a concurrent
      // transfer, and so the readiness check sees the rebuilt streams.
      await this.ensureReadyOrRecover();
      const writer = this.writer!;

      // Ensure minimum interval between messages (based on Modbus RTU spec and precision mode)
      const now = Date.now();
      const timeSinceLastTransfer = now - this.lastTransferTime;
      if (timeSinceLastTransfer < this.minMessageIntervalMs) {
        const waitTime = this.minMessageIntervalMs - timeSinceLastTransfer;
        console.debug(`${this.debugPrefix} transfer() waiting interval`, {
          waitTime,
          minMessageIntervalMs: this.minMessageIntervalMs,
        });
        await new Promise<void>(resolve => setBackgroundTimeout(resolve, waitTime));
      }

      // Write frame
      console.debug(`${this.debugPrefix} transfer() write start`);
      await writer.write(frame);
      console.debug(`${this.debugPrefix} transfer() write complete`);

      // Read response with timeout
      const buffer: number[] = [];

      while (buffer.length < expectedLength) {
        const remainingMs = timeout - (Date.now() - startTime);
        if (remainingMs <= 0) {
          throw new Error('Timeout waiting for response');
        }
        const chunk = await this.readChunk(remainingMs);
        if (chunk === null) {
          throw new Error('Timeout waiting for response');
        }

        for (let i = 0; i < chunk.length; i++) buffer.push(chunk[i]);
        if (this.verboseFrameLogging && chunk.length > 0) {
          console.debug(`${this.debugPrefix} transfer() read chunk`, {
            chunkLength: chunk.length,
            totalBuffered: buffer.length,
            chunkHex: this.toHexString(chunk),
          });
        }
      }

      // Convert to DataView
      const responseArray = new Uint8Array(buffer.slice(0, expectedLength));
      if (buffer.length > expectedLength) {
        console.warn(`${this.debugPrefix} transfer() excess bytes discarded`, {
          expected: expectedLength,
          received: buffer.length,
          excess: buffer.length - expectedLength,
        });
      }
      console.debug(`${this.debugPrefix} transfer() response assembled`, {
        responseLength: responseArray.length,
        ...(this.verboseFrameLogging ? { rxHex: this.toHexString(responseArray) } : {}),
      });

      // Validate CRC16 of received data
      if (responseArray.length < 3) {
        throw new Error('Response too short for CRC validation');
      }

      const dataWithoutCrc = responseArray.slice(0, -2);
      const receivedCrc = responseArray[responseArray.length - 2] | (responseArray[responseArray.length - 1] << 8);
      const calculatedCrc = crc16(dataWithoutCrc);

      if (receivedCrc !== calculatedCrc) {
        console.error(`${this.debugPrefix} transfer() CRC mismatch`, {
          expected: `0x${calculatedCrc.toString(16)}`,
          received: `0x${receivedCrc.toString(16)}`,
          rxHex: this.toHexString(responseArray),
        });
        throw new Error(`CRC mismatch: expected 0x${calculatedCrc.toString(16)}, got 0x${receivedCrc.toString(16)}`);
      }

      // Update last transfer time
      this.lastTransferTime = Date.now();
      console.debug(`${this.debugPrefix} transfer() success`, {
        elapsedMs: this.lastTransferTime - startTime,
      });

      return new DataView(responseArray.buffer);
    } catch (err) {
      console.error(`${this.debugPrefix} transfer() failed`, {
        expectedLength,
        timeout,
        txLength: frame.length,
        elapsedMs: Date.now() - startTime,
        error: err,
      });
      await this.recoverAfterTransferError();
      throw err;
    } finally {
      // Always release the mutex
      this.transferMutex.release();
      console.debug(`${this.debugPrefix} transfer() mutex released`);
    }
  }

  /**
   * Read Coils (Function Code 1)
   * @param start - Starting coil address
   * @param count - Number of coils to read (1-2000)
   * @returns Array of boolean values (true = ON, false = OFF)
   */
  async readCoils(start: number, count: number): Promise<boolean[]> {
    console.debug(`${this.debugPrefix} readCoils()`, { start, count });
    if (count < 1 || count > 2000) {
      throw new Error('Count must be between 1 and 2000');
    }
    const payload = [start >> 8, start & 0xff, count >> 8, count & 0xff];
    const frame = this.buildFrame(1, payload);
    const byteCount = Math.ceil(count / 8);
    const expected = 3 + byteCount + 2; // addr + fc + byteCount + data + crc
    const view = await this.transfer(frame, expected);

    const values: boolean[] = [];
    const responseByteCount = view.getUint8(2);

    for (let i = 0; i < count; i += 1) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = i % 8;
      const byte = view.getUint8(3 + byteIndex);
      values.push((byte & (1 << bitIndex)) !== 0);
    }

    console.debug(`${this.debugPrefix} readCoils() done`, { responseByteCount, valuesLength: values.length });
    return values;
  }

  /**
   * Read Holding Registers (Function Code 3)
   * @param start - Starting register address
   * @param count - Number of registers to read
   * @returns Array of signed 16-bit register values
   */
  async readHoldingRegisters(start: number, count: number): Promise<number[]> {
    console.debug(`${this.debugPrefix} readHoldingRegisters()`, { start, count });
    const payload = [start >> 8, start & 0xff, count >> 8, count & 0xff];
    const frame = this.buildFrame(3, payload);
    const expected = 5 + count * 2; // addr + fc + byteCount + data + crc
    const view = await this.transfer(frame, expected);
    const values: number[] = [];
    const byteCount = view.getUint8(2);
    for (let i = 0; i < byteCount / 2; i += 1) {
      values.push(view.getInt16(3 + i * 2, false));
    }
    console.debug(`${this.debugPrefix} readHoldingRegisters() done`, {
      byteCount,
      valuesLength: values.length,
      preview: values.slice(0, 10),
    });
    return values;
  }

  /**
   * Read Input Registers (Function Code 4)
   * @param start - Starting register address
   * @param count - Number of registers to read
   * @returns Array of signed 16-bit register values
   */
  async readInputRegisters(start: number, count: number, timeoutMs = 1000): Promise<number[]> {
    console.debug(`${this.debugPrefix} readInputRegisters()`, { start, count, timeoutMs });
    const payload = [start >> 8, start & 0xff, count >> 8, count & 0xff];
    const frame = this.buildFrame(4, payload);
    const expected = 5 + count * 2; // addr + fc + byteCount + data + crc
    const view = await this.transfer(frame, expected, timeoutMs);
    const values: number[] = [];
    const byteCount = view.getUint8(2);
    for (let i = 0; i < byteCount / 2; i += 1) {
      values.push(view.getInt16(3 + i * 2, false));
    }
    console.debug(`${this.debugPrefix} readInputRegisters() done`, {
      byteCount,
      valuesLength: values.length,
      preview: values.slice(0, 10),
    });
    return values;
  }

  /**
   * Read Input Registers as Float32 values with ABCD byte order
   * Each float32 value is stored in 2 consecutive registers (4 bytes)
   * ABCD byte order: [Register N: AB] [Register N+1: CD]
   * @param start - Starting register address (e.g., 5000)
   * @param count - Number of float32 values to read (will read count*2 registers)
   * @returns Array of float32 values
   */
  async readInputRegistersAsFloat32Abcd(start: number, count: number, timeoutMs = 1000): Promise<number[]> {
    console.debug(`${this.debugPrefix} readInputRegistersAsFloat32Abcd()`, { start, count, timeoutMs });
    // Read twice as many registers since each float32 needs 2 registers
    const registerCount = count * 2;
    const payload = [start >> 8, start & 0xff, registerCount >> 8, registerCount & 0xff];
    const frame = this.buildFrame(4, payload);
    const expected = 5 + registerCount * 2; // addr + fc + byteCount + data + crc
    const view = await this.transfer(frame, expected, timeoutMs);

    const values: number[] = [];
    const byteCount = view.getUint8(2);

    // Process pairs of registers as float32 (ABCD byte order = big-endian)
    for (let i = 0; i < byteCount; i += 4) {
      const float32Value = view.getFloat32(3 + i, false); // false = big-endian (ABCD)
      values.push(float32Value);
    }

    console.debug(`${this.debugPrefix} readInputRegistersAsFloat32Abcd() done`, {
      byteCount,
      valuesLength: values.length,
      preview: values.slice(0, 10),
    });
    return values;
  }

  /**
   * Write Single Coil (Function Code 5)
   * @param address - Coil address
   * @param value - Coil state (true = ON, false = OFF)
   */
  async writeSingleCoil(address: number, value: boolean): Promise<void> {
    console.debug(`${this.debugPrefix} writeSingleCoil()`, { address, value });
    const coilValue = value ? 0xff00 : 0x0000;
    const payload = [address >> 8, address & 0xff, coilValue >> 8, coilValue & 0xff];
    const frame = this.buildFrame(5, payload);
    await this.transfer(frame, 8); // addr + fc + address + value + crc
    console.debug(`${this.debugPrefix} writeSingleCoil() done`);
  }

  /**
   * Write Single Register (Function Code 6)
   * @param address - Register address
   * @param value - 16-bit value to write
   */
  async writeSingleRegister(address: number, value: number): Promise<void> {
    console.debug(`${this.debugPrefix} writeSingleRegister()`, { address, value });
    const payload = [address >> 8, address & 0xff, value >> 8, value & 0xff];
    const frame = this.buildFrame(6, payload);
    await this.transfer(frame, 8);
    console.debug(`${this.debugPrefix} writeSingleRegister() done`);
  }

  /**
   * Write Multiple Coils (Function Code 15)
   * @param start - Starting coil address
   * @param values - Array of boolean values to write (max 1968 coils per Modbus spec)
   */
  async writeMultipleCoils(start: number, values: boolean[]): Promise<void> {
    console.debug(`${this.debugPrefix} writeMultipleCoils()`, { start, valuesLength: values.length });
    if (values.length === 0) {
      throw new Error('No values provided to write');
    }
    if (values.length > 1968) {
      throw new Error('Cannot write more than 1968 coils in a single request');
    }

    const count = values.length;
    const byteCount = Math.ceil(count / 8);

    // Build payload: start address (2 bytes) + count (2 bytes) + byte count (1 byte) + data
    const payload: number[] = [
      start >> 8,
      start & 0xff,
      count >> 8,
      count & 0xff,
      byteCount,
    ];

    // Pack boolean values into bytes (LSB first)
    for (let i = 0; i < byteCount; i += 1) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const index = i * 8 + bit;
        if (index < values.length && values[index]) {
          byte |= 1 << bit;
        }
      }
      payload.push(byte);
    }

    const frame = this.buildFrame(15, payload);
    const expected = 8; // addr + fc + start address + count + crc
    await this.transfer(frame, expected);
    console.debug(`${this.debugPrefix} writeMultipleCoils() done`);
  }

  /**
   * Write Multiple Holding Registers (Function Code 16)
   * Writes an array of uint16 values to consecutive Holding Registers
   * @param start - Starting register address
   * @param values - Array of uint16 values to write (max 123 registers per Modbus spec)
   */
  async writeMultipleHoldingRegisters(start: number, values: number[]): Promise<void> {
    console.debug(`${this.debugPrefix} writeMultipleHoldingRegisters()`, {
      start,
      valuesLength: values.length,
      preview: values.slice(0, 10),
    });
    if (values.length === 0) {
      throw new Error('No values provided to write');
    }
    if (values.length > 123) {
      throw new Error('Cannot write more than 123 registers in a single request');
    }

    const count = values.length;
    const byteCount = count * 2;

    // Build payload: start address (2 bytes) + count (2 bytes) + byte count (1 byte) + data
    const payload: number[] = [
      start >> 8,
      start & 0xff,
      count >> 8,
      count & 0xff,
      byteCount,
    ];

    // Add register values (each as 2 bytes, big-endian)
    for (const value of values) {
      const unsigned = value & 0xffff; // Ensure uint16
      payload.push(unsigned >> 8, unsigned & 0xff);
    }

    const frame = this.buildFrame(16, payload);
    const expected = 8; // addr + fc + start address + count + crc
    await this.transfer(frame, expected);
    console.debug(`${this.debugPrefix} writeMultipleHoldingRegisters() done`);
  }
}
