// What the ScriptRunner needs to know about the language it runs.
//
// This used to be a table of three languages (Python/BASIC/Lua) so the
// runner's hook and panel could stay data-driven rather than branching on
// which one was selected. BASIC and Lua are gone now; the table shape stays
// because scriptTabs.ts and useScriptRunner.ts key persistence and worker
// lifetime off `ScriptLanguageId`, and a one-entry Record is simpler to keep
// than to unwind.

export type ScriptLanguageId = 'python';

export type ScriptApiDoc = {
  name: string;
  /**
   * The panel's one-liner. Kept short enough to sit on ONE line next to the
   * name chip at the window's default width, because the reference is read by
   * scanning down the left column for a call: a description that wraps to
   * three lines pushes the next name off the screen and makes the list look
   * like prose instead of a table. Long entries next to two-word ones read as
   * if the long ones matter more, which is not what the length was measuring.
   */
  desc: string;
  /**
   * What the AI prompt says instead, where the call has a trap that costs more
   * to hit than the panel has room to explain (float32 rounding, mainly). The
   * panel is read by someone who can try the call and see; the prompt is read
   * once by something that cannot.
   */
  promptDesc?: string;
};

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
  'Motor and EP (electro-pneumatic) control especially: wrap the raw AO writes in named helper functions and drive the rig ONLY through them — SetMotorUp() / SetMotorDown() / SetMotorOn() / SetMotorOff() / SetMotorSpeed(mm_per_min) / SetEpKpa(kpa) and the like, in the same PascalCase as the instrument API so they read as calls to the machine. Each helper is where the channel number, the polarity, the calibration constant that turns a physical unit into volts, and the clamp all live, decided once instead of restated at every call site. The body then says what the TEST does (SetMotorSpeed(50)) rather than what the DAC does (SetAo(2, 3.7)) — the difference between a script the user can check against their test plan and one they can only check by running it on the rig.',
  'Param is a scarce, visible resource, not a general-purpose variable store: only 16 channels, each shown live in the Parameter panel and logged to TSV every sample. Route a value through Param only when it must survive Stop/Start, the user tunes it, or it is worth watching in the log — keep everything else as an ordinary local/module variable.',
  'End with a checklist to complete BEFORE pressing Start: the Param channels to RENAME (the script gives them meanings their labels do not carry yet) and the Param values to SET in Param Editor. Both matter, because renaming happens in the Parameter grid (Param Editor only displays labels) and both are locked while a run is in progress: labels cannot be edited at all until the run ends (only SetParamLabel can change them), and a value not set beforehand takes an explicit "Accept Risk" to correct.',
  'print() sparingly: it shares a bounded System Log, so a line every iteration pushes everything else out. Print on state changes, and otherwise every Nth iteration, with Elapsed() in the line. The log is also the only path a result takes back to you — the user copies it out of the System Log window — so print anything you will need to read later in a stable, parseable shape, and keep the loop quiet enough that a long run cannot push those lines off the top.',
  'State in a header comment what the outputs do when the script is stopped: AO channels hold their last value unless the script sets them.',
];

/**
 * What has to exist on the rig BEFORE the requested test script is worth
 * writing, by what the actuator is and what is being controlled.
 *
 * Separate from both the rules and the guidelines because it is not about the
 * script at all: a control script is a function from a command to a physical
 * outcome, and every one of those functions has constants in it — V per mm/min,
 * V per kPa, V per N, a loop gain — that only a measurement on THIS rig can
 * supply. An assistant handed "hold 5 kN" with no such constants will invent
 * plausible ones, and the first place the invention shows up is the specimen.
 * So the order is always: find out what is calibrated, produce the missing
 * calibration script first, then write the test against the numbers it gave.
 *
 * The dummy-specimen requirement is the same argument one step further: a
 * force or pressure loop cannot be tuned without driving the loop past where
 * it is stable, and that has to happen against something the user is willing
 * to break.
 *
 * The plan-first opening is here rather than at the top of the prompt because
 * it is the same argument again: what an assistant most wants to skip is the
 * interrogation, and on a rig the questions it skips are the ones whose wrong
 * answer costs a specimen or a load cell. Planning mode is asked for by name
 * because it is the one mode where a wrong assumption is still only text.
 *
 * The round trip is spelled out because the loop above is only usable if the
 * numbers can come back: the assistant writes a calibration script, the user
 * runs it, and the System Log's Copy button is what carries the result to the
 * other end. It copies every level in full whatever the on-screen threshold
 * is, which is the part worth stating — an assistant that assumes the copy is
 * filtered will ask the user to change the level first, or worse, print at a
 * level it thinks will survive.
 *
 * The "copy the prompt again" line is about this text's own staleness. The
 * channel labels below are a snapshot taken at the moment the button was
 * pressed, so a prompt copied before the user labelled and calibrated their
 * channels carries the empty strings forever, and the assistant reading it has
 * no way to notice that the rig has since been described. Nothing else in the
 * conversation can repair that — only another press of the button.
 */
