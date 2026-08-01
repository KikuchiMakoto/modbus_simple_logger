// What the ScriptRunner needs to know about the language it runs.
//
// This used to be a table of three languages (Python/BASIC/Lua) so the
// runner's hook and panel could stay data-driven rather than branching on
// which one was selected. BASIC and Lua are gone now; the table shape stays
// because scriptTabs.ts and useScriptRunner.ts key persistence and worker
// lifetime off `ScriptLanguageId`, and a one-entry Record is simpler to keep
// than to unwind.

export type ScriptLanguageId = 'python';

export type ScriptApiDoc = { name: string; desc: string };

// Which Python the Pyodide build actually runs, derived from the pinned package
// version rather than written out twice: pyodide's version tracks the CPython it
// ships (314.0.3 -> Python 3.14), so the pin in package.json stays the single
// source of truth the same way it already is for the badge.
const pyodideVersion = (import.meta.env.VITE_PYODIDE_VERSION ?? '').trim();
const pythonVersion = ((): string => {
  const major = /^(\d)(\d{2})\./.exec(pyodideVersion);
  return major ? `${major[1]}.${Number(major[2])}` : '3';
})();

export type ScriptLanguage = {
  id: ScriptLanguageId;
  /** Shown in the panel subtitle. */
  label: string;
  /**
   * Shown as the panel subtitle — which language version is actually executing
   * this, and on what. "Python" alone left the one question a script author
   * asks first (which dialect am I writing?) to be answered by trying it.
   */
  runtime: string;
  /** Short runtime chip for the bottom status bar. */
  badge: string;
  /** localStorage key for this language's editor contents. */
  storageKey: string;
  defaultScript: string;
  apiDocs: ScriptApiDoc[];
  /** First line of the "Copy for AI" prompt. */
  promptIntro: string;
  /** The rules a generated script is wrong without. */
  promptRules: string[];
};

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
  { name: 'Elapsed()', desc: 'Seconds since the script started. Monotonic - no midnight rollover.' },
];

const PYTHON: ScriptLanguage = {
  id: 'python',
  label: 'Python',
  runtime: `Python ${pythonVersion} (Pyodide)`,
  // The pin in package.json is the single source of truth for the version;
  // vite.config.ts injects it. AppInfoPanel reads the same variable.
  badge: `Pyodide ${import.meta.env.VITE_PYODIDE_VERSION ?? ''}`.trim(),
  storageKey: 'scriptRunnerCode',
  apiDocs: [
    ...INSTRUMENT_API,
    { name: 'await asyncio.sleep(s)', desc: 'Non-blocking wait, in SECONDS. NEVER time.sleep().' },
  ],
  promptIntro: `Write a Python ${pythonVersion} script for ModbusSimpleLogger Script Runner (Pyodide; async context, top-level await OK).`,
  promptRules: [
    'Wait only with `await asyncio.sleep(s)`. NEVER time.sleep().',
    'Repeat/feedback control only with a plain `while`/`for` loop awaiting asyncio.sleep(s) each iteration. No timers, callbacks or threads.',
    'The instrument API is PascalCase (GetAiPhy, SetAo), not snake_case.',
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

export const SCRIPT_LANGUAGES: Record<ScriptLanguageId, ScriptLanguage> = {
  python: PYTHON,
};

export const SCRIPT_LANGUAGE_LIST: ScriptLanguage[] = [PYTHON];

export const DEFAULT_SCRIPT_LANGUAGE: ScriptLanguageId = 'python';

export const isScriptLanguageId = (value: unknown): value is ScriptLanguageId => value === 'python';

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
