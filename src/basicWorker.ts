// BASIC runtime worker. Same contract as pyodideWorker.ts (see
// utils/scriptWorkerProtocol.ts), so useScriptRunner can swap one for the other.
//
// Unlike Pyodide there is nothing to download and no init cost: the interpreter
// is a few kB of our own code, already in the bundle. `init` therefore only
// stores the shared buffers, and a run can start on the same tick.
//
// Stopping is structural rather than cooperative. The interpreter is a program
// counter over a flat instruction array (see basic/parser.ts), so this loop
// gets control back every few milliseconds no matter what the script is doing —
// including a `Do ... Loop` with no exit, which in a tree-walking interpreter
// would be unkillable.
import { BasicInterpreter } from './basic/interpreter';
import type { BasicHost } from './basic/builtins';
import { BasicRuntimeError } from './basic/values';
import { BasicSyntaxError } from './basic/lexer';
import {
  INTERRUPT_NONE,
  INTERRUPT_PENDING,
  type ScriptWorkerRequest,
  type ScriptWorkerResponse,
} from './utils/scriptWorkerProtocol';

/**
 * How long the interpreter runs before handing control back.
 *
 * One frame's worth. Long enough that the per-slice overhead is noise even in a
 * tight numeric loop, short enough that Stop feels immediate and that output
 * appears while a long run is still going.
 */
const SLICE_MS = 8;

/**
 * Sleep is served in slices too, so a `Sleep 3600000` is still interruptible.
 * Timers in a worker are not throttled when the page is hidden, which is why
 * the polling loop uses one as well (see utils/backgroundTimer.ts).
 */
const SLEEP_SLICE_MS = 25;

let aiRawShare: Float32Array | null = null;
let aiPhysicalShare: Float32Array | null = null;
let aoShare: Float32Array | null = null;
let paramShare: Float32Array | null = null;
let interruptBuffer: Uint8Array | null = null;
let running = false;

const post = (message: ScriptWorkerResponse): void => {
  self.postMessage(message);
};

const readShare = (buffer: Float32Array | null, ch: number): number => {
  if (!buffer) return 0;
  if (!Number.isInteger(ch) || ch < 0 || ch >= buffer.length) return 0;
  return buffer[ch] ?? 0;
};

/**
 * Print output is batched and flushed once per slice.
 *
 * A `For I = 1 To 10000 / Print I / Next` posts 10000 messages otherwise, and
 * the structured clone of each one lands on the main thread — the same thread
 * that must not miss a Modbus deadline.
 */
let outputBuffer = '';

const flushOutput = (): void => {
  if (outputBuffer === '') return;
  post({ type: 'output', stream: 'stdout', text: outputBuffer });
  outputBuffer = '';
};

const host: BasicHost = {
  write: (text) => {
    outputBuffer += text;
  },
  // Sent on stderr and out of band of the buffered Print stream, so a notice
  // about a script that is about to sit still for 20 minutes is not itself
  // stuck behind the next flush.
  warn: (text) => {
    flushOutput();
    post({ type: 'output', stream: 'stderr', text: `${text}\n` });
  },
  getAiRaw: (ch) => readShare(aiRawShare, ch),
  getAiPhy: (ch) => readShare(aiPhysicalShare, ch),
  getAo: (ch) => readShare(aoShare, ch),
  getParam: (ch) => readShare(paramShare, ch),
  // Writes are messages: the Modbus transfer mutex and the minimum inter-frame
  // interval live on the main thread and must not be bypassed. Asynchronous, so
  // a GetAo() straight after a SetAo still reads the previous value until the
  // main thread has applied and mirrored it — the same as Python's set_ao.
  setAo: (ch, data) => post({ type: 'set_ao', ch, data }),
  setAiTare: (ch) => post({ type: 'set_ai_tare', ch }),
  notify: (message) => post({ type: 'notify', message }),
  // Parameters are worker-side state the main thread reads back out of the
  // share, so unlike AO they are written directly.
  setParam: (ch, data) => {
    if (!paramShare) return;
    if (!Number.isInteger(ch) || ch < 0 || ch >= paramShare.length) return;
    paramShare[ch] = data;
  },
  now: () => Date.now(),
};

const stopRequested = (): boolean => interruptBuffer !== null && interruptBuffer[0] !== INTERRUPT_NONE;

const delay = (ms: number): Promise<void> => new Promise((resolve) => { self.setTimeout(resolve, ms); });

/** Yield to the event loop so queued messages (including `interrupt`) run. */
const yieldToEventLoop = (): Promise<void> => delay(0);

/**
 * Sleep in interruptible slices. Returns false if Stop arrived while waiting,
 * which is the difference between `Sleep 3600` being a pause and being a hang.
 */
async function interruptibleSleep(totalMs: number): Promise<boolean> {
  const until = Date.now() + totalMs;
  for (;;) {
    if (stopRequested()) return false;
    const remaining = until - Date.now();
    if (remaining <= 0) return true;
    await delay(Math.min(remaining, SLEEP_SLICE_MS));
  }
}

async function runProgram(code: string): Promise<void> {
  const interpreter = BasicInterpreter.compile(code, host);

  for (;;) {
    if (stopRequested()) {
      flushOutput();
      post({ type: 'interrupted', message: 'Stopped' });
      return;
    }

    const outcome = interpreter.resume(Date.now() + SLICE_MS);
    flushOutput();

    if (outcome.kind === 'done') {
      post({ type: 'done', message: 'Completed' });
      return;
    }
    if (outcome.kind === 'sleep') {
      if (!(await interruptibleSleep(outcome.ms))) {
        flushOutput();
        post({ type: 'interrupted', message: 'Stopped' });
        return;
      }
      continue;
    }
    // Yielded on the deadline. Going through the event loop is what lets the
    // `interrupt` message and the posted output actually be delivered.
    await yieldToEventLoop();
  }
}

self.onmessage = async (event: MessageEvent<ScriptWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'init') {
    aiRawShare = new Float32Array(message.rawSab);
    aiPhysicalShare = new Float32Array(message.phySab);
    aoShare = new Float32Array(message.aoSab);
    paramShare = new Float32Array(message.paramSab);
    interruptBuffer = new Uint8Array(message.intSab);
    post({ type: 'status', message: 'Ready' });
    return;
  }

  if (message.type === 'interrupt') {
    // The main thread has already written to the interrupt buffer; the step
    // loop reads it directly and does not need this message. Handling it
    // matters only for the case where nothing is running: keep the request
    // armed so a run starting immediately afterwards aborts rather than
    // beginning with a stale Stop silently dropped.
    if (!running && interruptBuffer) interruptBuffer[0] = INTERRUPT_PENDING;
    return;
  }

  if (message.type === 'run') {
    if (running) {
      post({ type: 'error', message: 'Script is already running' });
      return;
    }
    if (stopRequested()) {
      // Stop was pressed before this run got going.
      if (interruptBuffer) interruptBuffer[0] = INTERRUPT_NONE;
      post({ type: 'interrupted', message: 'Stopped' });
      return;
    }

    running = true;
    outputBuffer = '';
    post({ type: 'status', message: 'Running' });
    try {
      await runProgram(message.code);
    } catch (err) {
      flushOutput();
      // Both carry the source line, which is the one thing a user needs and the
      // reason they are distinct types rather than plain Errors.
      if (err instanceof BasicSyntaxError || err instanceof BasicRuntimeError) {
        post({ type: 'error', message: err.message });
      } else {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      running = false;
      flushOutput();
      if (interruptBuffer) interruptBuffer[0] = INTERRUPT_NONE;
    }
  }
};