const CALIBRATION_PREREQUISITES: string[] = [
  'STRONGLY RECOMMENDED: run this in a planning mode (Claude Code plan mode, or any mode that produces a plan for approval before it writes code), and do not leave that mode until the user has approved the plan. Everything here is cheaper to get wrong in a plan than in a script that has already moved the actuator.',
  'While planning, interrogate the rig in detail — do not infer it and do not proceed on one round of questions. Ask, at minimum: what the machine is and what test this is; every AI channel the script will read (number, what sensor, what unit, full scale, which sign is which physically) and every AO channel it will drive (number, what it commands, what the voltage means at 0 V and at 10 V); what the specimen or target is and what destroys it; the safe limits — force, pressure, stroke, speed — and what the script should do on reaching one; where the mechanical end stops are; whether there is an E-stop and what it cuts. Ask follow-ups until you could predict what each channel will read before the run.',
  'Push everything you learn back into the Device Memo (Menu -> Device Memo, free text, always editable, saved in the browser and exportable as a .txt). Every time the user answers one of the questions above — a channel\'s sensor and unit, which sign is which, a limit, a gear ratio, a calibration constant, the AO volts-per-unit conversions the app itself stores nowhere — tell them to write it there, and give them the exact line to paste. Ask them at the end of a session too, for whatever the run taught. It costs the user a moment now and saves the whole interrogation next time, since the memo is copied into this prompt.',
  'Read the Device Memo at the bottom of this prompt before asking anything, and do not ask for what it already answers. Where the memo and the rest of this prompt disagree, the memo wins — a human wrote it about their own machine.',
  'Before writing the test script the user asked for, establish what has already been calibrated on this rig, and by what: ask. A channel label is not evidence that a calibration exists, and neither is a previous script.',
  'When a prerequisite below is missing, do not fold a guess into the test script. Write the calibration script as a separate script for the user to run first, tell them which numbers to read off it, and write the test script against those numbers afterwards.',
  'You can see what a calibration or check script measured, so design for that. Everything print()ed lands in the System Log (Menu -> System Log), and the Copy button in that window\'s header puts the WHOLE log on the clipboard — every level, in full, regardless of the level shown on screen, so the user can read at INFO and still hand you everything. Ask for that paste; it is the only way a result gets back to you.',
  'So a calibration or check script is written to be read back, not just watched: print one line per measurement point, the same fields in the same order every time, with units and Elapsed() in the line, and a clearly marked line at the end holding the numbers you actually want (the fitted slope, the gains, the offsets). Then tell the user in plain steps: press Start, wait for it to finish, press Copy in the System Log window, paste it here.',
  'Whenever you send the user away to do something in the app — label channels, calibrate them, run a calibration script, fix hardware settings — end that message by asking them to press "Copy AI Prompt" again and paste the new prompt when they come back. The channel labels AND the Device Memo at the bottom of this prompt are a snapshot from the moment the button was pressed: if they were empty or wrong then, they stay that way here no matter what the user has done to the rig since, and you cannot tell from inside the conversation that they are stale.',
  'Motor-driven actuator under SPEED control: a command-voltage-to-speed calibration (V -> mm/min, over the speed range the test actually uses, measured in both directions if the test moves both ways) and a rough proportional-only loop calibration are both required first. Start from P alone; add I only if a steady-state offset that matters remains, and treat D as a last resort on a rig whose speed signal is differentiated from position.',
  'Motor-driven actuator under FORCE or PRESSURE control: the speed calibration above is still required — the force loop commands speed, so without it the loop gain has no units — and on top of it the force loop (PID, or MPC where the user is using one) must be tuned on a DUMMY specimen of similar stiffness, never on the real one. Ask what the dummy is and what force and rate are safe on it before writing the tuning script.',
  'Motor drive settings — gear ratio, gearbox or pulley change, lead screw, and every driver setting (gain, acceleration/deceleration ramp, current or torque limit, electronic gearing, encoder resolution, command scaling) — must NEVER be changed once calibrated. Every constant above is a property of that exact drive train: change any of it and the V -> mm/min calibration and the loop gains are void, not merely shifted. State this in the script header, and if the user says anything was touched, stop and have them re-run the calibration before the test script is used again.',
  'Pneumatic or hydraulic actuator: ask for the pressure calibration FIRST, before anything else about the test — command voltage to pressure (V -> kPa) and, where the test is specified in force, command voltage to force (V -> N) on the actual cylinder and area in use. These rigs have no meaningful open-loop relation the script can fall back on.',
  'Pneumatic or hydraulic actuator under DISPLACEMENT or POSITION control: the pressure calibration is worth having and worth asking for, but whether to require it is the user\'s call — say what it buys them (the loop output becomes a real pressure rather than an arbitrary command) and accept a no. Tuning the position loop (PID, or MPC) on a DUMMY specimen is NOT optional: run it against the dummy first.',
  'Pneumatic and hydraulic hardware settings — supply/regulator pressure, servo-valve or driver gain and dither, relief and dead-band settings — must be identical on every run, because the calibration is only valid for the settings it was taken under. Have the user fix them once and never adjust them per test.',
  // The paper record is the one item here the app cannot enforce, which is
  // exactly why the prompt has to push it: the coefficients live in browser
  // storage on one machine, the hardware settings live only in the knobs
  // themselves, and neither survives a wiped profile, a swapped PC, or the
  // next person to touch the regulator. A number nobody can reconstruct
  // silently invalidates every result taken under it.
  'PRESS this every time, in every case: the calibration values must leave the screen and exist on paper. That means the Input Calib Value coefficients (a, b, c per AI channel — Save them to file from the Input Calib Value panel AND print or hand-write them), the PID/MPC gains, the V -> mm/min, V -> kPa and V -> N constants, and the fixed hardware settings the calibration is only valid under (gear ratio and driver settings on a motor rig, supply pressure and valve settings on a pneumatic or hydraulic one), each with the date and who measured it. Tell the user to attach that note physically to the machine and to keep the saved calibration file alongside the test data.',
  'Choose the control method for the user in front of you, and say why you chose it. PID is the default and needs no justification: it is what most tests want, and it is the one the user can re-tune themselves without coming back. Start at P, add I only for a steady-state offset that matters, add D only where you can defend it on this rig.',
  'Offer MPC (model-predictive control) when the ask is precision, very low speed, or a profile that has to be FOLLOWED rather than merely reached — the cases where a PID is fighting the plant\'s lag instead of its gain. It runs on the calibration constants above as its model, so it is only on the table once those exist. Optimal control (LQR and similar) is worth proposing where it fits, but leave the decision to the user and do not adopt it unasked.',
  'NEVER bang-bang / on-off control on an AO channel that commands a magnitude. The loop runs at about 5 Hz (0.2 s), so a full-scale command stands uncorrected for 200 ms at a time — that is not control, it is an oscillation with the specimen inside it. The one legitimate on-off use is an AO standing in for a digital output — an enable, a direction, a valve that is genuinely open or shut — where the output is two discrete voltages and nothing in between. Which two is the rig\'s business, not a convention — 0 V and 5 V, or 0 V and 10 V, or whatever that input reads as low and high — so ask the user which levels their hardware expects rather than assuming. There the coarseness costs nothing: those two levels are the whole signal, and there is nothing to modulate.',
  'Say plainly why: the coefficients are held in this browser\'s storage on this one PC. Clearing site data, moving to another machine, or another operator turning a knob loses them with no warning and no way to reconstruct what past results were taken under.',
];

