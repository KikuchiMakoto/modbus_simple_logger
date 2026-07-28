// What the ScriptRunner needs to know about each language it can run.
//
// One table rather than conditionals scattered through the hook and the panel:
// the runner's job is identical in all three cases (hand a string to a worker,
// show what comes back), and the only real differences are the label, the
// default script, and how the same instrument API is spelled. Keeping those
// together is what makes adding a language a data change.
//
// The workers themselves are NOT here. `new Worker(new URL(...))` has to be a
// static literal for the bundler to find and emit the worker, so that switch
// lives in useScriptRunner.

export type ScriptLanguageId = 'python' | 'basic' | 'lua';

export type ScriptApiDoc = { name: string; desc: string };

export type ScriptLanguage = {
  id: ScriptLanguageId;
  /** Shown in the language selector. */
  label: string;
  /** Shown as the panel subtitle — which runtime is actually executing this. */
  runtime: string;
  /** Short runtime chip for the bottom status bar. */
  badge: string;
  /**
   * localStorage key for this language's editor contents. Each language keeps
   * its own: switching to look at the BASIC example must not throw away the
   * Python script someone has been editing.
   */
  storageKey: string;
  defaultScript: string;
  apiDocs: ScriptApiDoc[];
  /** First line of the "Copy for AI" prompt. */
  promptIntro: string;
  /** The rules a generated script is wrong without. */
  promptRules: string[];
};

// The instrument API is spelled the SAME in all three languages, so this table
// is shared. Only the wait call differs, and that one is written out per
// language because both its name and its units are genuinely different.
//
// BASIC calls the procedures without parentheses (`SetAo 0, 1.5`), which is what
// its own entries below show; the operations and the names are identical.
const INSTRUMENT_API: ScriptApiDoc[] = [
  { name: 'GetAiRaw(ch)', desc: 'Raw AI value. ch: 0-15.' },
  { name: 'GetAiPhy(ch)', desc: 'Calibrated AI value. ch: 0-15.' },
  {
    name: 'SetAiTare(ch)',
    desc: 'Tare AI ch: set offset c so the current phy reads 0 (a, b kept). Applied async.',
  },
  { name: 'GetAo(ch)', desc: 'AO voltage [V]. ch: 0-7.' },
  {
    name: 'SetAo(ch, vlt)',
    desc: 'Set AO voltage [V], clamped to 0-10. Applied async; GetAo() updates slightly later.',
  },
  { name: 'GetParam(ch)', desc: 'Scratch value. ch: 0-15. Starts at 0.' },
  {
    name: 'SetParam(ch, val)',
    desc: 'Set scratch value. Shown in Parameter panel, logged to TSV. Not persisted.',
  },
  {
    name: 'SetNotify(msg)',
    desc: 'Raise an OS notification (needs Notifications on in the menu). Always written to Output.',
  },
  { name: 'Elapsed()', desc: 'Seconds since the script started. Monotonic - no midnight rollover.' },
];

const PYTHON: ScriptLanguage = {
  id: 'python',
  label: 'Python',
  runtime: 'Python (Pyodide)',
  // The pin in package.json is the single source of truth for the version;
  // vite.config.ts injects it. AppInfoPanel reads the same variable.
  badge: `Pyodide ${import.meta.env.VITE_PYODIDE_VERSION ?? ''}`.trim(),
  storageKey: 'scriptRunnerCode',
  apiDocs: [
    ...INSTRUMENT_API,
    { name: 'await asyncio.sleep(s)', desc: 'Non-blocking wait, in SECONDS. NEVER time.sleep().' },
  ],
  promptIntro:
    'Write a Python script for ModbusSimpleLogger Script Runner (Pyodide; async context, top-level await OK).',
  promptRules: [
    'Wait only with `await asyncio.sleep(s)`. NEVER time.sleep().',
    'Repeat/feedback control only with a plain `while`/`for` loop awaiting asyncio.sleep(s) each iteration. No timers, callbacks or threads.',
    'The instrument API is PascalCase (GetAiPhy, SetAo), NOT snake_case. The same names work in all three languages this app runs.',
  ],
  // The two rules a script cannot be written correctly without, and nothing
  // else. The call list used to be repeated here as five more comment lines,
  // which is the same text the panel's API Reference already holds — an editor
  // that opens mostly full of documentation buries the example it is there to
  // show.
  defaultScript: `# Wait ONLY with \`await asyncio.sleep(s)\`
#   NEVER time.sleep() - it freezes the browser.
# Loop with a plain while/for. Press Stop to halt at any time.

import asyncio
import math

t = 0.0
while True:
    # example: slow sine wave on Parameter ch0
    SetParam(0, math.sin(t))
    t += 0.1
    await asyncio.sleep(1)`,
};

