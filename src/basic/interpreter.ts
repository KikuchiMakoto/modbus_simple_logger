// The step machine. Executes the flat Instr[] that parser.ts produces.
//
// `resume()` runs until a deadline and hands control back, rather than running
// the program to completion. That is what makes Stop work and what keeps the
// worker's message queue alive: a `Do ... Loop` with no exit yields every few
// milliseconds like any other program, so the interrupt byte gets read and the
// buffered Print output gets flushed. Nothing in here blocks.
import {
  BUILTINS,
  PROCEDURES,
  isNullaryBuiltin,
  normalizeName,
  type BasicHost,
  type RuntimeContext,
} from './builtins';
import { parse, type Expr, type Instr, type Program } from './parser';
import {
  BasicRuntimeError,
  EMPTY,
  bankersRound,
  bool,
  cstr,
  printNumber,
  toNum,
  toStr,
  type BasicValue,
} from './values';

export type RunOutcome =
  /** The deadline passed. Call resume() again to continue. */
  | { kind: 'yield' }
  /** Sleep, then call resume() again. */
  | { kind: 'sleep'; ms: number }
  | { kind: 'done' };

type BasicArray = {
  /** Upper bounds; Dim A(10) is 0..10, i.e. Option Base 0. */
  bounds: number[];
  data: BasicValue[];
};

type ForFrame = { limit: number; step: number };

/** Print's comma separator advances to the next 14-column zone, as in QBasic. */
const PRINT_ZONE_WIDTH = 14;

/**
 * GoSub nesting limit. Real BASIC leaks a frame when a GoSub body is left by
 * GoTo, so a script that does that in a loop would otherwise grow the stack
 * until the worker dies with an unattributable out-of-memory.
 */
const MAX_GOSUB_DEPTH = 1000;

/** How often the deadline is consulted. Cheap enough to be invisible, frequent
 * enough that a tight numeric loop still yields on time. */
const DEADLINE_CHECK_INTERVAL = 256;

/**
 * At or above this many seconds, a Sleep argument was plausibly meant as VBA
 * milliseconds (`Sleep 1000` for one second). See the 'sleep' case: this only
 * raises a notice, because a wait this long is legitimate in a soil test.
 */
const SLEEP_UNITS_NOTICE_SECONDS = 100;

export class BasicInterpreter {
  private readonly instrs: Instr[];
  private pc = 0;
  private done = false;
  private readonly vars = new Map<string, BasicValue>();
  private readonly arrays = new Map<string, BasicArray>();
  /** Keyed by the loop's top instruction index rather than held on a stack, so
   * an `Exit For` that jumps out of the loop cannot leave a frame behind. */
  private readonly forFrames = new Map<number, ForFrame>();
  private readonly returnStack: number[] = [];
  private printColumn = 0;
  private readonly startedAt: number;
  private seed: number;
  private previousRandom = 0;
  private warnedAboutSleepUnits = false;

  constructor(
    program: Program,
    private readonly host: BasicHost,
  ) {
    this.instrs = program.instrs;
    this.startedAt = host.now();
    this.seed = 0x2545f491;
  }

  static compile(source: string, host: BasicHost): BasicInterpreter {
    return new BasicInterpreter(parse(source), host);
  }

  get finished(): boolean {
    return this.done;
  }

  /**
   * Run until `deadline` (a Date.now() value), a Sleep, or the end of the
   * program.
   */
  resume(deadline: number): RunOutcome {
    let sinceCheck = 0;
    while (!this.done) {
      if (this.pc < 0 || this.pc >= this.instrs.length) {
        this.done = true;
        break;
      }
      const sleepMs = this.execute(this.instrs[this.pc]);
      if (sleepMs !== null) return { kind: 'sleep', ms: sleepMs };
      sinceCheck += 1;
      if (sinceCheck >= DEADLINE_CHECK_INTERVAL) {
        sinceCheck = 0;
        if (Date.now() >= deadline) return { kind: 'yield' };
      }
    }
    // A program whose last Print ended with `;` left a line open; close it so
    // the output pane does not swallow the final row.
    if (this.printColumn > 0) {
      this.host.write('\n');
      this.printColumn = 0;
    }
    return { kind: 'done' };
  }

