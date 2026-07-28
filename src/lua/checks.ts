// Behaviour checks for the Lua runtime scaffolding. Run with `bun run lua:check`.
//
// These exist because everything interesting about the Lua worker is an
// assumption about wasmoon's marshalling that is invisible until it runs: that
// `global.get` hands back a callable, that a Lua table comes back as a plain JS
// object, that `debug.sethook` can call an injected JS function, and that an
// error raised inside a hook propagates out of `coroutine.resume` as a failed
// resume rather than tearing down the state.
//
// Same driver loop as luaWorker.ts, minus the Worker plumbing.
import { LuaFactory, type LuaEngine } from 'wasmoon';
import { INTERRUPT_MARKER, RUNNER_SETUP } from './scaffolding';

type Outcome = { kind: 'done' | 'stopped' | 'error'; output: string; error?: string };

let failures = 0;
let checks = 0;

const check = (name: string, ok: boolean, detail = '') => {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}${detail ? `\n  ${detail}` : ''}`);
  }
};

async function makeEngine(): Promise<{
  engine: LuaEngine;
  output: () => string;
  stop: (value: boolean) => void;
  calls: string[];
}> {
  const engine = await new LuaFactory().createEngine({ openStandardLibs: true });
  let buffer = '';
  let stopFlag = false;
  const calls: string[] = [];

  engine.global.set('__msl_write', (text: string) => {
    buffer += String(text);
  });
  engine.global.set('__msl_should_stop', () => stopFlag);
  // PascalCase, matching luaWorker's real registration.
  engine.global.set('GetAiPhy', (ch: number) => Number(ch) * 1.5);
  engine.global.set('SetParam', (ch: number, v: number) => calls.push(`SetParam ${ch} ${v}`));
  engine.global.set('SetAo', (ch: number, v: number) => calls.push(`SetAo ${ch} ${v}`));
  engine.global.set('Elapsed', () => 0);
  engine.doStringSync(RUNNER_SETUP);

  return { engine, output: () => buffer, stop: (v: boolean) => { stopFlag = v; }, calls };
}

/**
 * Drive a script the way luaWorker does. `stopAfterSteps` simulates a Stop
 * arriving mid-run.
 */
async function run(
  source: string,
  options: { stopAfterSteps?: number; maxSteps?: number } = {},
): Promise<Outcome & { sleeps: number[]; calls: string[] }> {
  const { engine, output, stop, calls } = await makeEngine();
  const sleeps: number[] = [];
  const maxSteps = options.maxSteps ?? 200;

  try {
    engine.global.set('__msl_source', source);
    const compileError = engine.doStringSync('return __msl_start(__msl_source)');
    if (typeof compileError === 'string') {
      return { kind: 'error', output: output(), error: compileError, sleeps, calls };
    }

    for (let i = 0; i < maxSteps; i += 1) {
      if (options.stopAfterSteps !== undefined && i >= options.stopAfterSteps) stop(true);
      const result = engine.doStringSync('return __msl_step()') as {
        ok: boolean;
        value: unknown;
        dead: boolean;
      };
      if (!result.ok) {
        const text = String(result.value);
        const kind = text.includes(INTERRUPT_MARKER) ? 'stopped' : 'error';
        return { kind, output: output(), error: text, sleeps, calls };
      }
      if (result.dead) return { kind: 'done', output: output(), sleeps, calls };
      sleeps.push(Number(result.value) || 0);
      // A Stop during the wait is checked here, exactly as the worker does.
      if (options.stopAfterSteps !== undefined && i >= options.stopAfterSteps) {
        return { kind: 'stopped', output: output(), sleeps, calls };
      }
    }
    return { kind: 'error', output: output(), error: 'did not terminate', sleeps, calls };
  } catch (err) {
    return { kind: 'error', output: output(), error: (err as Error).message, sleeps, calls };
  } finally {
    engine.global.close();
  }
}

// --- the marshalling assumptions -------------------------------------------
{
  const r = await run('print("hello", 42)');
  check('print reaches the output pane', r.kind === 'done' && r.output === 'hello\t42\n',
    `kind=${r.kind} output=${JSON.stringify(r.output)} err=${r.error ?? ''}`);
}
{
  const r = await run('print(1 + 1)');
  check('numbers stringify without .0', r.output === '2\n', JSON.stringify(r.output));
}
{
  const r = await run('print(GetAiPhy(2))');
  check('injected JS function is callable from Lua', r.output === '3.0\n' || r.output === '3\n',
    JSON.stringify(r.output));
}
{
  const r = await run('SetParam(0, 1.25) SetAo(1, 5)');
  check('side-effect calls arrive with both arguments',
    r.calls.join('|') === 'SetParam 0 1.25|SetAo 1 5', r.calls.join('|'));
}
{
  const r = await run('local t = math.sin(0) print(t)');
  check('standard library is open', r.kind === 'done' && r.output === '0.0\n',
    `${r.kind} ${JSON.stringify(r.output)} ${r.error ?? ''}`);
}

// --- sleep as a coroutine yield --------------------------------------------
{
  const r = await run('print("a") sleep(0.25) print("b")');
  check('sleep yields its duration and the script continues',
    r.kind === 'done' && r.output === 'a\nb\n' && r.sleeps.length === 1 && r.sleeps[0] === 0.25,
    `kind=${r.kind} output=${JSON.stringify(r.output)} sleeps=${JSON.stringify(r.sleeps)}`);
}
{
  const r = await run('for i = 1, 3 do print(i) sleep(0.1) end');
  check('a loop yields once per iteration',
    r.kind === 'done' && r.sleeps.length === 3 && r.output === '1\n2\n3\n',
    `sleeps=${JSON.stringify(r.sleeps)} output=${JSON.stringify(r.output)}`);
}

// --- Stop ------------------------------------------------------------------
{
  // The case the count hook exists for: no sleep, so the coroutine never yields.
  const r = await run('while true do end', { stopAfterSteps: 0, maxSteps: 5 });
  check('the count hook kills a loop that never yields', r.kind === 'stopped',
    `kind=${r.kind} err=${r.error ?? ''}`);
}
{
  const r = await run('local n = 0 while true do n = n + 1 end', { stopAfterSteps: 0, maxSteps: 5 });
  check('the hook kills a busy counting loop', r.kind === 'stopped',
    `kind=${r.kind} err=${r.error ?? ''}`);
}
{
  const r = await run('while true do sleep(0.01) end', { stopAfterSteps: 2, maxSteps: 20 });
  check('Stop lands during a sleeping loop', r.kind === 'stopped',
    `kind=${r.kind} err=${r.error ?? ''}`);
}
{
  // Stop must not look like a script failure to the user.
  const r = await run('while true do end', { stopAfterSteps: 0, maxSteps: 5 });
  check('a stop is not reported as an error', r.error?.includes(INTERRUPT_MARKER) === true,
    r.error ?? '(no error)');
}

// --- errors -----------------------------------------------------------------
{
  const r = await run('this is not lua');
  check('a syntax error is reported', r.kind === 'error' && (r.error ?? '').length > 0, r.error ?? '');
}
{
  const r = await run('error("boom")');
  check('a runtime error carries its message', r.kind === 'error' && (r.error ?? '').includes('boom'),
    r.error ?? '');
}
{
  const r = await run('print("before") error("boom")');
  check('output before a failure is kept', r.output === 'before\n', JSON.stringify(r.output));
}

console.log(`${checks - failures}/${checks} passed`);
if (failures > 0) {
  (globalThis as { process?: { exit(code: number): void } }).process?.exit(1);
}
