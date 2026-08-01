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
// The transport talks to the app's log directly, not only to the console.
// The failures this file has to explain happen on an Android phone, where the
// console is only reachable over remote debugging with a cable already occupied
// by the device under test. The in-app log is the one surface a user can
// actually read and paste from in the field.
import {
  logSystem,
  passesLevel,
  SOURCE,
  systemLogLevel,
  type SystemLogLevel,
} from '../utils/systemLog';

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

/**
 * Backoff between automatic port-reopen attempts, in ms, one per consecutive
 * failure. The last entry repeats once the list runs out, and each wait is
 * measured from the *end* of the previous attempt.
 *
 * Two field traces show what this is retrying against. After a transfer error
 * `claimInterface` is refused — "Unable to claim interface" — and stays refused
 * for a while no matter how often it is asked:
 *
 *     attempt at +0.00s FAIL   +1.07s FAIL   +3.10s OK      (second trace)
 *     attempt at +0.00s FAIL   +2.04s FAIL   +4.04s OK      (first trace)
 *
 * measured from the stream error, not from the close() before each attempt. So
 * the gate is a recovery the USB stack is doing on its own after the fault, on
 * the order of two to three seconds, and nothing this code does hurries it.
 *
 * So the ladder holds a short cadence *through* that window rather than backing
 * off inside it. An earlier shape — 500, 500, 500, 1000, 2000 — reached two
 * seconds while the gate was still shut, which put the next attempt at +4.4 s
 * against a gate that had lifted at +2.5 s: 1.9 s of hole bought nothing. Six
 * entries at 500 ms cover the whole observed range, and only past it does the
 * ladder climb, because by then the explanation is no longer a gate but a
 * device that has genuinely been unplugged and must not be retried on every
 * poll for the rest of the session.
 *
 * Indexed by the number of consecutive failures, so entry 0 is the gap after a
 * *successful* reopen and entry 1 onwards is the ladder proper. An attempt of
 * its own costs about 350 ms on the hardware in the trace, so these are gaps
 * between attempts, not the attempt period.
 */
const REOPEN_BACKOFF_MS = [500, 500, 500, 500, 500, 500, 1000, 2000];

/**
 * Pause between closing and re-opening the port during recovery.
 *
 * Kept small. It was introduced on the theory that the refused `claimInterface`
 * was racing the close() immediately before it; the trace above disproved that
 * — the gate is timed from the fault, not from the close — so this is no longer
 * load-bearing and only costs recovery time. Left non-zero because close() and
 * open() back to back with no yield at all is worth avoiding regardless, and
 * removed entirely from the planned reopen, which has no fault to recover from.
 *
 * Polyfill only: native Web Serial claims nothing and has no such race.
 */
const REOPEN_SETTLE_MS = 50;

/**
 * Cap on each individual teardown step in disconnect().
 *
 * A device that was physically unplugged may never settle reader.cancel(),
 * writer.close() or port.close(): the underlying transfers belong to a device
 * that is simply gone. Awaiting those unbounded strands the
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

// Diagnostics for the Android/WebUSB stall, all read-only: nothing below changes
// what the client does, only what it says when it fails.
//
// The failure being chased is a `transferIn` that neither resolves nor rejects.
// readChunk() parks a read it gave up waiting for rather than cancelling it, so
// one hung transfer is enough to make every later poll re-await the same
// never-settling promise. That looks identical, in the log, to a device that has
// simply gone quiet: both say `Timeout waiting for response (0/2 bytes)`. These
// tell them apart.
//
// Kept after the transport fix, because they are what would show it coming back.

/** A read parked longer than this is worth a console line when it settles. */
const PARKED_READ_REPORT_MS = 1000;

/**
 * How long a read must have been parked before the timeout it causes is
 * reported as stuck rather than merely carried over from the previous poll.
 *
 * A read parked across one poll interval is ordinary — it is how a response
 * that arrives late still gets picked up. One parked for seconds is not.
 */
const STUCK_READ_MS = 5000;

