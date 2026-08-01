/*
 * Web Serial API transport using modbus-serial helpers for CRC16.
 * Designed for CDC-ACM USB-Serial converters that work with OS drivers.
 */
import { crc16 } from '../utils/crc16';
import { ModbusExceptionError, scanModbusFrame } from './frameScan';
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

/**
 * Cap on each individual teardown step in disconnect().
 *
 * A device that was physically unplugged may never settle reader.cancel(),
 * writer.close() or port.close(): behind the WebUSB polyfill the endpoint
 * source has no cancel hook (see readChunk()), and the underlying transfers
 * belong to a device that is simply gone. Awaiting those unbounded strands the
 * whole app — the caller's disconnect handler never reaches its cleanup, so the
 * UI stays "connected", saving never stops, and Connect cannot be used again.
 *
 * Short, because by the time this runs the port is already being abandoned;
 * every step here is best-effort tidying, not something whose result is used.
 */
const TEARDOWN_STEP_TIMEOUT_MS = 1500;

// Drain windows for the pre-write stale-RX fence. Much shorter than the
// post-failure flush (30/80 ms): this one runs on the critical path of a poll,
// and it only has to sweep up bytes that are already sitting there — the
// polyfill gets more because its reads resolve in coarser batches.
// How long a device may take to assemble a response before its first byte
// appears, independent of baud rate. Measured, not guessed: a 16-channel
// float32 read on the reference hardware takes ~90-100 ms of device time.
const DEVICE_RESPONSE_ALLOWANCE_MS = 200;

const STALE_PREWRITE_FLUSH_MS_NATIVE = 5;
const STALE_PREWRITE_FLUSH_MS_POLYFILL = 15;

// Main-thread stall compensation for the read deadline.
//
// The deadline is wall-clock, but the wire is not. A long task on the main
// thread — a chart redraw, a React commit, a GC pause — burns the budget while
// the bytes are already sitting in the OS buffer, delivered on time. When the
// thread frees up, the expired timer and the settled read() are both queued and
// the timer usually wins the race in readChunk(), so a device that answered
// correctly is reported as `Timeout waiting for response (0/2 bytes)` and its
// response is then thrown away by the stale-RX flush.
//
// The tell is how late the deadline itself fired: setBackgroundTimeout() cannot
// fire early, so an overshoot beyond scheduling noise means the thread was
// blocked, not that the device was silent. That time is credited back to the
// budget instead of being charged to the device.
//
// Deliberately not a bigger DEVICE_RESPONSE_ALLOWANCE_MS: raising the flat
// deadline slows down every genuine failure too. This only spends time when
// there is evidence the clock, not the link, is at fault.

/** Deadline overshoot beyond this is a blocked main thread, not timer jitter. */
const TIMER_STALL_THRESHOLD_MS = 25;

/**
 * Extra window granted alongside the credited stall time, so an already-settled
 * read() can actually be picked up rather than racing the next deadline.
 */
const STALL_GRACE_MS = 30;

/**
 * Cap on stall credits per transfer. Bounded so a genuinely dead device still
 * fails within roughly twice the deadline instead of stretching the poll loop.
 */
const MAX_STALL_CREDITS_PER_TRANSFER = 2;

/**
 * Wait for `promise` to settle, or give up after `ms`.
 *
 * Both handlers are attached immediately, so a promise abandoned by the timeout
 * that rejects later is still considered handled and never surfaces as an
 * unhandled rejection.
 *
 * On the background timer like the rest of this file: teardown is not only
 * something a user clicks. The port's `disconnect` event fires when the cable is
 * pulled, which can happen with the window minimised, and on a window timer each
 * of these steps would stretch from 1.5 s to the throttled minute.
 */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setBackgroundTimeout(() => resolve(true), ms);
    const settled = () => {
      clearBackgroundTimer(timer);
      resolve(false);
    };
    promise.then(settled, settled);
  });
}

/**
 * Check the byte-count field of an FC3/FC4 response against what we asked for.
 *
 * Trust the request, not the reply. The decode loops used to run to
 * `byteCount / 2`, so a device answering a 16-register read with a 37-byte,
 * CRC-valid frame that nevertheless reported byteCount 34 yielded 17 values —
 * which made assertLength('AI raw', 17, 16) in tsvWriterWorker.ts throw on
 * *every* row, so saving silently stopped producing rows while the run still
 * looked healthy. In the float32 path an over-reported count instead read past
 * the DataView and surfaced as an unrecognisable RangeError.
 *
 * Throwing rather than clamping is deliberate: it turns a silent wrong-length
 * decode into one visible error per poll, which the status bar now shows.
 */
