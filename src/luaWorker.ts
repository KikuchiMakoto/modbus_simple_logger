// Lua runtime worker (wasmoon = Lua 5.4 compiled to WASM, ~300 kB).
//
// Same message contract as pyodideWorker and basicWorker — see
// utils/scriptWorkerProtocol.ts.
//
// Two mechanisms carry the whole design, because Lua runs synchronously and
// wasmoon gives us no way to pause it from outside:
//
//  1. The user's script runs inside a COROUTINE. `sleep(s)` is
//     `coroutine.yield(s)`, so waiting returns control to this file, which sets
//     a JS timer and resumes afterwards. Nothing blocks, and the wait is
//     interruptible because we simply never resume. This mirrors the BASIC
//     worker's step loop; it is the same shape reached by a different route.
//
//  2. A COUNT HOOK (`debug.sethook(fn, '', N)`) runs every N VM instructions
//     and raises an error when Stop has been pressed. That is what kills
//     `while true do end` — a loop with no sleep never yields, so the coroutine
//     alone cannot stop it.
import { LuaFactory, type LuaEngine } from 'wasmoon';
import {
  INTERRUPT_NONE,
  INTERRUPT_PENDING,
  type ScriptWorkerRequest,
  type ScriptWorkerResponse,
} from './utils/scriptWorkerProtocol';

/**
 * VM instructions between hook calls.
 *
 * Small enough that Stop lands within a millisecond or so of a tight loop, large
 * enough that the hook is not a measurable tax on a script doing real work.
 */
const HOOK_INSTRUCTION_COUNT = 5000;

/** Long sleeps are served in slices so Stop does not have to wait them out. */
const SLEEP_SLICE_MS = 25;

/** Marker error raised by the hook. Matched to report a Stop, not a failure. */
const INTERRUPT_MARKER = '__msl_interrupt__';

let engine: LuaEngine | null = null;
let initPromise: Promise<void> | null = null;
let initArgs: Extract<ScriptWorkerRequest, { type: 'init' }> | null = null;
let running = false;

let aiRawShare: Float32Array | null = null;
let aiPhysicalShare: Float32Array | null = null;
let aoShare: Float32Array | null = null;
let paramShare: Float32Array | null = null;
let interruptBuffer: Uint8Array | null = null;

let startedAt = 0;
let outputBuffer = '';

const post = (message: ScriptWorkerResponse): void => {
  self.postMessage(message);
};

const readShare = (buffer: Float32Array | null, ch: number): number => {
  if (!buffer) return 0;
  const index = Number(ch);
  if (!Number.isInteger(index) || index < 0 || index >= buffer.length) return 0;
  return buffer[index] ?? 0;
};

// Batched for the same reason as the BASIC worker: a loop printing every
// iteration would otherwise structured-clone one message per line onto the
// thread that must not miss a Modbus deadline.
const flushOutput = (): void => {
  if (outputBuffer === '') return;
  post({ type: 'output', stream: 'stdout', text: outputBuffer });
  outputBuffer = '';
};

const stopRequested = (): boolean =>
  interruptBuffer !== null && interruptBuffer[0] !== INTERRUPT_NONE;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    self.setTimeout(resolve, ms);
  });

/** Sleep in slices, abandoning the wait as soon as Stop arrives. */
async function interruptibleSleep(totalMs: number): Promise<boolean> {
  const until = Date.now() + totalMs;
  for (;;) {
    if (stopRequested()) return false;
    const remaining = until - Date.now();
    if (remaining <= 0) return true;
    await delay(Math.min(remaining, SLEEP_SLICE_MS));
  }
}

/**
 * Lua-side scaffolding.
 *
 * `sleep` yields rather than blocking, and the hook is armed here rather than
 * in JS because `debug.sethook` wants a Lua function. `__msl_should_stop` is
 * injected from JS and reads the shared interrupt byte.
 */
const RUNNER_SETUP = `
function sleep(seconds)
  coroutine.yield(tonumber(seconds) or 0)
end

-- Everything print() would send to stdout goes to the Output pane instead; a
-- worker's console is not visible in the page's devtools.
function print(...)
  local parts = {}
  for i = 1, select('#', ...) do
    parts[i] = tostring((select(i, ...)))
  end
  __msl_write(table.concat(parts, '\\t') .. '\\n')
end

function __msl_make(source)
  local chunk, err = load(source, 'script', 't')
  if not chunk then error(err, 0) end
  return coroutine.create(function()
    debug.sethook(function()
      if __msl_should_stop() then error('${INTERRUPT_MARKER}', 0) end
    end, '', ${HOOK_INSTRUCTION_COUNT})
    chunk()
  end)
end

-- Returns a table, not three values: how wasmoon marshals multiple Lua returns
-- is version-dependent, and a table comes back as a plain JS object either way.
function __msl_step(co)
  local ok, value = coroutine.resume(co)
  return {
    ok = ok,
    value = value,
    dead = coroutine.status(co) == 'dead',
  }
end
`;