  private get context(): RuntimeContext {
    const line = this.instrs[Math.min(this.pc, this.instrs.length - 1)]?.line ?? 0;
    return {
      host: this.host,
      line,
      elapsedMs: () => this.host.now() - this.startedAt,
      random: () => this.nextRandom(),
      lastRandom: () => this.previousRandom,
      reseed: (seed) => this.reseed(seed),
    };
  }

  // Linear congruential, seeded, so `Randomize 42` reproduces a run exactly.
  // Math.random() cannot do that, and a control script that misbehaves once is
  // worth being able to replay.
  private nextRandom(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    this.previousRandom = this.seed / 4294967296;
    return this.previousRandom;
  }

  private reseed(seed: number): void {
    this.seed = (Math.trunc(seed) >>> 0) || 1;
  }

  /** Execute one instruction. Returns sleep milliseconds, or null to continue. */
  private execute(instr: Instr): number | null {
    switch (instr.op) {
      case 'assign': {
        const value = this.evaluate(instr.value);
        if (instr.target.indices.length === 0) {
          this.vars.set(instr.target.name, value);
        } else {
          const indices = instr.target.indices.map((index) => this.toIndex(index, instr.line));
          this.setElement(instr.target.name, indices, value, instr.line);
        }
        this.pc += 1;
        return null;
      }

      case 'dim': {
        if (instr.dims.length === 0) {
          if (!this.vars.has(instr.name)) this.vars.set(instr.name, EMPTY);
        } else {
          const bounds = instr.dims.map((dim) => this.toIndex(dim, instr.line));
          this.declareArray(instr.name, bounds, instr.line);
        }
        this.pc += 1;
        return null;
      }

      case 'print': {
        this.doPrint(instr);
        this.pc += 1;
        return null;
      }

      case 'jump': {
        this.pc = instr.target;
        return null;
      }

      case 'jumpIfFalse': {
        const value = toNum(this.evaluate(instr.cond), instr.line);
        this.pc = value === 0 ? instr.target : this.pc + 1;
        return null;
      }

      case 'forInit': {
        const from = toNum(this.evaluate(instr.from), instr.line);
        // VB6 evaluates the limit and the step once, on entry — a loop whose
        // limit is GetAiPhy() must not re-read the instrument every iteration.
        const limit = toNum(this.evaluate(instr.to), instr.line);
        const step = instr.step === null ? 1 : toNum(this.evaluate(instr.step), instr.line);
        if (step === 0 || Number.isNaN(step)) {
          throw new BasicRuntimeError('For step cannot be zero', instr.line);
        }
        this.vars.set(instr.name, from);
        const top = this.pc + 1;
        this.forFrames.set(top, { limit, step });
        const skip = step > 0 ? from > limit : from < limit;
        this.pc = skip ? instr.exit : top;
        return null;
      }

      case 'forNext': {
        const frame = this.forFrames.get(instr.top);
        if (!frame) throw new BasicRuntimeError(`Next without For`, instr.line);
        const next = toNum(this.vars.get(instr.name) ?? EMPTY, instr.line) + frame.step;
        this.vars.set(instr.name, next);
        const carryOn = frame.step > 0 ? next <= frame.limit : next >= frame.limit;
        if (carryOn) {
          this.pc = instr.top;
        } else {
          this.forFrames.delete(instr.top);
          this.pc += 1;
        }
        return null;
      }

      case 'gosub': {
        if (this.returnStack.length >= MAX_GOSUB_DEPTH) {
          throw new BasicRuntimeError('Out of stack space: GoSub nested too deeply', instr.line);
        }
        this.returnStack.push(this.pc + 1);
        this.pc = instr.target;
        return null;
      }

      case 'return': {
        const target = this.returnStack.pop();
        if (target === undefined) throw new BasicRuntimeError('Return without GoSub', instr.line);
        this.pc = target;
        return null;
      }

      case 'sleep': {
        const seconds = toNum(this.evaluate(instr.seconds), instr.line);
        if (Number.isNaN(seconds)) throw new BasicRuntimeError('Sleep needs a number of seconds', instr.line);
        this.pc += 1;
        // Sleep is in SECONDS, fractions allowed: `Sleep 0.1` is 100 ms.
        //
        // Three reasons, in order of weight. It matches the other two languages
        // this app runs (Python's asyncio.sleep and Lua's sleep are both in
        // seconds), so the unit is one fewer thing that changes when a script is
        // translated. It is also what VB6 itself implies: VB6 has no Sleep
        // statement, and its native wait — a busy loop on Timer — is in seconds.
        // Milliseconds only appear once you reach for the kernel32 Declare or
        // VB.NET's Thread.Sleep.
        //
        // And it fails in the safe direction. A VBA user's `Sleep 1000` waits
        // 16.7 minutes, which looks wrong immediately; the same habit under
        // milliseconds turns a QBasic user's `Sleep 1` into a one-millisecond
        // loop that hammers the Modbus link — quiet, and actually harmful.
        if (seconds >= SLEEP_UNITS_NOTICE_SECONDS && !this.warnedAboutSleepUnits) {
          this.warnedAboutSleepUnits = true;
          // Deliberately neutral: waiting an hour between readings is correct in
          // a consolidation test, so this has to read as a confirmation there
          // and as a correction for someone who meant milliseconds.
          this.host.warn(
            `Sleep ${cstr(seconds)} waits ${cstr(bankersRound(seconds / 60, 1))} minutes` +
              ` — Sleep takes seconds (line ${instr.line}).`,
          );
        }
        return Math.max(0, seconds * 1000);
      }

      case 'call': {
        this.doCall(instr.name, instr.spelling, instr.args, instr.line);
        this.pc += 1;
        return null;
      }

      case 'end': {
        this.done = true;
        return null;
      }
    }
  }

