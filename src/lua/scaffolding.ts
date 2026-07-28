// Lua-side scaffolding, kept out of luaWorker.ts so it can be exercised without
// a Worker. The worker file installs `self.onmessage` at module scope, which
// cannot be imported from a plain script; these are the parts worth checking
// (see checks.ts).
/**
 * VM instructions between hook calls.
 *
 * Small enough that Stop lands within a millisecond or so of a tight loop, large
 * enough that the hook is not a measurable tax on a script doing real work.
 */
export const HOOK_INSTRUCTION_COUNT = 5000;

/** Marker error raised by the hook. Matched to report a Stop, not a failure. */
export const INTERRUPT_MARKER = '__msl_interrupt__';

/**
 * Lua-side scaffolding.
 *
 * `sleep` yields rather than blocking, and the hook is armed here rather than
 * in JS because `debug.sethook` wants a Lua function. `__msl_should_stop` is
 * injected from JS and reads the shared interrupt byte.
 */
/**
 * Lua-side scaffolding.
 *
 * `sleep` yields rather than blocking, and the hook is armed inside the
 * coroutine because `debug.sethook` wants a Lua function and hooks are
 * per-coroutine in 5.4. `__msl_should_stop` is injected from JS and reads the
 * shared interrupt byte.
 *
 * The coroutine NEVER leaves Lua. An earlier version created it in Lua, handed
 * the thread to JS and passed it back on each step; wasmoon cannot round-trip a
 * thread, and the result was WASM-level "call_indirect signature mismatch" and
 * a chunk upvalue that had become nil — i.e. the runtime falling over rather
 * than reporting anything useful. Only strings and plain tables cross the
 * boundary now.
 */
export const RUNNER_SETUP = `
local co = nil

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

-- Returns a compile-error string, or nil when the chunk is ready to step.
function __msl_start(source)
  local chunk, err = load(source, 'script', 't')
  if not chunk then return tostring(err) end
  co = coroutine.create(function()
    debug.sethook(function()
      if __msl_should_stop() then error('${INTERRUPT_MARKER}', 0) end
    end, '', ${HOOK_INSTRUCTION_COUNT})
    chunk()
  end)
  return nil
end

-- A table, not multiple returns: how wasmoon marshals several Lua values is
-- version-dependent, and a table arrives as a plain JS object either way.
function __msl_step()
  local ok, value = coroutine.resume(co)
  return {
    ok = ok,
    value = value,
    dead = coroutine.status(co) == 'dead',
  }
end
`;