/**
 * Quiet period held after a failed transfer, before the next request goes out.
 *
 * Modbus RTU has no way to say "that reply was for the previous question". A
 * device that was still assembling or still shifting out its answer when the
 * link broke will finish doing so, and if the next request is already on the
 * wire by then, that answer is read as its reply — same slave, same function
 * code, same length, valid CRC. Nothing downstream can catch it.
 *
 * So the fix is silence, not cleverness: wait until the device has certainly
 * finished talking, drain whatever it said, and only then ask again. Sized from
 * DEVICE_RESPONSE_ALLOWANCE_MS, which is how long the reference hardware may
 * take to produce a first byte — past that, plus the frame's own wire time, the
 * device is idle by construction.
 *
 * Only spent when the previous transfer ended mid-frame (`rxSuspect`), so a
 * healthy link never pays it. It costs a poll slot or two during recovery,
 * which the polling loop absorbs: it re-arms after each poll returns rather
 * than on a fixed timer, so a slow transfer delays the next poll instead of
 * stacking up behind it.
 */
const RECOVERY_QUIET_MS = 200;

/**
 * Bucket size for the received-byte count quoted on a dead-stream error.
 *
 * Quoted coarsely on purpose: the system log collapses consecutive identical
 * lines into `(×N)`, so an exact byte count would split one incident into N
 * separate lines and bury the log. Rounded, the same incident stays one line —
 * and rounding loses nothing here, because the question being asked of it is
 * "roughly 16 KB again?", not "how many bytes exactly".
 */
const RX_BYTES_BUCKET = 4096;

/**
 * Frames between DEBUG health lines — 10 s of a 10 Hz poll.
 *
 * Chosen so a run left at DEBUG produces a readable trickle rather than a
 * flood, while still bracketing any failure closely enough that the last health
 * line before it says what the link had carried.
 */