  private doCall(name: string, spelling: string, args: Expr[], line: number): void {
    const normalized = normalizeName(name);
    const values = args.map((arg) => this.evaluate(arg));
    const procedure = PROCEDURES[normalized];
    if (procedure) {
      this.checkArity(spelling, values.length, procedure.min, procedure.max, line);
      procedure.fn(values, this.context);
      return;
    }
    // A function used as a statement (`Sqr 2`) lands here too. Say so, rather
    // than the bare "unknown", because that is the likelier mistake.
    if (BUILTINS[normalized]) {
      throw new BasicRuntimeError(`'${spelling}' returns a value and cannot be used as a statement`, line);
    }
    throw new BasicRuntimeError(`Unknown statement or procedure '${spelling}'`, line);
  }

  private checkArity(name: string, count: number, min: number, max: number, line: number): void {
    if (count >= min && count <= max) return;
    const expected = min === max ? `${min}` : max === Infinity ? `${min} or more` : `${min} to ${max}`;
    throw new BasicRuntimeError(
      `Wrong number of arguments to '${name}': expected ${expected}, got ${count}`,
      line,
    );
  }

  private doPrint(instr: Extract<Instr, { op: 'print' }>): void {
    const write = (text: string) => {
      if (text === '') return;
      this.host.write(text);
      const lastBreak = text.lastIndexOf('\n');
      this.printColumn = lastBreak === -1 ? this.printColumn + text.length : text.length - lastBreak - 1;
    };

    let trailingSeparator: ';' | ',' | null = null;
    for (const item of instr.items) {
      if (item.expr !== null) {
        const value = this.evaluate(item.expr);
        write(typeof value === 'number' ? printNumber(value) : toStr(value));
      }
      trailingSeparator = item.sep;
      if (item.sep === ',') {
        const pad = PRINT_ZONE_WIDTH - (this.printColumn % PRINT_ZONE_WIDTH);
        write(' '.repeat(pad));
      }
    }
    // A trailing `;` or `,` holds the line open for the next Print, which is
    // how BASIC builds a row of readings from several statements.
    if (trailingSeparator === null) {
      this.host.write('\n');
      this.printColumn = 0;
    }
  }