async function initialize(args: Extract<ScriptWorkerRequest, { type: 'init' }>): Promise<void> {
  post({ type: 'status', message: 'Initializing Lua...' });

  aiRawShare = new Float32Array(args.rawSab);
  aiPhysicalShare = new Float32Array(args.phySab);
  aoShare = new Float32Array(args.aoSab);
  paramShare = new Float32Array(args.paramSab);
  interruptBuffer = new Uint8Array(args.intSab);

  // The WASM binary is bundled and served from our own origin, so this stays
  // offline-capable like the rest of the app.
  engine = await new LuaFactory().createEngine({ injectObjects: false, openStandardLibs: true });

  engine.global.set('__msl_write', (text: string) => {
    outputBuffer += String(text);
  });
  engine.global.set('__msl_should_stop', () => stopRequested());

  engine.global.set('get_ai_raw', (ch: number) => readShare(aiRawShare, ch));
  engine.global.set('get_ai_phy', (ch: number) => readShare(aiPhysicalShare, ch));
  engine.global.set('get_ao', (ch: number) => readShare(aoShare, ch));
  engine.global.set('get_param', (ch: number) => readShare(paramShare, ch));
  // Writes go through the main thread: the Modbus transfer mutex and the
  // minimum inter-frame interval live there and must not be bypassed.
  engine.global.set('set_ao', (ch: number, data: number) => {
    post({ type: 'set_ao', ch: Number(ch), data: Number(data) });
  });
  engine.global.set('set_ai_tare', (ch: number) => {
    post({ type: 'set_ai_tare', ch: Number(ch) });
  });
  engine.global.set('set_notify', (message: unknown) => {
    post({ type: 'notify', message: String(message) });
  });
  engine.global.set('set_param', (ch: number, data: number) => {
    if (!paramShare) return;
    const index = Number(ch);
    if (!Number.isInteger(index) || index < 0 || index >= paramShare.length) return;
    paramShare[index] = Number(data);
  });
  engine.global.set('elapsed', () => (Date.now() - startedAt) / 1000);

  engine.doStringSync(RUNNER_SETUP);
  post({ type: 'status', message: 'Ready' });
}

const isInterrupt = (text: string): boolean => text.includes(INTERRUPT_MARKER);

async function runProgram(code: string): Promise<void> {
  if (!engine) throw new Error('Lua is not available');
  startedAt = Date.now();

  const make = engine.global.get('__msl_make') as (source: string) => unknown;
  const step = engine.global.get('__msl_step') as (
    co: unknown,
  ) => { ok: boolean; value: unknown; dead: boolean };

  // A compile error surfaces here, before anything has run.
  const coroutine = make(code);

  for (;;) {
    if (stopRequested()) {
      flushOutput();
      post({ type: 'interrupted', message: 'Stopped' });
      return;
    }

    const { ok, value, dead } = step(coroutine);
    flushOutput();

    if (!ok) {
      const text = String(value);
      if (isInterrupt(text)) {
        post({ type: 'interrupted', message: 'Stopped' });
        return;
      }
      throw new Error(text);
    }
    if (dead) {
      post({ type: 'done', message: 'Completed' });
      return;
    }

    // Yielded: `value` is the requested sleep in seconds.
    const seconds = typeof value === 'number' ? value : Number(value) || 0;
    if (!(await interruptibleSleep(Math.max(0, seconds * 1000)))) {
      flushOutput();
      post({ type: 'interrupted', message: 'Stopped' });
      return;
    }
  }
}

self.onmessage = async (event: MessageEvent<ScriptWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'init') {
    initArgs = message;
    if (!initPromise) initPromise = initialize(message);
    try {
      await initPromise;
    } catch (err) {
      // Cleared so the next run retries: the main thread sends `init` only
      // once, when it creates the worker.
      initPromise = null;
      post({ type: 'error', message: (err as Error).message });
    }
    return;
  }

  if (message.type === 'interrupt') {
    // The hook and the sleep loop both read the shared byte directly, so this
    // message matters only when nothing is running: keep the request armed so a
    // run starting immediately afterwards aborts rather than losing the Stop.
    if (!running && interruptBuffer) interruptBuffer[0] = INTERRUPT_PENDING;
    return;
  }

  if (message.type === 'run') {
    if (running) {
      post({ type: 'error', message: 'Script is already running' });
      return;
    }
    if (!initPromise) {
      if (!initArgs) {
        post({ type: 'error', message: 'Worker is not initialized' });
        return;
      }
      initPromise = initialize(initArgs);
    }

    running = true;
    outputBuffer = '';
    try {
      await initPromise;
      if (stopRequested()) {
        // Stop was pressed while wasmoon was still loading.
        post({ type: 'interrupted', message: 'Stopped' });
        return;
      }
      post({ type: 'status', message: 'Running' });
      await runProgram(message.code);
    } catch (err) {
      flushOutput();
      if (!engine) initPromise = null;
      const text = err instanceof Error ? err.message : String(err);
      if (isInterrupt(text)) post({ type: 'interrupted', message: 'Stopped' });
      else post({ type: 'error', message: text });
    } finally {
      running = false;
      flushOutput();
      if (interruptBuffer) interruptBuffer[0] = INTERRUPT_NONE;
    }
  }
};
