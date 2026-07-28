// Built-in functions and procedures.
//
// The core is VB6's intrinsic library, restricted to what a control/measurement
// script can use: no file, form, object or date-arithmetic surface. A handful of
// deliberate additions are marked EXTENSION below; each one exists because the
// VB6 way of doing it is a formula the user would otherwise have to remember and
// retype in every script, and getting it subtly wrong is silent.
//
// Names are matched with underscores removed and case folded, so `GET_AI_PHY`,
// `GetAiPhy` and `getaiphy` are one function. This tolerance is why PascalCase
// could be chosen as the shared spelling for all three languages (see
// AGENTS.md): BASIC accepts it natively, so Python and Lua were the ones that
// moved. It also means a user who types the Python habit `get_ai_phy` here
// still gets the right function rather than a syntax error.
import {
  BasicRuntimeError,
  bankersRound,
  bool,
  cstr,
  formatNumber,
  strDollar,
  toNum,
  toStr,
  val,
  type BasicValue,
} from './values';

/**
 * Everything the interpreter cannot do for itself.
 *
 * Reads are synchronous (straight out of the SharedArrayBuffers the polling
 * loop publishes into); writes are fire-and-forget messages, because the Modbus
 * transfer mutex lives on the main thread. See scriptWorkerProtocol.ts.
 */
export type BasicHost = {
  /** Raw text, no newline appended — Print decides its own line breaks. */
  write(text: string): void;
  /** A non-fatal notice: the run continues, but something looks wrong. */
  warn(text: string): void;
  getAiRaw(ch: number): number;
  getAiPhy(ch: number): number;
  getAo(ch: number): number;
  getParam(ch: number): number;
  setAo(ch: number, volts: number): void;
  setParam(ch: number, value: number): void;
  setAiTare(ch: number): void;
  notify(message: string): void;
  /** Injectable so Timer/Elapsed can be driven deterministically in checks. */
  now(): number;
};

export type RuntimeContext = {
  readonly host: BasicHost;
  readonly line: number;
  /** Milliseconds since the run started; the basis for Elapsed(). */
  elapsedMs(): number;
  random(): number;
  lastRandom(): number;
  reseed(seed: number): void;
};

export type Builtin = {
  min: number;
  max: number;
  fn: (args: BasicValue[], ctx: RuntimeContext) => BasicValue;
};

export type Procedure = {
  min: number;
  max: number;
  fn: (args: BasicValue[], ctx: RuntimeContext) => void;
};

/** `GET_AI_PHY`, `GetAiPhy` and `getaiphy` all normalise to `GETAIPHY`. */
export const normalizeName = (name: string): string => name.replace(/_/g, '').toUpperCase();

const num = (args: BasicValue[], index: number, ctx: RuntimeContext): number =>
  toNum(args[index], ctx.line);

const int = (args: BasicValue[], index: number, ctx: RuntimeContext): number =>
  Math.trunc(num(args, index, ctx));

const str = (args: BasicValue[], index: number): string => toStr(args[index]);

/** Channel arguments are integers; a fractional one is a bug worth reporting. */
function channel(args: BasicValue[], index: number, ctx: RuntimeContext): number {
  const value = num(args, index, ctx);
  if (!Number.isInteger(value) || value < 0) {
    throw new BasicRuntimeError(`Channel must be a non-negative whole number, got ${cstr(value)}`, ctx.line);
  }
  return value;
}

function requireFinite(value: number, what: string, ctx: RuntimeContext): number {
  if (Number.isNaN(value)) {
    throw new BasicRuntimeError(`${what} is not a number`, ctx.line);
  }
  return value;
}

