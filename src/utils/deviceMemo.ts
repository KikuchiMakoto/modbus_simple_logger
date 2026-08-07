// Free text about the rig this app is plugged into.
//
// Everything else the app persists is structured — calibration coefficients,
// per-channel labels, voltage modes — and each of those has a field because the
// app does something with it. This has none, and that is the point: what a
// machine is, which cylinder is fitted, which way the motor turns, what the
// regulator is set to, who calibrated it and when, are facts the app cannot
// model and cannot infer, and the alternative to a notepad is that they live
// only in the operator's head.
//
// It is read back out into the "Copy AI Prompt" text, which is the reason it
// exists at all: the prompt already carries the channel labels, but a label is
// one line per channel and most of what an assistant needs to ask about does
// not fit in one.
//
// Stored via readJsonStorage/writeJsonStorage rather than readJsonCookie: there
// is no legacy cookie to migrate for a key this new, and a memo is exactly the
// kind of value that outgrows the ~4 KB a cookie can carry. The cookie lifeboat
// inside writeJsonStorage still catches the browser-blocks-site-data case, and
// declines by itself when the text is too big for it.
import { readJsonStorage, writeJsonStorage } from './cookies';

const DEVICE_MEMO_KEY = 'device_memo_v1';

/** Long enough for a rig's whole description; short enough not to be a document. */
export const DEVICE_MEMO_MAX = 8000;

export const loadDeviceMemo = (): string => {
  const raw = readJsonStorage<string>(DEVICE_MEMO_KEY);
  return typeof raw === 'string' ? raw.slice(0, DEVICE_MEMO_MAX) : '';
};

export const saveDeviceMemo = (memo: string): void => {
  writeJsonStorage(DEVICE_MEMO_KEY, memo.slice(0, DEVICE_MEMO_MAX));
};

const pad = (n: number) => n.toString().padStart(2, '0');

/**
 * `20260807_201533_device-memo.txt`
 *
 * Same leading timestamp, in local time, as the calibration export — these two
 * files describe the same rig at the same moment and are meant to end up in the
 * same folder, so they should sort together rather than by name.
 */
export const deviceMemoFileName = (at: Date = new Date()): string =>
  `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}_` +
  `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}_device-memo.txt`;

/**
 * What a brand-new memo starts as: the questions, left unanswered.
 *
 * An empty box asks the user to work out what "device info" means, and the
 * answer they invent is usually the machine's name and nothing else. These are
 * the headings the AI prompt goes on to ask about anyway, so the memo starts as
 * the shape of the answer rather than as a blank.
 */
export const DEVICE_MEMO_TEMPLATE = `# Any language — 日本語 / 中文 / English / … Write in whatever you think in.
# Overwrite these headings freely; they are a starting point, not a form.

# Machine
(maker / model / what it does)

# Actuator
(motor or pneumatic/hydraulic; gear ratio, lead, cylinder bore & stroke)

# Sensors on each AI channel
(what, unit, full scale, which sign is which physically)

# What each AO channel commands
(what it drives, what 0 V and 10 V mean on it, and the volts-per-unit
 conversion — V to mm/min, V to kPa, V to N. The app calibrates AI channels
 and stores those coefficients; it stores NOTHING for AO, so this is the
 only place an analog output's calibration exists.)

# Safe limits
(force / pressure / stroke / speed, end stops, E-stop)

# Fixed hardware settings
(driver gains, ramps, current limits / supply pressure, valve settings)

# Calibration
(what was measured, when, by whom, and where the paper copy is)

# Notes
`;
