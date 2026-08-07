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
  /**
   * Extension an exported tab is written with, and what the import picker
   * offers. Tab NAMES stay bare (see scriptTabs.ts) — this is only the file
   * that leaves the app, where the extension is what makes it openable.
   */
  fileExtension: string;
  /** `accept` for the import picker: extension plus the MIME types browsers use. */
  fileAccept: string;
  defaultScript: string;
  apiDocs: ScriptApiDoc[];
  /** First line of the "Copy for AI" prompt. */
  promptIntro: string;
  /** The rules a generated script is wrong without. */
  promptRules: string[];
  /** How a script should be shaped once it is correct. See RUNNER_GUIDELINES. */
  promptGuidelines: string[];
};

/**
 * Guidelines the RUNNER imposes, not the language.
 *
 * They are separate from `promptRules` because they are a different kind of
 * claim: a script that breaks a rule fails or freezes, while a script that
 * ignores a guideline works once and then bites on the second Start, on a
 * restart, or when someone needs to see what it did. They are separate from
 * the API list because none of them can be inferred from the call signatures —
 * that Param survives a run and module state must not be relied on, that a
 * Stop can land at any await, that Output shares a bounded log, are facts
 * about this app that an assistant has no way to guess.
 */
const RUNNER_GUIDELINES: string[] = [
  'Feedback control loops run at 0.2 s per iteration unless the task calls for something else.',
  'The script must survive Stop and a later Start: keep run state in Param (SetParam/GetParam), not in variables. Assign every variable the script reads at the top of the script — the namespace outlives a run, so an unassigned name can silently carry the previous run\'s value and then break after a reload.',
  'Multi-step sequences: one step per function, one loop per function, and a phase number in its own Param channel. Read that phase at startup and skip the steps already finished.',
  'Elapsed() restarts at 0 on every Start. For a deadline that survives a restart, keep the REMAINING seconds in Param and count down, instead of comparing with an absolute Elapsed() target.',
  'SetAo() and SetAiTare() are applied asynchronously: do not read back with GetAo() in the same iteration to confirm them.',
  'Clamp the AO command to 0-10 V, clamp the integral term of any PI loop, and start from the present GetAo() so a restart does not step the output.',
  'Define the channel numbers as named constants at the top with a comment table of what each AI / AO / Param channel is, and put the values the user is meant to tune in Param rather than in the code.',
  'Param is a scarce, visible resource, not a general-purpose variable store: only 16 channels, each shown live in the Parameter panel and logged to TSV every sample. Route a value through Param only when it must survive Stop/Start, the user tunes it, or it is worth watching in the log — keep everything else as an ordinary local/module variable.',
  'End with a checklist to complete BEFORE pressing Start: the Param channels to RENAME (the script gives them meanings their labels do not carry yet) and the Param values to SET in Param Editor. Both matter, because renaming happens in the Parameter grid (Param Editor only displays labels) and both are locked while a run is in progress: labels cannot be edited at all until the run ends (only SetParamLabel can change them), and a value not set beforehand takes an explicit "Accept Risk" to correct.',
  'print() sparingly: it shares a bounded System Log, so a line every iteration pushes everything else out. Print on state changes, and otherwise every Nth iteration, with Elapsed() in the line.',
  'State in a header comment what the outputs do when the script is stopped: AO channels hold their last value unless the script sets them.',
];

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
    name: 'SetParamLabel(ch, text)',
    desc: 'Set Param ch\'s free-text label. Shown in Parameter panel; persisted like a UI edit. Pass "" to clear it — there is no separate clear call. Applied async.',
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
  fileExtension: '.py',
  // text/plain is in the list because that is what Windows reports for .py on
  // machines with no Python installed, and a picker that greys out the file the
  // user is looking at is worse than one that shows a few extra.
  fileAccept: '.py,text/x-python,application/x-python-code,text/plain',
  apiDocs: [
    ...INSTRUMENT_API,
    { name: 'await asyncio.sleep(s)', desc: 'Non-blocking wait, in SECONDS. NEVER time.sleep().' },
  ],
  promptIntro: `Write a Python ${pythonVersion} script for ModbusSimpleLogger Script Runner (Pyodide; async context, top-level await OK).`,
  // Written so that breaking any one of them is a failure the author can see:
  // a frozen tab, a script that will not start, a NameError, or the rig
  // moving/reading the wrong way. Everything whose cost only shows up later
  // belongs in RUNNER_GUIDELINES instead.
  promptRules: [
    'Begin with `import asyncio`, and import nothing beyond `asyncio` and `math` — there is no network, so micropip / numpy / pandas cannot load.',
    'Wait only with `await asyncio.sleep(s)`. NEVER time.sleep(), a busy-wait loop, threading, or input(): they hold the runtime until they return, and Stop cannot get in.',
    'EVERY path through EVERY loop, nested loops included, must reach an `await asyncio.sleep(s)`. Put the sleep at the end of the loop body and never `continue` past it. Break long computations into chunks that await between them.',
    'Never sleep for less than 0.1 s: the readings only refresh once per Modbus poll, so a faster loop re-reads the same values.',
    'Repeat/feedback control only with a plain `while`/`for` loop awaiting asyncio.sleep(s) each iteration. No timers, callbacks or threads.',
    'The instrument API is PascalCase (GetAiPhy, SetAo), not snake_case.',
    'Before writing any code whose logic depends on the sign of an AI or AO channel, ask the user which direction is positive and which is negative for that channel on THIS rig (e.g. compression vs. expansion, push-in vs. pull-out) — never assume a polarity convention. A channel label alone does not say which sign is which.',
    'If a channel the script needs has no label below, or its identity is otherwise uncertain, do not guess: stop and get the user to add a label for it in the app and to calibrate it before writing the script — at minimum every AI and AO channel the script touches. Where possible, have them put the unit in the label itself (e.g. "Force (N)", "Stroke [mm]"), since the Phy value display carries no unit of its own. A script written against an unlabeled or uncalibrated channel can only be checked by running it on the rig.',
  ],
  // The runner's guidelines plus the one that is about Python itself: Stop is
  // delivered as an exception, so the usual defensive `except` around a control
  // loop is the thing that would keep it running.
  promptGuidelines: [
    ...RUNNER_GUIDELINES,
    'Do not swallow exceptions with a bare `except:` or `except BaseException:` — Stop arrives as an exception and would be caught with them.',
  ],
  // The rules a script cannot be written correctly without, and nothing else.
  // The call list used to be repeated here as five more comment lines, which is
  // the same text the panel's API Reference already holds — an editor that opens
  // mostly full of documentation buries the example it is there to show.
  //
  // The example carries no state of its own (Elapsed() rather than a counter it
  // has to accumulate) for the same reason the guidelines ask for: the script
  // someone edits into their own should already be one that a Stop and a Start
  // resume cleanly.
  defaultScript: `# Wait ONLY with \`await asyncio.sleep(s)\`, never below 0.1 s.
#   NEVER time.sleep() - it freezes the browser.
# Every loop needs one, on every path through it.
# Keep state in Param, so Stop -> Start resumes.
# Press Stop to halt at any time.

import asyncio
import math

while True:
    # example: slow sine wave on Parameter ch0
    SetParam(0, math.sin(Elapsed()))
    await asyncio.sleep(0.2)`,
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
    // Kept as a second heading rather than folded into the rules above: an
    // assistant handed one flat list treats a violated rule and a skipped
    // preference the same way, and the rules are the half that must not be
    // traded away for a shorter answer.
    'Design guidelines (follow unless the task rules them out):',
    ...language.promptGuidelines.map((line) => `- ${line}`),
    '',
    'Channel labels (JSON; index = ch, "" = unlabeled):',
    JSON.stringify(channelLabels),
    '',
    'Task: <your request here>',
  ].join('\n');