function assertRegisterByteCount(byteCount: number, registerCount: number): void {
  const expected = registerCount * 2;
  if (byteCount !== expected) {
    throw new Error(`Register byte count mismatch: expected ${expected}, got ${byteCount}`);
  }
}

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
  /**
   * How late the last read deadline fired, in ms past the requested delay.
   * Non-zero only when readChunk() gave up, and read by transfer() to tell a
   * blocked main thread from a silent device — see TIMER_STALL_THRESHOLD_MS.
   */
  private lastReadOvershootMs = 0;
  /** True once a read reported `done` or threw: that ReadableStream is finished. */
  private streamDead = false;
  /** True once a write rejected: the sink errored its WritableStream. */
  private writerDead = false;
  /**
   * The streams `reader` and `writer` hold their locks on.
   *
   * Kept so recovery can tell a *replacement* stream from the dead one it is
   * already holding — see reacquireStreams(). Nulled together with the handle
   * they belong to, so a half-finished reopen leaves no stale reference behind.
   */
  private readableStream: ReadableStream<Uint8Array> | null = null;
  private writableStream: WritableStream<Uint8Array> | null = null;
  /**
   * Bytes read since the last recovery, logged when the next one runs.
   *
   * Diagnostic only, and specifically for the Android/WebUSB failure this
   * recovery path exists for: `transferIn` there dies after a fixed *volume* of
   * received data, not after a fixed time, which is only visible if the volume
   * is counted. A field report that says "~16 KB again" identifies it in one
   * line; wall-clock timestamps alone do not, because the period changes with
   * the response size (44 s of 37-byte int16 reads, 24 s of 69-byte float32
   * ones — the same 16 KB).
   */
  private rxBytesSinceRecovery = 0;
  /**
   * True when the last transfer ended without consuming a whole frame, so the
   * device may still owe a response. Armed in transfer()'s catch and spent by
   * the stale-RX flush before the next write.
   */
  private rxSuspect = false;
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
  /** The teardown in progress, so re-entrant callers await it instead of racing it. */
  private disconnectPromise: Promise<void> | null = null;

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

    // 5 characters worth of time in milliseconds
    const silentIntervalMs = (this.bitsPerChar() * 5 * 1000) / this.serialSettings.baudRate;

    // Use the larger of the two
    return Math.max(baseIntervalMs, silentIntervalMs);
  }

  /** 1 start bit + data bits + parity bit (if any) + stop bits. */
  private bitsPerChar(): number {
    return 1 +
           this.serialSettings.dataBits +
           (this.serialSettings.parity !== 'none' ? 1 : 0) +
           this.serialSettings.stopBits;
  }

  /**
   * Smallest read deadline that can be met by a healthy device for a response
   * of `expectedLength` bytes.
   *
   * The caller's timeout is a policy number derived from the polling rate; it
   * knows nothing about how big this particular response is. That was fine
   * while every read was 16 int16 registers (37 bytes), which is what the 100 ms
   * floor in App.tsx was sized against — but an Extended-precision read of the
   * same 16 channels is 69 bytes, and on real hardware the device needs roughly
   * 90-100 ms just to assemble it before the first byte appears. The deadline
   * and the device's own latency then landed on top of each other, so a poll
   * failed whenever the device was a few milliseconds slow: the log showed
   * "Timeout waiting for response (23/69 bytes)" followed by the remaining 46
   * bytes being flushed as stale a moment later.
   *
   * Sized as device latency plus twice the wire time — doubled because the
   * bytes do not necessarily arrive back-to-back, and because at 4800 baud the
   * wire time alone (144 ms for 69 bytes) already exceeds the old floor.
   */
  private minimumReadTimeoutMs(expectedLength: number): number {
    const wireMs = (expectedLength * this.bitsPerChar() * 1000) / this.serialSettings.baudRate;
    return DEVICE_RESPONSE_ALLOWANCE_MS + wireMs * 2;
  }

  /**
   * Build the read-timeout error, logging what the deadline actually measured.
   *
   * The message stays exactly as users have seen it — it is what gets shown in
   * the status bar and the desktop notification — while the numbers that say
   * *why* it fired go to the console. Without them "(0/2 bytes)" is unfalsifiable
   * from a bug report: a silent device and a main thread that was blocked
   * straight through the budget produce the identical string.
   */
  private timeoutError(
    buffered: number,
    atLeast: number,
    elapsedMs: number,
    effectiveTimeout: number,
    stallCreditMs: number,
  ): Error {
    console.warn(`${this.debugPrefix} transfer() read timeout`, {
      buffered,
      atLeast,
      elapsedMs,
      effectiveTimeout,
      stallCreditMs,
      budgetMs: effectiveTimeout + stallCreditMs,
    });
    return new Error(`Timeout waiting for response (${buffered}/${atLeast} bytes)`);
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

    this.readableStream = this.port.readable;
    this.writableStream = this.port.writable;
    this.reader = this.readableStream.getReader();
    this.writer = this.writableStream.getWriter();
    this.pendingRead = null;
    this.streamDead = false;
    this.writerDead = false;
    this.rxSuspect = false;
    this.rxBytesSinceRecovery = 0;
    this.lastReopenAttemptAt = 0;
    console.info(`${this.debugPrefix} streams ready (reader/writer locked)`);

    return true;
  }

  /**
   * Tear the connection down.
   *
   * Re-entrant callers share one teardown rather than the second returning
   * early. `connect()` awaits this before requesting a new port, and an early
   * return made that await a lie: the first teardown was still running, and
   * because its steps resolved `this.port` at call time, it went on to close and
   * null the port `connect()` had just opened.
   */
  async disconnect(): Promise<void> {
    if (!this.disconnectPromise) {
      this.disconnectPromise = this.runDisconnect().finally(() => {
        this.disconnectPromise = null;
      });
    }
    return this.disconnectPromise;
  }

  private async runDisconnect(): Promise<void> {
    // Set synchronously, before the first await: reopenPort() and
    // recoverAfterTransferError() read it to refuse to run during a teardown.
    this.disconnecting = true;
    console.info(`${this.debugPrefix} disconnect() start`);

    // Detach the handles up front and tear down locals from here on. This is
    // what removes the race rather than the mutex wait below: an in-flight
    // transfer can no longer see a half-torn-down client, and a teardown that
    // overlaps a later connect() cannot reach the new port.
    const reader = this.reader;
    const writer = this.writer;
    const port = this.port;
    this.reader = null;
    this.writer = null;
    this.readableStream = null;
    this.writableStream = null;
    this.port = null;
    this.pendingRead = null;

    // Bounded courtesy wait for an in-flight transfer to finish its read: not
    // load-bearing, since the handles above are already detached, but it avoids
    // writing into a closing port and spilling an error log on every disconnect.
    await settleWithin(
      this.transferMutex.acquire().then(() => this.transferMutex.release()),
      TEARDOWN_STEP_TIMEOUT_MS,
    );

    if (reader) {
      console.info(`${this.debugPrefix} cancelling reader`);
      await this.teardownStep('reader cancel', () => reader.cancel());
      try { reader.releaseLock(); } catch (err) { console.warn(`${this.debugPrefix} reader releaseLock failed`, err); }
    }

    if (writer) {
      console.info(`${this.debugPrefix} closing writer`);
      await this.teardownStep('writer close', () => writer.close());
      // close() finishes the stream but keeps the writer's lock; port.close()
      // throws on a still-locked writable, which would leave the USB device
      // claimed and make the next Connect fail.
      try { writer.releaseLock(); } catch (err) { console.warn(`${this.debugPrefix} writer releaseLock failed`, err); }
    }

    if (port) {
      console.info(`${this.debugPrefix} closing port`);
      await this.teardownStep('port close', () => port.close());
    }

    this.streamDead = false;
    this.writerDead = false;
    this.rxSuspect = false;
    this.disconnecting = false;
    console.info(`${this.debugPrefix} disconnect() complete`);
  }

  /**
   * Run one best-effort teardown step, giving up after TEARDOWN_STEP_TIMEOUT_MS.
   *
   * Takes a thunk rather than a promise so a synchronous throw from the call
   * itself is caught here too. Never rethrows: disconnect() must always run to
   * completion, and a step that failed or hung has nothing left to report that
   * the caller could act on.
   */
  private async teardownStep(label: string, start: () => Promise<unknown>): Promise<void> {
    let pending: Promise<unknown>;
    try {
      pending = start();
    } catch (err) {
      console.warn(`${this.debugPrefix} ${label} threw`, err);
      return;
    }
    if (await settleWithin(pending, TEARDOWN_STEP_TIMEOUT_MS)) {
      // Expected when the device was unplugged: the transfer belongs to
      // hardware that is gone. The handle is dropped either way — on a removed
      // device there is nothing left to leak, and on a live one the next
      // Connect re-requests the port from scratch.
      console.warn(`${this.debugPrefix} ${label} timed out after ${TEARDOWN_STEP_TIMEOUT_MS} ms; abandoning it`);
    }
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
      // Free, and it usually works: re-locking the port's current streams needs
      // no USB traffic at all. Only when the port has nothing new to hand back
      // is the close/open round trip below worth its cost.
      if (this.reacquireStreams()) {
        console.info(`${this.debugPrefix} streams re-acquired before transfer`);
      } else {
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
    }
    this.ensureReady();
  }

  /**
   * Re-lock the port's current streams, without touching the USB device.
   *
   * The cheap half of recovery, and the one that fits what actually breaks on
   * Android. There, `transferIn` fails with `NetworkError: A transfer error has
   * occurred` after a fixed volume of received data — measured at roughly 16 KB,
   * which is every ~44 s of 16-channel int16 polling at 10 Hz and every ~24 s of
   * the same poll in extended precision, the same byte count either way. The
   * device is fine; one bulk transfer failed.
   *
   * A failed transfer only destroys the *stream*: the polyfill's underlying
   * source calls `controller.error()` and then its `onError_` hook, which drops
   * the port's cached `readable_`, so the very next read of `port.readable`
   * builds a fresh ReadableStream over the same still-claimed endpoint. Native
   * Web Serial behaves the same way for a non-fatal read error once the dead
   * reader's lock is released. Rebuilding from there costs one poll.
   *
   * reopenPort() was previously the only route back, and on Android it is the
   * expensive, failure-prone one: `close()` drops DTR, releases the interfaces
   * and closes the device, and `open()` has to re-claim and re-configure it —
   * which the platform frequently refuses right after a transfer error. Each
   * refusal left the client with no streams, so every poll in the next
   * REOPEN_THROTTLE_MS window failed with `Device not connected` (37 and 21 of
   * them per incident in the report this came from) and the run burned 4-12 s
   * of its AI-read failure budget on a fault that cost one frame.
   *
   * @returns True when both handles are live again.
   */
  private reacquireStreams(): boolean {
    const port = this.port;
    if (!port || this.disconnecting) return false;

    // Each side is rebuilt only when it is dead or missing. A read error leaves
    // `port.writable` untouched and working, and cycling that lock for nothing
    // would risk a healthy writer to fix a broken reader.
    if (this.streamDead || !this.reader) {
      // What we must not be handed back: the corpse we are already holding.
      // Only meaningful when the stream died — a reader that is merely absent
      // (a reopen that failed halfway) has no stream to be handed back twice.
      const stale = this.streamDead ? this.readableStream : null;
      if (this.reader) {
        // Release first: both implementations only publish a replacement once
        // the dead stream is unlocked, so reading `port.readable` while still
        // holding the reader would return the corpse and fail the check below.
        try { this.reader.releaseLock(); } catch (err) { console.debug(`${this.debugPrefix} reacquireStreams() reader releaseLock failed`, err); }
        this.reader = null;
        this.readableStream = null;
      }
      this.pendingRead = null;

      const readable = port.readable;
      if (!readable || readable === stale) return false;
      try {
        this.reader = readable.getReader();
      } catch (err) {
        console.warn(`${this.debugPrefix} reacquireStreams() failed to lock readable`, err);
        return false;
      }
      this.readableStream = readable;
      this.streamDead = false;
    }

    if (this.writerDead || !this.writer) {
      const stale = this.writerDead ? this.writableStream : null;
      if (this.writer) {
        try { this.writer.releaseLock(); } catch (err) { console.debug(`${this.debugPrefix} reacquireStreams() writer releaseLock failed`, err); }
        this.writer = null;
        this.writableStream = null;
      }

      const writable = port.writable;
      if (!writable || writable === stale) return false;
      try {
        this.writer = writable.getWriter();
      } catch (err) {
        console.warn(`${this.debugPrefix} reacquireStreams() failed to lock writable`, err);
        return false;
      }
      this.writableStream = writable;
      this.writerDead = false;
    }

    // `rxSuspect` and `lastTransferTime` are deliberately left alone, unlike in
    // reopenPort(). The device was never reset here: it may still be shifting
    // out the response the dead stream dropped, and it is still owed its silent
    // interval. The pre-write fence in transfer() sweeps that tail up.
    return this.reader !== null && this.writer !== null;
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
   * A stream the source *errored* is the recoverable case and the opposite of
   * this one: that path does run `onError_`, which drops the cached stream so a
   * replacement can be locked — see reacquireStreams().
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

    const requestedMs = Math.max(0, timeoutMs);
    const armedAt = Date.now();
    let timeoutId: number | undefined;
    const outcome = await Promise.race<ReadOutcome | null>([
      pending,
      new Promise<null>((resolve) => {
        timeoutId = setBackgroundTimeout(() => resolve(null), requestedMs);
      }),
    ]);
    if (timeoutId !== undefined) {
      clearBackgroundTimer(timeoutId);
    }

    // Deadline hit first: leave `pendingRead` in place so the bytes are not
    // lost and the reader stays usable.
    if (outcome === null) {
      this.lastReadOvershootMs = Math.max(0, Date.now() - armedAt - requestedMs);
      return null;
    }

    this.lastReadOvershootMs = 0;
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
    this.rxBytesSinceRecovery += value?.length ?? 0;
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
   * The fallback half of recovery, for when the port has no replacement stream
   * to hand out — a stream closed rather than errored, or a device that needs
   * re-claiming. `SerialPort.readable` keeps returning the closed stream until
   * the port is re-opened (the WebUSB polyfill rebuilds it in `close()`, native
   * Web Serial in `open()`). No user gesture is needed — the port permission is
   * already granted.
   *
   * Try reacquireStreams() first: this path drops DTR and re-claims the USB
   * interfaces, which is both slow and, on Android, often refused outright.
   *
   * @throws If the port cannot be re-opened.
   */
  private async reopenPort(): Promise<void> {
    // A teardown is closing this port; reopening it here is how the client ended
    // up holding an open, stream-locked port it no longer referenced — which
    // made the next Connect throw "the port is already open" and left the device
    // unusable until a page reload, while the UI reported a clean disconnect.
    if (this.disconnecting) {
      throw new Error('Disconnecting');
    }
    const port = this.port;
    if (!port) {
      throw new Error('Device not connected');
    }

    // Both streams must be unlocked before close(), or it throws.
    try { this.reader?.releaseLock(); } catch (err) { console.debug(`${this.debugPrefix} reopenPort() reader releaseLock failed`, err); }
    try { this.writer?.releaseLock(); } catch (err) { console.debug(`${this.debugPrefix} reopenPort() writer releaseLock failed`, err); }
    this.reader = null;
    this.writer = null;
    this.readableStream = null;
    this.writableStream = null;
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

    this.readableStream = port.readable;
    this.writableStream = port.writable;
    this.reader = this.readableStream.getReader();
    this.writer = this.writableStream.getWriter();
    this.streamDead = false;
    this.writerDead = false;
    // A reopened port has fresh streams: whatever the device owed the previous
    // ones is unreachable now, so there is nothing to fence against.
    this.rxSuspect = false;
    this.lastTransferTime = 0;
  }

  /**
   * Best-effort recovery run after every failed transfer.
   *
   * A live stream only needs its stale bytes drained. A dead one is rebuilt
   * from the port's own streams where possible (see reacquireStreams), and only
   * when the port has no replacement to offer is the device closed and
   * re-opened — throttled to REOPEN_THROTTLE_MS so a permanently unplugged
   * device does not spin on reopen attempts every polling cycle.
   */
  private async recoverAfterTransferError(): Promise<void> {
    // Nothing to recover into: the handles are already detached and the port is
    // being closed. Flushing or reopening here would fight the teardown.
    if (this.disconnecting) return;
    if (!this.streamDead && !this.writerDead) {
      try {
        await this.flushReceiveBuffer();
      } catch (flushErr) {
        console.warn(`${this.debugPrefix} flush after error failed`, flushErr);
      }
      // The flush reads, so it can be the thing that discovers a dead stream.
      // Re-checked rather than returned on, or that discovery would wait a poll.
      if (!this.streamDead && !this.writerDead) return;
    }

    console.warn(`${this.debugPrefix} serial stream is dead`, {
      streamDead: this.streamDead,
      writerDead: this.writerDead,
      rxBytesSinceRecovery: this.rxBytesSinceRecovery,
    });
    this.rxBytesSinceRecovery = 0;

    if (this.reacquireStreams()) {
      console.info(`${this.debugPrefix} streams re-acquired without reopening the port`);
      return;
    }

    const now = Date.now();
    if (now - this.lastReopenAttemptAt < REOPEN_THROTTLE_MS) return;
    this.lastReopenAttemptAt = now;

    console.warn(`${this.debugPrefix} no replacement streams available; reopening port`);
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

      // Stale-RX fence, deliberately placed before the write rather than after
      // the failure it reacts to.
      //
      // Validating the slave ID, function code and CRC (below) still cannot tell
      // a late answer to the *previous, identical* request from a legitimate one:
      // same address, same function code, same length, valid CRC. And
      // recoverAfterTransferError()'s flush cannot catch it either — that window
      // closes 30-80 ms after the failure, while the response may arrive any time
      // before the next poll.
      //
      // Draining here closes it structurally rather than heuristically: at this
      // instant no request is outstanding, so anything readable is stale by
      // construction. Costs nothing on a healthy link (rxSuspect is false) and at
      // most a few ms once after a failure.
      if (this.rxSuspect) {
        this.rxSuspect = false;
        try {
          await this.flushReceiveBuffer(
            this.isUsingPolyfill ? STALE_PREWRITE_FLUSH_MS_POLYFILL : STALE_PREWRITE_FLUSH_MS_NATIVE,
          );
        } catch (flushErr) {
          console.warn(`${this.debugPrefix} pre-write stale flush failed`, flushErr);
        }
      }

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
      try {
        await writer.write(frame);
      } catch (writeErr) {
        // A rejected write means the sink errored its WritableStream, so this
        // writer is finished — every later write() would reject the same way.
        // Left unflagged, the TX side had no recovery path at all: only the
        // read side ever set a dead flag, so a failed transferOut would fail
        // every remaining poll of the run.
        this.writerDead = true;
        throw writeErr;
      }
      console.debug(`${this.debugPrefix} transfer() write complete`);

      // The read deadline starts here, not at mutex acquisition.
      //
      // `startTime` above is taken before ensureReadyOrRecover(), before the
      // Modbus silent-interval wait and before the request goes out, so using it
      // made `timeout` a whole-transaction budget while it was documented and
      // sized as a response deadline. At 4800 baud a 16-register read is ~93 ms
      // on the wire and the budget is 100 ms (see the comment on readTimeoutMs
      // in App.tsx) — subtract up to 10 ms of inter-frame wait and the time to
      // shift the request out, and a healthy device timed out on every poll.
      // Worse, when ensureReadyOrRecover() had just reopened the port (close +
      // open, easily over 100 ms) the budget was already spent, so the frame was
      // written and the timeout thrown without a single read attempt — leaving a
      // full untouched response in the buffer for the next request to mistake
      // for its own.
      const readStart = Date.now();
      // The caller's timeout is a floor, not a ceiling: see minimumReadTimeoutMs.
      const effectiveTimeout = Math.max(timeout, this.minimumReadTimeoutMs(expectedLength));

      // Read and frame the response. The expected header comes from the request
      // itself — buildFrame() puts the slave ID at [0] and the function code at
      // [1] — which is why validating them costs no change to any caller.
      const expectedSlaveId = frame[0];
      const expectedFunctionCode = frame[1];
      const buffer: number[] = [];
      let responseArray: Uint8Array | null = null;
      let isException = false;
      // Wall-clock time credited back to the deadline because the main thread
      // was blocked through it — see TIMER_STALL_THRESHOLD_MS.
      let stallCreditMs = 0;
      let stallCredits = 0;

      while (responseArray === null) {
        const scan = scanModbusFrame(buffer, expectedSlaveId, expectedFunctionCode, expectedLength);

        if (scan.kind === 'drop') {
          // One byte at a time: the byte being dropped may itself be the start
          // of the real frame.
          const dropped = buffer.splice(0, scan.count);
          console.warn(`${this.debugPrefix} transfer() resync`, {
            droppedHex: this.toHexString(new Uint8Array(dropped)),
            remaining: buffer.length,
          });
          continue;
        }

        if (scan.kind === 'frame') {
          responseArray = new Uint8Array(buffer.splice(0, scan.length));
          isException = scan.isException;
          break;
        }

        const elapsedMs = Date.now() - readStart;
        const remainingMs = effectiveTimeout + stallCreditMs - elapsedMs;
        if (remainingMs <= 0) {
          throw this.timeoutError(buffer.length, scan.atLeast, elapsedMs, effectiveTimeout, stallCreditMs);
        }
        const chunk = await this.readChunk(remainingMs);
        if (chunk === null) {
          // A deadline that fired far past its delay did not measure the
          // device; it measured a main thread that was blocked. Credit the lost
          // time back and look again — the response is very likely already
          // delivered and waiting in the parked read.
          const overshootMs = this.lastReadOvershootMs;
          if (overshootMs > TIMER_STALL_THRESHOLD_MS && stallCredits < MAX_STALL_CREDITS_PER_TRANSFER) {
            stallCredits += 1;
            stallCreditMs += overshootMs + STALL_GRACE_MS;
            console.warn(`${this.debugPrefix} transfer() read deadline fired late; main thread stalled`, {
              overshootMs,
              stallCredits,
              stallCreditMs,
              buffered: buffer.length,
            });
            continue;
          }
          throw this.timeoutError(
            buffer.length,
            scan.atLeast,
            Date.now() - readStart,
            effectiveTimeout,
            stallCreditMs,
          );
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

      // Anything past a complete frame is not ours — a duplicate answer, or the
      // tail of one we already gave up on. Dropped here rather than left for the
      // next transfer to trip over.
      if (buffer.length > 0) {
        console.warn(`${this.debugPrefix} transfer() trailing bytes discarded`, {
          count: buffer.length,
          hex: this.toHexString(new Uint8Array(buffer)),
        });
        buffer.length = 0;
      }

      console.debug(`${this.debugPrefix} transfer() response assembled`, {
        responseLength: responseArray.length,
        isException,
        ...(this.verboseFrameLogging ? { rxHex: this.toHexString(responseArray) } : {}),
      });

      // An exception is a real frame on the wire, so it owes the next request the
      // same silent interval a success does. Set before the throw below.
      this.lastTransferTime = Date.now();

      if (isException) {
        throw new ModbusExceptionError(expectedFunctionCode, responseArray[2]);
      }

      console.debug(`${this.debugPrefix} transfer() success`, {
        elapsedMs: this.lastTransferTime - startTime,
        readElapsedMs: this.lastTransferTime - readStart,
      });

      return new DataView(responseArray.buffer);
    } catch (err) {
      if (err instanceof ModbusExceptionError) {
        // The device answered; it just refused the request. There are no stale
        // bytes to drain, the stream is fine, and running the recovery flush
        // would cost 30-80 ms on every poll for nothing.
        console.warn(`${this.debugPrefix} transfer() exception response`, {
          functionCode: err.functionCode,
          exceptionCode: err.exceptionCode,
        });
        throw err;
      }
      console.error(`${this.debugPrefix} transfer() failed`, {
        expectedLength,
        timeout,
        effectiveTimeout: Math.max(timeout, this.minimumReadTimeoutMs(expectedLength)),
        txLength: frame.length,
        elapsedMs: Date.now() - startTime,
        error: err,
      });
      // No whole frame was consumed, so the device may still owe a response that
      // would otherwise be handed to the next request. Spent before the next
      // write — see the stale-RX fence above.
      this.rxSuspect = true;
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
    assertRegisterByteCount(byteCount, count);
    for (let i = 0; i < count; i += 1) {
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
    assertRegisterByteCount(byteCount, count);
    for (let i = 0; i < count; i += 1) {
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
    assertRegisterByteCount(byteCount, registerCount);

    // Process pairs of registers as float32 (ABCD byte order = big-endian)
    for (let i = 0; i < count; i += 1) {
      const float32Value = view.getFloat32(3 + i * 4, false); // false = big-endian (ABCD)
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