const BASIC: ScriptLanguage = {
  id: 'basic',
  label: 'BASIC',
  runtime: 'BASIC (VB6 dialect)',
  badge: 'VB6 dialect',
  storageKey: 'scriptRunnerCodeBasic',
  apiDocs: [
    { name: 'GetAiRaw(ch)', desc: 'Raw AI value. ch: 0-15.' },
    { name: 'GetAiPhy(ch)', desc: 'Calibrated AI value. ch: 0-15.' },
    {
      name: 'SetAiTare ch',
      desc: 'Tare AI ch: set offset c so the current phy reads 0 (a, b kept). Applied async.',
    },
    { name: 'GetAo(ch)', desc: 'AO voltage [V]. ch: 0-7.' },
    {
      name: 'SetAo ch, v',
      desc: 'Set AO voltage [V], clamped to 0-10. Applied async; GetAo() updates slightly later.',
    },
    { name: 'GetParam(ch)', desc: 'Scratch value. ch: 0-15. Starts at 0.' },
    {
      name: 'SetParam ch, v',
      desc: 'Set scratch value. Shown in Parameter panel, logged to TSV. Not persisted.',
    },
    {
      name: 'SetNotify msg',
      desc: 'Raise an OS notification (needs Notifications on in the menu). Always written to Output.',
    },
    { name: 'Elapsed', desc: 'Seconds since the script started. Monotonic - no midnight rollover.' },
    { name: 'Sleep s', desc: 'Wait, in SECONDS (fractions OK). Sleep 0.1 is 100 ms.' },
    { name: 'Timer', desc: 'Seconds since midnight, as in VB6 - rolls over at 00:00. Use Elapsed for durations.' },
    { name: 'Print x; y', desc: 'Write to Output. `;` keeps the line open, `,` moves to the next 14-column zone.' },
    { name: 'Round / Log10 / Asin / Deg', desc: 'Round is banker’s (VB6 and JIS Z 8401 rule A). Log10, Asin/Acos and Deg/Rad are additions.' },
  ],
  promptIntro:
    'Write a BASIC script for ModbusSimpleLogger Script Runner. The dialect is VB6, and also accepts N88/QBasic habits (optional line numbers, optional type sigils) and a few VB.NET spellings (End While, AndAlso/OrElse, +=).',
  promptRules: [
    'Wait with `Sleep s` — SECONDS, so `Sleep 0.1` is 100 ms. The same unit in all three languages.',
    'Loop with For/Next, While/Wend or Do/Loop. Stop works at any point; no DoEvents is needed.',
    'True is -1 and And/Or/Not are BITWISE, as in VB6. Use AndAlso/OrElse when you need short-circuit evaluation.',
    'Mod and \\ are integer operators: 7.5 Mod 2 is 1, not 1.5.',
    'There is no Sub or Function; use GoSub/Return.',
    'Procedures are called without parentheses (`SetAo 0, 1.5`); functions with them (`GetAiPhy(0)`).',
  ],
  defaultScript: `' Sleep is in SECONDS: Sleep 0.1 waits 100 ms.
' Loop with For/Next, While/Wend or Do/Loop.
' Press Stop to halt at any time - no DoEvents needed.

Const StepSize = 0.1

T = 0
Do
    ' example: slow sine wave on Parameter ch0
    SetParam 0, Sin(T)
    T += StepSize
    Sleep 1
Loop`,
};

const LUA: ScriptLanguage = {
  id: 'lua',
  label: 'Lua',
  runtime: 'Lua 5.4 (wasmoon)',
  badge: 'wasmoon',
  storageKey: 'scriptRunnerCodeLua',
  apiDocs: [
    ...INSTRUMENT_API,
    {
      name: 'sleep(s)',
      desc: 'Wait, in SECONDS (fractions OK), as in LuaSocket. sleep(0.5) is 500 ms.',
    },
    { name: 'print(...)', desc: 'Write to the Output pane.' },
  ],
  promptIntro:
    'Write a Lua 5.4 script for ModbusSimpleLogger Script Runner (wasmoon). The standard library is available except io/os file access.',
  promptRules: [
    'Wait with `sleep(s)` — SECONDS, so `sleep(0.5)` is 500 ms.',
    'Loop with while/for. Stop works at any point, including inside a loop with no sleep.',
    'print() goes to the Output pane.',
    'The instrument API is PascalCase (GetAiPhy, SetAo), NOT snake_case. The same names work in all three languages this app runs.',
  ],
  defaultScript: `-- sleep() is in SECONDS: sleep(1) waits one second.
-- Loop with while/for. Press Stop to halt at any time.

local t = 0.0

while true do
  -- example: slow sine wave on Parameter ch0
  SetParam(0, math.sin(t))
  t = t + 0.1
  sleep(1)
end`,
};

export const SCRIPT_LANGUAGES: Record<ScriptLanguageId, ScriptLanguage> = {
  python: PYTHON,
  basic: BASIC,
  lua: LUA,
};

export const SCRIPT_LANGUAGE_LIST: ScriptLanguage[] = [PYTHON, BASIC, LUA];

export const DEFAULT_SCRIPT_LANGUAGE: ScriptLanguageId = 'python';

export const isScriptLanguageId = (value: unknown): value is ScriptLanguageId =>
  value === 'python' || value === 'basic' || value === 'lua';

/**
 * The API reference, rendered as a prompt someone can paste into an assistant.
 *
 * Channel labels go in because the useful requests are about a specific rig
 * ("hold CH02 at 5 kN"), and without the labels the answer can only be about
 * channel numbers.
 */
export const buildAiPrompt = (
  language: ScriptLanguage,
  channelLabels: { ai: string[]; ao: string[]; param: string[] },
): string =>
  [
    language.promptIntro,
    '',
    'API:',
    ...language.apiDocs.map((api) => `- ${api.name}: ${api.desc}`),
    '',
    'Absolute rules:',
    ...language.promptRules.map((rule) => `- ${rule}`),
    '',
    'Channel labels (JSON; index = ch, "" = unlabeled):',
    JSON.stringify(channelLabels),
    '',
    'Task: <your request here>',
  ].join('\n');
