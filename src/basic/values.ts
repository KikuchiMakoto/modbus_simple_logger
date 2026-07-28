// Value semantics for the BASIC dialect: one Variant-ish type, coerced on use.
//
// VB6 has three *different* number-to-string conversions and users rely on all
// three without noticing, so they are three functions here rather than one:
//
//   `&` / CStr   -> "5"      no padding
//   Str$         -> " 5"     leading space where the sign would go
//   Print        -> " 5 "    the same, plus a trailing column separator
//
// Collapsing them would make `"n=" & 5` render as `n= 5`, which looks like a
// bug in the user's script rather than a decision in ours.

/**
 * VB6's Empty: an uninitialised variable, 0 in numeric context and "" in
 * string context.
 *
 * A sentinel rather than defaulting to 0, because the two contexts disagree.
 * With 0 as the default, the extremely common `Msg = Msg & "text"` accumulator
 * starts out as the string "0text" — a silent wrong answer in output the user
 * is reading as data.
 */
export const EMPTY = Symbol('Empty');

export type BasicValue = number | string | typeof EMPTY;

export class BasicRuntimeError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'BasicRuntimeError';
  }
}

const trimZeros = (text: string): string =>
  text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;

/**
 * CStr / `&`. 15 significant digits, which is VB6's Double precision and also
 * what hides binary noise: JS's default 17 digits renders 0.1 + 0.2 as
 * 0.30000000000000004, and a measurement log full of that is unreadable.
 */
export function cstr(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);

  const text = value.toPrecision(15);
  if (!text.includes('e')) return trimZeros(text);
  // VB6 spells exponents `1.5E-07`, with at least two exponent digits.
  const [mantissa, exponent] = text.split('e');
  const power = Number(exponent);
  const sign = power < 0 ? '-' : '+';
  return `${trimZeros(mantissa)}E${sign}${String(Math.abs(power)).padStart(2, '0')}`;
}

/** Str$: CStr with the sign position occupied by a space when non-negative. */
export const strDollar = (value: number): string => (value < 0 ? cstr(value) : ` ${cstr(value)}`);

/** How Print renders a number: Str$ plus the trailing column separator. */
export const printNumber = (value: number): string => `${strDollar(value)} `;

export const isEmpty = (value: BasicValue): value is typeof EMPTY => value === EMPTY;

export function toStr(value: BasicValue): string {
  if (value === EMPTY) return '';
  return typeof value === 'string' ? value : cstr(value);
}

// VB6 coerces a numeric-looking string in arithmetic ("10" + 5 is 15). Kept,
// because the alternative is a type-mismatch error on data the user read out of
// a string, and the failure mode of coercing is loud (NaN never appears — a
// non-numeric string still throws).
export function toNum(value: BasicValue, line: number): number {
  if (value === EMPTY) return 0;
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new BasicRuntimeError(`Type mismatch: '${value}' is not a number`, line);
  }
  return parsed;
}

/** VB6 booleans: True is -1, False is 0, so `Not True` is `Not -1` is 0. */
export const TRUE = -1;
export const FALSE = 0;
export const bool = (value: boolean): number => (value ? TRUE : FALSE);

/**
 * Round half to even.
 *
 * VB6's Round(), CInt() and CLng() all do this, and it is not merely a
 * compatibility quirk here: JIS Z 8401 rule A specifies exactly the same rule
 * for reporting measured values, so this is also the rounding a Japanese test
 * report is supposed to use.
 */
export function bankersRound(value: number, digits = 0): number {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff > 0.5) rounded = floor + 1;
  else if (diff < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  return rounded / scale;
}

/**
 * Val(): the leading numeric prefix of a string, 0 if there is none.
 *
 * Never throws — that is the whole point of Val() as opposed to CDbl(), and it
 * is what makes it safe for parsing whatever a user pasted into a script.
 */
export function val(text: string): number {
  const match = /^[ \t]*[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?/.exec(text);
  if (!match) return 0;
  return Number(match[0].trim().replace(/[dD]/, 'e'));
}

/**
 * Format(): the `0` / `#` / `.` / `,` numeric picture patterns.
 *
 * Deliberately only the numeric subset. It is the one VB6 function every
 * measurement script uses — `Format(load, "0.00")` — while the date and named
 * formats are a large surface no logging script has asked for. Anything the
 * pattern does not describe falls through to CStr rather than erroring, so a
 * pattern we do not understand still prints the number.
 */
export function formatNumber(value: number, pattern: string): string {
  if (!/[0#]/.test(pattern)) return cstr(value);
  if (!Number.isFinite(value)) return cstr(value);

  const [intPattern, fracPattern = ''] = pattern.split('.');
  const decimals = (fracPattern.match(/[0#]/g) ?? []).length;
  const grouped = intPattern.includes(',');

  const rounded = bankersRound(value, decimals);
  const negative = rounded < 0 || Object.is(rounded, -0);
  const fixed = Math.abs(rounded).toFixed(decimals);
  let [whole, fraction = ''] = fixed.split('.');

  // Trailing `#` positions are dropped when they would be zero; `0` positions
  // are kept. Walk from the right so "0.0##" keeps one digit and drops two.
  for (let i = fracPattern.length - 1; i >= 0 && fraction.length > 0; i -= 1) {
    if (fracPattern[i] !== '#') break;
    if (fraction[fraction.length - 1] !== '0') break;
    fraction = fraction.slice(0, -1);
  }

  const minWholeDigits = (intPattern.match(/0/g) ?? []).length;
  if (whole.length < minWholeDigits) whole = whole.padStart(minWholeDigits, '0');
  if (grouped) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