  // --- variables and arrays ------------------------------------------------

  private declareArray(name: string, bounds: number[], line: number): void {
    let total = 1;
    for (const bound of bounds) {
      if (bound < 0) throw new BasicRuntimeError(`Dim ${name}: bound cannot be negative`, line);
      total *= bound + 1;
    }
    // Bounded so `Dim A(100000000)` fails with a sentence instead of taking the
    // worker down with an allocation failure.
    if (total > 1_000_000) {
      throw new BasicRuntimeError(`Dim ${name}: ${total} elements is too large`, line);
    }
    this.arrays.set(name, { bounds, data: new Array<BasicValue>(total).fill(EMPTY) });
  }

  private offsetOf(name: string, array: BasicArray, indices: number[], line: number): number {
    if (indices.length !== array.bounds.length) {
      throw new BasicRuntimeError(
        `${name} has ${array.bounds.length} dimension(s), used with ${indices.length}`,
        line,
      );
    }
    let offset = 0;
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i];
      if (index < 0 || index > array.bounds[i]) {
        throw new BasicRuntimeError(
          `Subscript out of range: ${name}(${indices.join(', ')})`,
          line,
        );
      }
      offset = offset * (array.bounds[i] + 1) + index;
    }
    return offset;
  }

  private setElement(name: string, indices: number[], value: BasicValue, line: number): void {
    let array = this.arrays.get(name);
    if (!array) {
      // Classic BASIC auto-dimensions to 10 on first use. Kept because a script
      // that says `A(3) = 1` without a Dim is correct in N88 and QBasic, and
      // erroring on it would reject working code the user brought with them.
      this.declareArray(name, indices.map(() => 10), line);
      array = this.arrays.get(name)!;
    }
    array.data[this.offsetOf(name, array, indices, line)] = value;
  }

  private toIndex(expr: Expr, line: number): number {
    const value = toNum(this.evaluate(expr), line);
    if (!Number.isFinite(value)) throw new BasicRuntimeError('Subscript is not a number', line);
    // VB6 rounds a fractional subscript rather than rejecting it.
    return Math.round(value);
  }

  // --- expressions ---------------------------------------------------------

  private evaluate(expr: Expr): BasicValue {
    switch (expr.kind) {
      case 'num':
        return expr.value;
      case 'str':
        return expr.value;
      case 'var': {
        const value = this.vars.get(expr.name);
        if (value !== undefined) return value;
        // `Timer`, `Rnd` and `Pi` are written without parentheses.
        const normalized = normalizeName(expr.name);
        if (isNullaryBuiltin(normalized)) return BUILTINS[normalized].fn([], this.context);
        // An unset variable is Empty, as in VB6 without Option Explicit.
        return EMPTY;
      }
      case 'index':
        return this.evaluateIndex(expr);
      case 'unary':
        return this.evaluateUnary(expr);
      case 'binary':
        return this.evaluateBinary(expr);
    }
  }

  /** `A(1)` — an array element or a function call, decided here. */
  private evaluateIndex(expr: Extract<Expr, { kind: 'index' }>): BasicValue {
    const line = this.instrs[Math.min(this.pc, this.instrs.length - 1)]?.line ?? 0;
    const array = this.arrays.get(expr.name);
    if (array) {
      const indices = expr.args.map((arg) => this.toIndex(arg, line));
      return array.data[this.offsetOf(expr.name, array, indices, line)] ?? EMPTY;
    }
    const normalized = normalizeName(expr.name);
    const builtin = BUILTINS[normalized];
    if (builtin) {
      const values = expr.args.map((arg) => this.evaluate(arg));
      this.checkArity(expr.spelling, values.length, builtin.min, builtin.max, line);
      return builtin.fn(values, this.context);
    }
    if (PROCEDURES[normalized]) {
      throw new BasicRuntimeError(`'${expr.spelling}' does not return a value`, line);
    }
    throw new BasicRuntimeError(`Unknown array or function '${expr.spelling}'`, line);
  }

  private evaluateUnary(expr: Extract<Expr, { kind: 'unary' }>): BasicValue {
    const line = this.instrs[Math.min(this.pc, this.instrs.length - 1)]?.line ?? 0;
    const operand = this.evaluate(expr.operand);
    if (expr.op === '-') return -toNum(operand, line);
    // VB6's Not is bitwise, which is exactly why True is -1: Not -1 is 0.
    return ~Math.trunc(toNum(operand, line));
  }

  private evaluateBinary(expr: Extract<Expr, { kind: 'binary' }>): BasicValue {
    const line = this.instrs[Math.min(this.pc, this.instrs.length - 1)]?.line ?? 0;

    // VB.NET's short-circuit pair, handled before the right side is touched —
    // which is the entire difference between them and And/Or. They also return
    // a Boolean rather than a bitwise result, so `x AndAlso y` is -1 or 0 where
    // `x And y` would be the bits the two have in common.
    if (expr.op === 'ANDALSO') {
      if (toNum(this.evaluate(expr.left), line) === 0) return bool(false);
      return bool(toNum(this.evaluate(expr.right), line) !== 0);
    }
    if (expr.op === 'ORELSE') {
      if (toNum(this.evaluate(expr.left), line) !== 0) return bool(true);
      return bool(toNum(this.evaluate(expr.right), line) !== 0);
    }

    const left = this.evaluate(expr.left);
    const right = this.evaluate(expr.right);

    switch (expr.op) {
      case '&':
        return toStr(left) + toStr(right);
      case '+':
        // `+` concatenates when both sides are strings, and adds otherwise —
        // VB6's rule. `&` is the unambiguous spelling.
        if (typeof left === 'string' && typeof right === 'string') return left + right;
        return toNum(left, line) + toNum(right, line);
      case '-':
        return toNum(left, line) - toNum(right, line);
      case '*':
        return toNum(left, line) * toNum(right, line);
      case '/': {
        const divisor = toNum(right, line);
        if (divisor === 0) throw new BasicRuntimeError('Division by zero', line);
        return toNum(left, line) / divisor;
      }
      case '\\': {
        // Integer division: operands are truncated first, then the quotient.
        const divisor = Math.trunc(toNum(right, line));
        if (divisor === 0) throw new BasicRuntimeError('Division by zero', line);
        return Math.trunc(Math.trunc(toNum(left, line)) / divisor);
      }
      case 'MOD': {
        // VB6's Mod is an integer operator, so 7.5 Mod 2 is 1, not 1.5.
        const divisor = Math.trunc(toNum(right, line));
        if (divisor === 0) throw new BasicRuntimeError('Division by zero', line);
        return Math.trunc(toNum(left, line)) % divisor;
      }
      case '^':
        return toNum(left, line) ** toNum(right, line);
      case 'AND':
        return Math.trunc(toNum(left, line)) & Math.trunc(toNum(right, line));
      case 'OR':
        return Math.trunc(toNum(left, line)) | Math.trunc(toNum(right, line));
      case 'XOR':
        return Math.trunc(toNum(left, line)) ^ Math.trunc(toNum(right, line));
      default:
        return this.compare(expr.op, left, right, line);
    }
  }

  private compare(op: string, left: BasicValue, right: BasicValue, line: number): number {
    // Two strings compare as text; anything else compares as numbers, so
    // `x = 0` still works when x is Empty.
    let result: number;
    if (typeof left === 'string' && typeof right === 'string') {
      result = left < right ? -1 : left > right ? 1 : 0;
    } else {
      const a = toNum(left, line);
      const b = toNum(right, line);
      result = a < b ? -1 : a > b ? 1 : 0;
    }
    switch (op) {
      case '=':
        return bool(result === 0);
      case '<>':
        return bool(result !== 0);
      case '<':
        return bool(result < 0);
      case '>':
        return bool(result > 0);
      case '<=':
        return bool(result <= 0);
      case '>=':
        return bool(result >= 0);
      default:
        throw new BasicRuntimeError(`Unknown operator '${op}'`, line);
    }
  }
}