const DEG_PER_RAD = 180 / Math.PI;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const BUILTINS: Record<string, Builtin> = {
  // --- maths (VB6 intrinsics) --------------------------------------------
  ABS: { min: 1, max: 1, fn: (a, c) => Math.abs(num(a, 0, c)) },
  SGN: { min: 1, max: 1, fn: (a, c) => Math.sign(num(a, 0, c)) },
  SQR: {
    min: 1,
    max: 1,
    fn: (a, c) => {
      const value = num(a, 0, c);
      // VB6 raises "Invalid procedure call" here. Kept as an error rather than
      // returning NaN: a NaN propagates silently into a whole column of a TSV.
      if (value < 0) throw new BasicRuntimeError(`Sqr of a negative number (${cstr(value)})`, c.line);
      return Math.sqrt(value);
    },
  },
  EXP: { min: 1, max: 1, fn: (a, c) => Math.exp(num(a, 0, c)) },
  LOG: {
    min: 1,
    max: 1,
    fn: (a, c) => {
      const value = num(a, 0, c);
      if (value <= 0) throw new BasicRuntimeError(`Log of a non-positive number (${cstr(value)})`, c.line);
      return Math.log(value);
    },
  },
  SIN: { min: 1, max: 1, fn: (a, c) => Math.sin(num(a, 0, c)) },
  COS: { min: 1, max: 1, fn: (a, c) => Math.cos(num(a, 0, c)) },
  TAN: { min: 1, max: 1, fn: (a, c) => Math.tan(num(a, 0, c)) },
  ATN: { min: 1, max: 1, fn: (a, c) => Math.atan(num(a, 0, c)) },
  /** Floor — towards minus infinity, so Int(-2.5) is -3. */
  INT: { min: 1, max: 1, fn: (a, c) => Math.floor(num(a, 0, c)) },
  /** Truncate — towards zero, so Fix(-2.5) is -2. The pair trips everyone up. */
  FIX: { min: 1, max: 1, fn: (a, c) => Math.trunc(num(a, 0, c)) },
  ROUND: { min: 1, max: 2, fn: (a, c) => bankersRound(num(a, 0, c), a.length > 1 ? int(a, 1, c) : 0) },
  RND: {
    min: 0,
    max: 1,
    fn: (a, c) => {
      if (a.length === 0) return c.random();
      const arg = num(a, 0, c);
      // VB6: Rnd(0) repeats the last number, Rnd(negative) reseeds from it.
      if (arg === 0) return c.lastRandom();
      if (arg < 0) c.reseed(Math.abs(arg));
      return c.random();
    },
  },

  // --- maths (EXTENSION) --------------------------------------------------
  // LOG10 because every consolidation and grain-size calculation is on a log10
  // axis (e-logP, the grading curve), and `Log(x) / Log(10)` is a formula users
  // mistype as Log10 and then wonder about.
  LOG10: {
    min: 1,
    max: 1,
    fn: (a, c) => {
      const value = num(a, 0, c);
      if (value <= 0) throw new BasicRuntimeError(`Log10 of a non-positive number (${cstr(value)})`, c.line);
      return Math.log10(value);
    },
  },
  // ASIN/ACOS because Mohr-Coulomb goes straight through them:
  // sin(phi) = (s1 - s3) / (s1 + s3). VB6 makes you write it out via Atn.
  ASIN: {
    min: 1,
    max: 1,
    fn: (a, c) => {
      const value = num(a, 0, c);
      if (value < -1 || value > 1) throw new BasicRuntimeError(`Asin argument out of range (${cstr(value)})`, c.line);
      return Math.asin(value);
    },
  },
  ACOS: {
    min: 1,
    max: 1,
    fn: (a, c) => {
      const value = num(a, 0, c);
      if (value < -1 || value > 1) throw new BasicRuntimeError(`Acos argument out of range (${cstr(value)})`, c.line);
      return Math.acos(value);
    },
  },
  // The trig functions take radians and every soil report is in degrees.
  DEG: { min: 1, max: 1, fn: (a, c) => num(a, 0, c) * DEG_PER_RAD },
  RAD: { min: 1, max: 1, fn: (a, c) => num(a, 0, c) / DEG_PER_RAD },
  MIN: { min: 2, max: Infinity, fn: (a, c) => Math.min(...a.map((_, i) => num(a, i, c))) },
  MAX: { min: 2, max: Infinity, fn: (a, c) => Math.max(...a.map((_, i) => num(a, i, c))) },
  PI: { min: 0, max: 0, fn: () => Math.PI },

  // --- conversion ---------------------------------------------------------
  CINT: { min: 1, max: 1, fn: (a, c) => bankersRound(num(a, 0, c)) },
  CLNG: { min: 1, max: 1, fn: (a, c) => bankersRound(num(a, 0, c)) },
  CDBL: { min: 1, max: 1, fn: (a, c) => num(a, 0, c) },
  CSNG: { min: 1, max: 1, fn: (a, c) => Math.fround(num(a, 0, c)) },
  CSTR: { min: 1, max: 1, fn: (a) => toStr(a[0]) },
  CBOOL: { min: 1, max: 1, fn: (a, c) => bool(num(a, 0, c) !== 0) },
  IIF: { min: 3, max: 3, fn: (a, c) => (num(a, 0, c) !== 0 ? a[1] : a[2]) },

  // --- strings ------------------------------------------------------------
  LEN: { min: 1, max: 1, fn: (a) => str(a, 0).length },
  LEFT: { min: 2, max: 2, fn: (a, c) => str(a, 0).slice(0, Math.max(0, int(a, 1, c))) },
  RIGHT: {
    min: 2,
    max: 2,
    fn: (a, c) => {
      const count = Math.max(0, int(a, 1, c));
      return count === 0 ? '' : str(a, 0).slice(-count);
    },
  },
  MID: {
    min: 2,
    max: 3,
    fn: (a, c) => {
      const source = str(a, 0);
      // 1-based, as in every BASIC.
      const start = int(a, 1, c);
      if (start < 1) throw new BasicRuntimeError(`Mid start must be 1 or more, got ${start}`, c.line);
      const from = start - 1;
      return a.length > 2 ? source.substr(from, Math.max(0, int(a, 2, c))) : source.slice(from);
    },
  },
  INSTR: {
    min: 2,
    max: 3,
    fn: (a, c) => {
      // Two forms: InStr(hay, needle) and InStr(start, hay, needle).
      const hasStart = a.length === 3;
      const start = hasStart ? int(a, 0, c) : 1;
      if (start < 1) throw new BasicRuntimeError(`InStr start must be 1 or more, got ${start}`, c.line);
      const hay = str(a, hasStart ? 1 : 0);
      const needle = str(a, hasStart ? 2 : 1);
      return hay.indexOf(needle, start - 1) + 1;
    },
  },
  TRIM: { min: 1, max: 1, fn: (a) => str(a, 0).trim() },
  LTRIM: { min: 1, max: 1, fn: (a) => str(a, 0).replace(/^\s+/, '') },
  RTRIM: { min: 1, max: 1, fn: (a) => str(a, 0).replace(/\s+$/, '') },
  UCASE: { min: 1, max: 1, fn: (a) => str(a, 0).toUpperCase() },
  LCASE: { min: 1, max: 1, fn: (a) => str(a, 0).toLowerCase() },
  SPACE: { min: 1, max: 1, fn: (a, c) => ' '.repeat(Math.max(0, int(a, 0, c))) },
  STRING: {
    min: 2,
    max: 2,
    fn: (a, c) => {
      const count = Math.max(0, int(a, 0, c));
      const source = a[1];
      const char = typeof source === 'string' ? source.charAt(0) : String.fromCharCode(int(a, 1, c));
      return char === '' ? '' : char.repeat(count);
    },
  },
  STR: { min: 1, max: 1, fn: (a, c) => strDollar(num(a, 0, c)) },
  VAL: { min: 1, max: 1, fn: (a) => val(str(a, 0)) },
  CHR: { min: 1, max: 1, fn: (a, c) => String.fromCharCode(int(a, 0, c)) },
  ASC: {
    min: 1,
    max: 1,
    fn: (a, c) => {
      const source = str(a, 0);
      if (source === '') throw new BasicRuntimeError('Asc of an empty string', c.line);
      return source.charCodeAt(0);
    },
  },
  REPLACE: {
    min: 3,
    max: 3,
    fn: (a) => str(a, 0).split(str(a, 1)).join(str(a, 2)),
  },
  STRREVERSE: { min: 1, max: 1, fn: (a) => [...str(a, 0)].reverse().join('') },
  /**
   * True when Val() would find a complete number. The guard to write before
   * trusting text that came from outside the script.
   */
  ISNUMERIC: {
    min: 1,
    max: 1,
    fn: (a) => {
      const value = a[0];
      if (typeof value === 'number') return bool(true);
      const text = toStr(value).trim();
      return bool(text !== '' && !Number.isNaN(Number(text)));
    },
  },
  HEX: { min: 1, max: 1, fn: (a, c) => (int(a, 0, c) >>> 0).toString(16).toUpperCase() },
  OCT: { min: 1, max: 1, fn: (a, c) => (int(a, 0, c) >>> 0).toString(8) },
  FORMAT: { min: 2, max: 2, fn: (a, c) => formatNumber(num(a, 0, c), str(a, 1)) },

  // --- time ---------------------------------------------------------------
  /**
   * Seconds since local midnight, with a fractional part — VB6's Timer exactly,
   * *including* its rollover at midnight. That rollover matters here: a
   * consolidation stage runs well over 24 h, so `Timer - t0` goes sharply
   * negative partway through. Elapsed() below is the one to use for durations.
   */
  TIMER: {
    min: 0,
    max: 0,
    fn: (_a, c) => {
      const now = new Date(c.host.now());
      return (
        now.getHours() * 3600 +
        now.getMinutes() * 60 +
        now.getSeconds() +
        now.getMilliseconds() / 1000
      );
    },
  },
  // EXTENSION. Monotonic seconds since the script started, so it has no
  // midnight discontinuity and needs no `t0` variable.
  ELAPSED: { min: 0, max: 0, fn: (_a, c) => c.elapsedMs() / 1000 },
  TIME: {
    min: 0,
    max: 0,
    fn: (_a, c) => {
      const now = new Date(c.host.now());
      return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    },
  },
  /**
   * ISO order, which is a deliberate break from VB6's locale-dependent Date$.
   * A logging script's date almost always ends up in a filename or a column
   * heading, and `2026/07/28` sorts while `07/28/2026` does not.
   */
  DATE: {
    min: 0,
    max: 0,
    fn: (_a, c) => {
      const now = new Date(c.host.now());
      return `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())}`;
    },
  },

  // --- instrument reads ---------------------------------------------------
  GETAIRAW: { min: 1, max: 1, fn: (a, c) => c.host.getAiRaw(channel(a, 0, c)) },
  GETAIPHY: { min: 1, max: 1, fn: (a, c) => c.host.getAiPhy(channel(a, 0, c)) },
  GETAO: { min: 1, max: 1, fn: (a, c) => c.host.getAo(channel(a, 0, c)) },
  GETPARAM: { min: 1, max: 1, fn: (a, c) => c.host.getParam(channel(a, 0, c)) },
};

export const PROCEDURES: Record<string, Procedure> = {
  SETAO: {
    min: 2,
    max: 2,
    fn: (a, c) => c.host.setAo(channel(a, 0, c), requireFinite(num(a, 1, c), 'AO value', c)),
  },
  SETPARAM: {
    min: 2,
    max: 2,
    fn: (a, c) => c.host.setParam(channel(a, 0, c), requireFinite(num(a, 1, c), 'Parameter value', c)),
  },
  SETAITARE: { min: 1, max: 1, fn: (a, c) => c.host.setAiTare(channel(a, 0, c)) },
  SETNOTIFY: { min: 1, max: 1, fn: (a, c) => c.host.notify(toStr(a[0])) },
  RANDOMIZE: {
    min: 0,
    max: 1,
    fn: (a, c) => c.reseed(a.length === 0 ? c.host.now() : num(a, 0, c)),
  },
};

/**
 * Names that may be written without parentheses (`Timer`, `Rnd`, `Pi`), so a
 * bare identifier can resolve to one when no variable of that name exists.
 */
export const isNullaryBuiltin = (normalized: string): boolean =>
  BUILTINS[normalized]?.min === 0;