const INSTRUMENT_API: ScriptApiDoc[] = [
  { name: 'GetAiRaw(ch)', desc: 'Raw AI value, before calibration. ch: 0-15.' },
  { name: 'GetAiPhy(ch)', desc: 'Calibrated AI value: a·Raw²+b·Raw+c. ch: 0-15.' },
  {
    name: 'SetAiTare(ch)',
    desc: 'Set offset c so AI ch reads 0 now (a, b kept). Applied async.',
  },
  { name: 'GetAo(ch)', desc: 'AO voltage [V], as last applied. ch: 0-7.' },
  {
    name: 'SetAo(ch, vlt)',
    desc: 'Set AO voltage [V], clamped to 0-10. Async: GetAo() updates later.',
  },
  {
    name: 'GetParam(ch)',
    desc: 'Scratch value, float32. ch: 0-15, starts at 0. Compare with a tolerance, never ==.',
    promptDesc:
      'Scratch value. ch: 0-15. Starts at 0. Stored as float32, so what comes back is the rounded value: after SetParam(0, 0.3), GetParam(0) is 0.30000001192092896 and "== 0.3" is False. Compare with a tolerance (abs(GetParam(0) - 0.3) < 1e-6), never with == .',
  },
  {
    name: 'SetParam(ch, val)',
    desc: 'Set scratch value (float32). Shown in Parameter panel, logged to TSV. Not persisted.',
    promptDesc:
      'Set scratch value. Shown in Parameter panel, logged to TSV. Not persisted. val is rounded to float32 (~7 significant digits) on the way in — do not accumulate a counter or an integrator across many iterations in Param and expect the exact sum; keep the running total in a Python float and SetParam it for display.',
  },
  {
    name: 'SetParamLabel(ch, text)',
    desc: 'Set Param ch\'s label; "" clears it. Persisted like a UI edit. Applied async.',
    promptDesc:
      'Set Param ch\'s free-text label. Shown in Parameter panel; persisted like a UI edit. Pass "" to clear it — there is no separate clear call. Applied async.',
  },
  { name: 'Elapsed()', desc: 'Seconds since Start. Monotonic - no midnight rollover.' },
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
  // sleep goes FIRST, ahead of the instrument calls. The list is otherwise
  // ordered by what it acts on, but this is the one call every script has to
  // contain and the one whose absence hangs the browser — putting it last, as
  // a footnote to the language, is the wrong place for the entry a reader most
  // needs to have seen before writing their first loop.
  apiDocs: [
    {
      name: 'await asyncio.sleep(s)',
      desc: 'Non-blocking wait, in SECONDS. Never below 0.1 s. NEVER time.sleep().',
    },
    ...INSTRUMENT_API,
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
    'Write plain, sequential Python and nothing cleverer. `await asyncio.sleep(s)` inside one ordinary loop IS the whole concurrency model here. Do NOT use asyncio.run(), create_task(), ensure_future(), gather(), wait(), TaskGroup, Queue, Event, async generators, threading, multiprocessing, concurrent.futures or run_in_executor: the script is already running inside the event loop, there is one thread and no OS behind it, and anything spawned outside the main flow keeps running after Stop or hides the loop that Stop relies on. Two things at once means one loop that does both, in order.',
    'No `while True:` without a break, unless the user explicitly asked for a script that runs until Stop is pressed. Give every loop a condition that ends it — a deadline, a target reached, a step count — and print why it ended. Stop always works, but a loop whose only exit is Stop cannot say whether it finished or was interrupted.',
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
  //
  // It ends on its own rather than looping forever, because the prompt now
  // asks scripts not to run on `while True:` alone, and the example someone
  // copies is a stronger statement of the house style than the rule that says
  // so. Stop still works at any moment; the deadline is about the script being
  // able to say it finished.
  defaultScript: `# Wait ONLY with \`await asyncio.sleep(s)\`, never below 0.1 s.
#   NEVER time.sleep() - it freezes the browser.
# Every loop needs one, on every path through it.
# Give every loop a way to end; Stop works either way.
# Keep state in Param, so Stop -> Start resumes.

import asyncio
import math

# example: slow sine wave on Parameter ch0, for 60 s
while Elapsed() < 60:
    SetParam(0, math.sin(Elapsed()))
    await asyncio.sleep(0.2)

print("done")`,
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
  deviceMemo: string,
): string =>
  [
    language.promptIntro,
    '',
    'API:',
    // The prompt takes the long form where there is one: the panel's line is
    // sized for a window, and nothing about a prompt is.
    ...language.apiDocs.map((api) => `- ${api.name}: ${api.promptDesc ?? api.desc}`),
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
    // Not folded into either list above, and not held per-language: this
    // section is about the rig rather than the script, and it is the only part
    // of the prompt whose right answer can be "do not write the requested
    // script yet".
    'Plan and calibration prerequisites (settle these BEFORE writing the requested script):',
    ...CALIBRATION_PREREQUISITES.map((line) => `- ${line}`),
    '',
    // Says "snapshot" at the point of use, not only in the prerequisites: this
    // is the block an assistant will scroll back to when it wonders whether a
    // channel is labelled, and that is the moment the caveat has to be there.
    'Channel labels (JSON; index = ch, "" = unlabeled). Snapshot from when this prompt was copied — ask for a fresh copy after any labelling or calibration work:',
    JSON.stringify(channelLabels),
    '',
    // Verbatim and last of the context blocks, right before the task: it is the
    // only part of this prompt a human wrote about their own machine, so it
    // outranks anything above that it contradicts, and it should be the freshest
    // thing in view when the request is read.
    'Device Memo — the user\'s own free-text notes on this rig, written in the app (Menu -> Device Memo). Where it disagrees with anything above, it wins:',
    deviceMemo.trim() === ''
      ? '(empty — the user has written nothing yet. Ask them to open Menu -> Device Memo and fill it in, then copy this prompt again.)'
      : deviceMemo.trim(),
    '',
    'Task: <your request here>',
  ].join('\n');