const HEALTH_LINE_EVERY_FRAMES = 100;

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
  /** When the read now sitting in `pendingRead` was issued. Diagnostic only. */
  private pendingReadIssuedAt = 0;
  /** When the read that most recently settled or expired had been issued. */
  private lastSettledReadIssuedAt = 0;
  /**
   * How long the read had already been parked when the last deadline expired.
   * Zero when that read was issued by the transfer that timed out on it.
   */
  private lastReadParkedForMs = 0;
  /**
   * Counters since the last dead stream — the "epoch" a stream error ends.
   *
   * These are what identified the Android `transferIn` failure as metered
   * rather than timed: the interval between failures tracked the response size
   * (44 s of 16-channel int16 reads, 24 s of the same read in float32) while
   * the chunk count at failure did not (~16,200 either way). That constant is
   * what pointed at a per-transfer resource rather than anything on the wire —
   * `web-serial-polyfill` orphaning one `transferIn` per byte received until
   * Android's pending-URB memory ran out. See modbus/webusbSerial.ts.
   *
   * Kept because a chunk count that starts climbing toward five figures again
   * is the earliest visible sign of that class of bug returning.
   */
  private epochStartedAt = 0;
  private epochRxBytes = 0;
  private epochRxChunks = 0;
  private epochFrames = 0;
  /** Per-transfer, for the TRACE line and the incident report. */
  private txAt = 0;
  private frameRxChunks = 0;
  private frameFirstByteMs = -1;
  /** When the last transfer failed, so the quiet period can be measured. */
  private lastFailureAt = 0;
  /** Successful frames at the last DEBUG health line. */
  private framesAtLastHealthLine = 0;
  /** True once a read reported `done` or threw: the stream can never recover. */
  private streamDead = false;
  /**
   * True when the last transfer ended without consuming a whole frame, so the
   * device may still owe a response. Armed in transfer()'s catch and spent by
   * the stale-RX flush before the next write.
   */
  private rxSuspect = false;
  /** Consecutive failed reopen attempts, indexing REOPEN_BACKOFF_MS. */
  private reopenFailures = 0;
  /**
   * When the last reopen attempt *finished*.
   *
   * The backoff is measured from here, not from when the attempt started. A
   * trace caught the difference: a 1000 ms backoff following a 650 ms attempt
   * let the next one fire 400 ms later, so the ladder was being eaten by the
   * attempts it was meant to space out.
   */
  private lastReopenFinishedAt = 0;
  /**
   * When the stream last died. Reported with each reopen attempt, because the
   * claim gate is timed from the fault — so how late an attempt is relative to
   * *this*, not to the previous attempt, is what predicts whether it works.
   */
  private lastStreamDeathAt = 0;
  /** True while a throttle window is being waited out, so it is said once. */
  private reopenThrottleReported = false;
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
   * Write one line to the app's log, building it only if anyone will see it.
   *
   * The threshold gate belongs here rather than in the log: logSystem() stores
   * every line and filters at render, so an ungated TRACE line at 10 Hz would
   * push the 2000-entry ring over in about three minutes and delete the history
   * a reader at INFO came for. Gated, TRACE costs one comparison per poll until
   * somebody asks for it.
   */
  private log(level: SystemLogLevel, build: () => string): void {
    if (!passesLevel(level, systemLogLevel())) return;
    logSystem(level, SOURCE.link, build());
  }

  /** `1234` -> `1.2 KB`, for lines a human reads at a glance. */
  private static formatBytes(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }

  /**
   * What the link has carried since the last stream error.
   *
   * The shared tail of the health line and the incident line, so the two are
   * directly comparable when reading a log: the last health line before a
   * failure and the failure itself quote the same quantities.
   */
  private epochSummary(): string {
    const seconds = (Date.now() - this.epochStartedAt) / 1000;
    const perFrame = this.epochFrames > 0 ? this.epochRxChunks / this.epochFrames : 0;
    // Bytes per chunk is the one that turned out to matter. A CDC adapter that
    // hands the host one byte per USB transfer makes a 69-byte response cost 69
    // `transferIn` round trips, and that ratio is what made a leak of one
    // orphaned transfer per *byte* — `web-serial-polyfill`'s, since replaced by
    // modbus/webusbSerial.ts — fill Android's pending-URB budget in seconds
    // rather than hours. Quoted here so the ratio stays visible in the log
    // rather than being something a reader has to divide out.
    const perChunk = this.epochRxChunks > 0 ? this.epochRxBytes / this.epochRxChunks : 0;
    return (
      `${WebSerialModbusClient.formatBytes(this.epochRxBytes)} in ${this.epochFrames} frames ` +
      `over ${seconds.toFixed(1)}s, ${this.epochRxChunks} USB transfers ` +
      `(${perFrame.toFixed(1)}/frame, ${perChunk.toFixed(2)} B each)`
    );
  }

  /** Start a fresh epoch. Called on connect and after every stream error. */
  private resetEpoch(): void {
    this.epochStartedAt = Date.now();
    this.epochRxBytes = 0;
    this.epochRxChunks = 0;
    this.epochFrames = 0;
    this.framesAtLastHealthLine = 0;
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
   * The exact numbers that say *why* it fired go to the console; without them
   * "(0/2 bytes)" is unfalsifiable from a bug report, because a silent device
   * and a main thread that was blocked straight through the budget produce the
   * identical string.
   *
   * The message itself now carries one bit beyond that: whether the read it gave
   * up on had been sitting unsettled since an earlier poll. That is the third
   * way to produce "(0/2 bytes)" and the only one that never recovers on its own
   * — a `transferIn` that never settles is re-awaited by every later poll — so
   * distinguishing it matters more than keeping the string byte-identical to
   * what users have seen. It stays a fixed phrase rather than a duration so the
   * log can still collapse a run of them into one `(×N)` line.
   */
  private timeoutError(
    buffered: number,
    atLeast: number,
    elapsedMs: number,
    effectiveTimeout: number,
    stallCreditMs: number,
  ): Error {
    const parkedForMs = this.lastReadParkedForMs;
    console.warn(`${this.debugPrefix} transfer() read timeout`, {
      buffered,
      atLeast,
      elapsedMs,
      effectiveTimeout,
      stallCreditMs,
      budgetMs: effectiveTimeout + stallCreditMs,
      parkedForMs,
      epochRxBytes: this.epochRxBytes,
    });
    const parked =
      parkedForMs >= STUCK_READ_MS ? `, read stuck >${STUCK_READ_MS / 1000}s`
      : parkedForMs > 0 ? ', parked read'
      : '';
    return new Error(`Timeout waiting for response (${buffered}/${atLeast} bytes${parked})`);
  }

  /**
   * Restate `err` with the volume the dead stream carried before it died.
   *
   * A new Error rather than a mutated one: `err` may be a DOMException, whose
   * `message` is read-only, and the WebUSB NetworkError this exists for is
   * exactly that.
   */
  private withRxVolume(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    const bucketKb = Math.round(this.epochRxBytes / RX_BYTES_BUCKET) * RX_BYTES_BUCKET / 1024;
    return new Error(`${message} [rx ~${bucketKb} KB since last stream error]`);
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
    this.rxSuspect = false;
    this.lastReadParkedForMs = 0;
    this.lastFailureAt = 0;
    this.reopenFailures = 0;
    this.reopenThrottleReported = false;
    this.resetEpoch();
    console.info(`${this.debugPrefix} streams ready (reader/writer locked)`);
    this.log('DEBUG', () =>
      `transport ready: ${this.isUsingPolyfill ? 'WebUSB CDC-ACM' : 'native Web Serial'}, ` +
      `${this.serialSettings.baudRate}bps, silent interval ${this.minMessageIntervalMs.toFixed(1)}ms`);

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
      await this.attemptReopen('streams missing');
    }
    this.ensureReady();
  }

  /**
   * One backoff-gated reopen attempt.
   *
   * Shared by both callers — the recovery after a failed transfer and the
   * readiness check before the next one. They are the same operation reached
   * from two directions, and each used to keep its own copy of the throttle, so
   * an attempt made by one reset the window the other was waiting out.
   *
   * @param reason - What prompted the attempt, for the log.
   * @returns True if the port is open with fresh streams.
   */
  private async attemptReopen(reason: string): Promise<boolean> {
    const now = Date.now();
    const backoffMs = REOPEN_BACKOFF_MS[
      Math.min(this.reopenFailures, REOPEN_BACKOFF_MS.length - 1)
    ];
    if (now - this.lastReopenFinishedAt < backoffMs) {
      // Once per window, not once per poll. Said every poll — with a countdown
      // that changed each time, so it could not collapse either — this line
      // interleaved with the caller's own error lines and stopped *those* from
      // collapsing too, turning one incident into eighty rows.
      if (!this.reopenThrottleReported) {
        this.reopenThrottleReported = true;
        this.log('DEBUG', () => `waiting ${backoffMs}ms before the next reopen attempt`);
      }
      console.debug(`${this.debugPrefix} reopen throttled`, {
        msToGo: backoffMs - (now - this.lastReopenFinishedAt),
        reopenFailures: this.reopenFailures,
      });
      return false;
    }
    this.reopenThrottleReported = false;

    // Reported against the fault, not against the previous attempt, because
    // that is what the claim gate is timed from — see REOPEN_BACKOFF_MS. This
    // is the number that says whether the gate has lifted yet.
    const sinceFault = this.lastStreamDeathAt > 0
      ? `, +${((now - this.lastStreamDeathAt) / 1000).toFixed(1)}s since the fault`
      : '';
    console.warn(`${this.debugPrefix} reopening port`, { reason });
    this.log('DEBUG', () => `reopening the port (${reason})${sinceFault}`);

    try {
      await this.reopenPort();
      this.lastReopenFinishedAt = Date.now();
      this.reopenFailures = 0;
      console.info(`${this.debugPrefix} port reopened`);
      this.log('DEBUG', () => `port reopened in ${this.lastReopenFinishedAt - now}ms${sinceFault}`);
      return true;
    } catch (err) {
      this.lastReopenFinishedAt = Date.now();
      this.reopenFailures += 1;
      console.error(`${this.debugPrefix} port reopen failed`, err);
      this.log('DEBUG', () =>
        `port reopen FAILED after ${this.lastReopenFinishedAt - now}ms${sinceFault}: ` +
        `${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
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
   * the next caller instead of being cancelled, for two reasons.
   *
   * It keeps the bytes. A cancelled read discards whatever the device had
   * already sent; a parked one hands it to whoever reads next, which is how a
   * response that arrives just past its deadline still gets used.
   *
   * And it was once the only safe option. `web-serial-polyfill` gave its
   * endpoint source no `cancel` hook, so `reader.cancel()` closed the
   * ReadableStream while `SerialPort.readable` went on handing back that same
   * closed stream — every later `read()` resolved `{ done: true }` forever and
   * polling stalled at 0 Hz with the UI still showing a live connection.
   * modbus/webusbSerial.ts has a cancel hook and rebuilds the stream, so that
   * particular trap is gone; parking stays because of the first reason.
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
      this.pendingReadIssuedAt = Date.now();
      this.pendingRead = reader.read().then(
        (result): ReadOutcome => ({ ok: true, result }),
        (error): ReadOutcome => ({ ok: false, error }),
      );
    }
    const pending = this.pendingRead;
    const parkedForMs = Date.now() - this.pendingReadIssuedAt;

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
      this.lastReadParkedForMs = parkedForMs;
      this.lastSettledReadIssuedAt = this.pendingReadIssuedAt;
      return null;
    }

    this.lastSettledReadIssuedAt = this.pendingReadIssuedAt;
    if (parkedForMs > PARKED_READ_REPORT_MS) {
      // A read that comes back after seconds of nothing is the tell for the
      // hung-transfer theory: it means the transfer was alive but stalled, not
      // that the device was quiet. Worth a line even at DEBUG.
      this.log('DEBUG', () =>
        `read settled after ${(parkedForMs / 1000).toFixed(1)}s parked ` +
        `(${outcome.ok ? `${outcome.result.value?.length ?? 0} B` : 'error'})`);
      console.warn(`${this.debugPrefix} parked read settled`, { parkedForMs, ok: outcome.ok });
    }
    this.lastReadOvershootMs = 0;
    this.lastReadParkedForMs = 0;
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
    const length = value?.length ?? 0;
    this.epochRxBytes += length;
    this.epochRxChunks += 1;
    this.frameRxChunks += 1;
    if (this.frameFirstByteMs < 0 && length > 0 && this.txAt > 0) {
      this.frameFirstByteMs = Date.now() - this.txAt;
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
   * The way back from a dead ReadableStream. Native Web Serial rebuilds it in
   * `open()`; modbus/webusbSerial.ts drops it as soon as the stream errors, but
   * its bulk-IN pipeline stays stopped until `open()` re-claims the interface,
   * so a reopen is what actually restores the link on both. No user gesture is
   * needed — the port permission is already granted.
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
    this.pendingRead = null;

    try { await port.close(); } catch (err) { console.warn(`${this.debugPrefix} reopenPort() close failed`, err); }

    // Let Android finish releasing the interface before asking for it back.
    // Without this the very next call is `claimInterface`, and a field trace
    // caught it failing twice in a row with "Unable to claim interface" —
    // 328 ms of work to produce an error, then a throttle window, then the same
    // again. The device was fine; only the timing was wrong. See
    // REOPEN_SETTLE_MS.
    if (this.isUsingPolyfill) {
      await new Promise<void>((resolve) => setBackgroundTimeout(resolve, REOPEN_SETTLE_MS));
    }

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
    // `rxSuspect` is deliberately left set. The old reasoning was that fresh
    // streams put whatever the device owed out of reach — true of the stream,
    // false of the device. It never saw the reopen: if it was mid-response when
    // the link broke it is still shifting bytes out, and they land in the *new*
    // stream, where they read as the reply to the next request. Keeping the
    // fence set means the next transfer waits out the quiet period and drains
    // first, which is the whole point of RECOVERY_QUIET_MS. Costs one flush
    // window on a link that really is clean.
    //
    // Not zero. Zero reads as "the last frame was in 1970", which skips the
    // Modbus silent interval entirely and puts the next request on the wire the
    // instant the port is back — the one thing RTU does not tolerate. The device
    // never saw the reopen; from its side this is simply the next frame, and it
    // is owed the same gap as any other. Charging the interval from now also
    // gives an adapter that has just had DTR dropped and re-asserted a moment to
    // settle before it is asked for anything.
    this.lastTransferTime = Date.now();
  }

  /**
   * Best-effort recovery run after every failed transfer.
   *
   * A live stream only needs its stale bytes drained. A dead one needs the
   * port re-opened, on the REOPEN_BACKOFF_MS ladder so a permanently
   * unplugged device does not spin on reopen attempts every polling cycle.
   */
  private async recoverAfterTransferError(): Promise<void> {
    // Nothing to recover into: the handles are already detached and the port is
    // being closed. Flushing or reopening here would fight the teardown.
    if (this.disconnecting) return;
    if (!this.streamDead) {
      try {
        await this.flushReceiveBuffer();
      } catch (flushErr) {
        console.warn(`${this.debugPrefix} flush after error failed`, flushErr);
      }
    }
    if (!this.streamDead) return;

    await this.attemptReopen('dead stream');
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
    let streamWasDead = this.streamDead;
    try {
      // Inside the mutex so a recovering reopen cannot race a concurrent
      // transfer, and so the readiness check sees the rebuilt streams.
      await this.ensureReadyOrRecover();
      // A reopen in there may have revived the stream, so what counts as "died
      // during this transfer" is measured from here, not from before the wait.
      streamWasDead = this.streamDead;
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
        // Silence before the drain, not just a drain. The fence could only ever
        // sweep up bytes that had already arrived, and after a mid-frame failure
        // the device is usually still working: it may not have sent its first
        // byte yet, let alone all 69 of them. Flushing at that moment finds an
        // empty buffer, declares the line clean, and sends the next request
        // straight into the answer to the previous one — which arrives looking
        // exactly like a valid reply. Waiting first is what makes the drain mean
        // something. See RECOVERY_QUIET_MS.
        const sinceFailure = Date.now() - this.lastFailureAt;
        const quietMs = Math.min(RECOVERY_QUIET_MS, Math.max(0, RECOVERY_QUIET_MS - sinceFailure));
        if (quietMs > 0) {
          // Fixed wording, with the varying figure left to the console: the
          // remaining wait differs by a millisecond or two every poll, and in
          // the log that would break the `(×N)` collapsing and turn a stall into
          // one line per poll. What matters here is that the hold happened.
          console.debug(`${this.debugPrefix} holding the line quiet`, { quietMs, sinceFailure });
          this.log('DEBUG', () => `holding the line quiet up to ${RECOVERY_QUIET_MS}ms before retrying`);
          await new Promise<void>((resolve) => setBackgroundTimeout(resolve, quietMs));
        }
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
      this.frameRxChunks = 0;
      this.frameFirstByteMs = -1;
      await writer.write(frame);
      this.txAt = Date.now();
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

      this.epochFrames += 1;
      this.log('TRACE', () =>
        `rx ${responseArray!.length}B in ${this.frameRxChunks} chunk(s), ` +
        `first byte +${this.frameFirstByteMs}ms, frame ${this.lastTransferTime - readStart}ms ` +
        `[epoch ${WebSerialModbusClient.formatBytes(this.epochRxBytes)}/${this.epochFrames}]`);
      // A periodic line at DEBUG so the volume trajectory is readable without
      // the per-frame flood TRACE produces. This is the one that answers "how
      // much had it carried when it died" for a user who cannot leave TRACE on
      // for a whole run.
      if (this.epochFrames - this.framesAtLastHealthLine >= HEALTH_LINE_EVERY_FRAMES) {
        this.framesAtLastHealthLine = this.epochFrames;
        this.log('DEBUG', () => `link ok: ${this.epochSummary()}`);
      }

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
        streamDead: this.streamDead,
        epochRxBytes: this.epochRxBytes,
        error: err,
      });
      // A stream that just died takes the volume it carried with it into the
      // message. On Android the `transferIn` failure is not timed but *metered*
      // — it lands after a fixed amount of received data — and that is the one
      // thing the log otherwise cannot show, because the interval it does show
      // changes with the response size (44 s of int16 reads and 24 s of float32
      // reads are the same 16 KB). Bucketed so the log still collapses repeats.
      const diedNow = this.streamDead && !streamWasDead;
      const rethrown = diedNow ? this.withRxVolume(err) : err;

      if (diedNow) {
        // The full incident report, at DEBUG rather than in the thrown message,
        // because it is long and varies per incident — in the message it would
        // defeat the log's `(×N)` collapsing and bury the run.
        //
        // `issuedBeforeWrite` is the sharp one. The polyfill's ReadableStream
        // re-pulls as soon as a chunk is consumed, so between polls there is
        // always a `transferIn` parked on the bulk IN endpoint with no request
        // outstanding. If the read that died was issued before this request went
        // out, the transfer failed while the link was *idle* — which is a USB
        // stack fault and nothing the Modbus layer did. If it was issued after,
        // the failure belongs to this exchange.
        const issuedBeforeWrite = this.txAt > 0 && this.lastSettledReadIssuedAt < this.txAt;
        this.log('DEBUG', () =>
          `stream died: ${this.epochSummary()}; ` +
          `failing read was issued ${issuedBeforeWrite ? 'BEFORE' : 'after'} the request, ` +
          `${Date.now() - this.lastSettledReadIssuedAt}ms ago`);
        this.resetEpoch();
        // The clock the claim gate runs on — see attemptReopen().
        this.lastStreamDeathAt = Date.now();
      }

      // No whole frame was consumed, so the device may still owe a response that
      // would otherwise be handed to the next request. Spent before the next
      // write — see the stale-RX fence above.
      this.rxSuspect = true;
      // Where the quiet period is measured from: the moment the exchange failed,
      // not the moment the next one starts. Recovery can take a while, and time
      // already spent reopening a port is time the device has already had to
      // finish talking.
      this.lastFailureAt = Date.now();
      await this.recoverAfterTransferError();
      throw rethrown;
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
