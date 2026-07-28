// Parser for the BASIC dialect. Produces a FLAT instruction list, not a tree.
//
// The flat form is the whole reason Stop works. Execution is then a program
// counter over an array, so the runner can check the interrupt byte between any
// two instructions and abandon the program wherever it happens to be — no
// unwinding, no cooperation from the script, and no way for a `Do ... Loop`
// with no exit to become unkillable. A tree walker would have to thread an
// abort check through every recursive eval instead.
//
// Expressions stay as small trees, which is safe: they contain no loops and no
// user-defined calls, so evaluating one always terminates.
import { BasicSyntaxError, tokenize, type Token } from './lexer';

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'var'; name: string }
  /**
   * `A(1)` — an array element or a function call; decided at run time.
   *
   * `name` is upper-cased for lookup (the dialect is case-insensitive);
   * `spelling` keeps what the user typed, so an error about a misspelled
   * function quotes `Sqr` back rather than `SQR`.
   */
  | { kind: 'index'; name: string; spelling: string; args: Expr[] }
  | { kind: 'unary'; op: string; operand: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr };

export type LValue = { name: string; indices: Expr[] };

export type Instr =
  | { op: 'assign'; target: LValue; value: Expr; line: number }
  | { op: 'dim'; name: string; dims: Expr[]; line: number }
  | { op: 'print'; items: { expr: Expr | null; sep: ';' | ',' | null }[]; line: number }
  | { op: 'jump'; target: number; line: number }
  | { op: 'jumpIfFalse'; cond: Expr; target: number; line: number }
  | { op: 'forInit'; name: string; from: Expr; to: Expr; step: Expr | null; exit: number; line: number }
  | { op: 'forNext'; name: string; top: number; line: number }
  | { op: 'gosub'; target: number; line: number }
  | { op: 'return'; line: number }
  | { op: 'sleep'; seconds: Expr; line: number }
  | { op: 'call'; name: string; spelling: string; args: Expr[]; line: number }
  | { op: 'end'; line: number };

export type Program = {
  instrs: Instr[];
  /** Source line for each instruction index, for error messages. */
  labels: Map<string, number>;
};

// Words that can never be a variable name, so `Next I` does not parse `Next` as
// an assignment target and a typo'd keyword fails loudly instead of silently
// becoming a variable.
const RESERVED = new Set([
  'IF', 'THEN', 'ELSE', 'ELSEIF', 'END', 'FOR', 'TO', 'STEP', 'NEXT', 'WHILE', 'WEND',
  'DO', 'LOOP', 'UNTIL', 'SELECT', 'CASE', 'GOTO', 'GOSUB', 'RETURN', 'DIM', 'AS',
  'PRINT', 'SLEEP', 'STOP', 'EXIT', 'LET', 'CALL', 'REM', 'AND', 'OR', 'NOT', 'XOR', 'MOD',
]);

type LoopFrame = {
  kind: 'for' | 'do' | 'while';
  /** Indices of `jump` instructions emitted by `Exit For` / `Exit Do`. */
  exits: number[];
};

class Parser {
  private pos = 0;
  private readonly instrs: Instr[] = [];
  private readonly labels = new Map<string, number>();
  private readonly gotoFixups: { index: number; label: string; line: number }[] = [];
  private readonly loops: LoopFrame[] = [];

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    return this.tokens[Math.min(this.pos++, this.tokens.length - 1)];
  }

  private get line(): number {
    return this.peek().line;
  }

  private atKeyword(...words: string[]): boolean {
    const t = this.peek();
    return t.kind === 'ident' && words.includes(t.upper);
  }

  private takeKeyword(...words: string[]): boolean {
    if (!this.atKeyword(...words)) return false;
    this.pos += 1;
    return true;
  }

  private expectKeyword(word: string): void {
    if (!this.takeKeyword(word)) {
      throw new BasicSyntaxError(`Expected ${word}, found '${this.peek().text || 'end of line'}'`, this.line);
    }
  }

  private atOp(...ops: string[]): boolean {
    const t = this.peek();
    return t.kind === 'op' && ops.includes(t.text);
  }

  private takeOp(...ops: string[]): boolean {
    if (!this.atOp(...ops)) return false;
    this.pos += 1;
    return true;
  }

  private expectOp(op: string): void {
    if (!this.takeOp(op)) {
      throw new BasicSyntaxError(`Expected '${op}', found '${this.peek().text || 'end of line'}'`, this.line);
    }
  }

  private endOfStatement(): boolean {
    const t = this.peek();
    if (t.kind === 'eol' || t.kind === 'eof') return true;
    // `Else` ends a statement as surely as a newline does. Without this, the
    // single-line `If a Then Print "x" Else Print "y"` fed `Else` to parsePrint
    // as another thing to print, and the whole form — the one an N88 or QBasic
    // user reaches for first — failed to parse. No statement may legitimately
    // contain a bare Else, so this is safe everywhere, and the block form still
    // stops at Else in parseBlock before a statement is ever started.
    return t.kind === 'ident' && t.upper === 'ELSE';
  }

  private expectEnd(): void {
    if (!this.endOfStatement()) {
      throw new BasicSyntaxError(`Unexpected '${this.peek().text}'`, this.line);
    }
  }

  private skipEols(): void {
    while (this.peek().kind === 'eol') this.pos += 1;
  }

  private emit(instr: Instr): number {
    this.instrs.push(instr);
    return this.instrs.length - 1;
  }

  // --- expressions -------------------------------------------------------
  // Precedence, loosest first: OR/XOR, AND, NOT, comparison, & , +-, */\ MOD, ^, unary
  // This is VB6's order. `MOD` binding tighter than `+` is the one most people
  // never think about and would notice if it were wrong.

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'ident' && (t.upper === 'OR' || t.upper === 'XOR')) {
        this.pos += 1;
        left = { kind: 'binary', op: t.upper, left, right: this.parseAnd() };
      } else return left;
    }
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.atKeyword('AND')) {
      this.pos += 1;
      left = { kind: 'binary', op: 'AND', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.takeKeyword('NOT')) return { kind: 'unary', op: 'NOT', operand: this.parseNot() };
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseConcat();
    while (this.atOp('=', '<>', '<', '>', '<=', '>=')) {
      const op = this.next().text;
      left = { kind: 'binary', op, left, right: this.parseConcat() };
    }
    return left;
  }

  private parseConcat(): Expr {
    let left = this.parseAdditive();
    while (this.atOp('&')) {
      this.pos += 1;
      left = { kind: 'binary', op: '&', left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.atOp('+', '-')) {
      const op = this.next().text;
      left = { kind: 'binary', op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parsePower();
    for (;;) {
      if (this.atOp('*', '/', '\\')) {
        const op = this.next().text;
        left = { kind: 'binary', op, left, right: this.parsePower() };
      } else if (this.atKeyword('MOD')) {
        this.pos += 1;
        left = { kind: 'binary', op: 'MOD', left, right: this.parsePower() };
      } else return left;
    }
  }

  private parsePower(): Expr {
    const left = this.parseUnary();
    // Right-associative, as in VB6: 2^3^2 is 2^(3^2).
    if (this.takeOp('^')) return { kind: 'binary', op: '^', left, right: this.parsePower() };
    return left;
  }

  private parseUnary(): Expr {
    if (this.takeOp('-')) return { kind: 'unary', op: '-', operand: this.parseUnary() };
    if (this.takeOp('+')) return this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === 'number') { this.pos += 1; return { kind: 'num', value: t.value! }; }
    if (t.kind === 'string') { this.pos += 1; return { kind: 'str', value: t.text }; }
    if (this.takeOp('(')) {
      const inner = this.parseExpr();
      this.expectOp(')');
      return inner;
    }
    if (t.kind === 'ident') {
      if (RESERVED.has(t.upper)) {
        throw new BasicSyntaxError(`'${t.text}' is a keyword and cannot be used here`, t.line);
      }
      this.pos += 1;
      if (this.atOp('(')) {
        this.pos += 1;
        const args: Expr[] = [];
        if (!this.atOp(')')) {
          do { args.push(this.parseExpr()); } while (this.takeOp(','));
        }
        this.expectOp(')');
        return { kind: 'index', name: t.upper, spelling: t.text, args };
      }
      return { kind: 'var', name: t.upper };
    }
    throw new BasicSyntaxError(`Expected a value, found '${t.text || 'end of line'}'`, t.line);
  }

  // --- statements --------------------------------------------------------

  parseProgram(): Program {
    this.skipEols();
    while (this.peek().kind !== 'eof') {
      this.parseStatement();
      if (!this.endOfStatement()) {
        throw new BasicSyntaxError(`Unexpected '${this.peek().text}'`, this.line);
      }
      this.skipEols();
    }
    this.emit({ op: 'end', line: this.line });

    for (const fixup of this.gotoFixups) {
      const target = this.labels.get(fixup.label);
      if (target === undefined) {
        throw new BasicSyntaxError(`Undefined label '${fixup.label}'`, fixup.line);
      }
      const instr = this.instrs[fixup.index];
      if (instr.op === 'jump' || instr.op === 'gosub') instr.target = target;
    }
    return { instrs: this.instrs, labels: this.labels };
  }

  /**
   * Is the next token one of `stops`?
   *
   * `END` is special-cased: it both closes a block (`End If`, `End Select`) and
   * is a statement in its own right that terminates the program. Treating a
   * bare `End` as a block terminator made the perfectly ordinary
   * `If done Then` / `End` / `End If` a syntax error.
   */
  private atBlockEnd(stops: string[]): boolean {
    if (!this.atKeyword(...stops)) return false;
    if (this.peek().upper !== 'END') return true;
    const after = this.peek(1);
    return after.kind === 'ident' && (after.upper === 'IF' || after.upper === 'SELECT');
  }

  /** Parse statements until one of `stops` is the next keyword. */
  private parseBlock(stops: string[]): void {
    this.skipEols();
    while (!this.atBlockEnd(stops)) {
      if (this.peek().kind === 'eof') {
        throw new BasicSyntaxError(`Expected ${stops.join(' or ')}`, this.line);
      }
      this.parseStatement();
      if (!this.endOfStatement()) {
        throw new BasicSyntaxError(`Unexpected '${this.peek().text}'`, this.line);
      }
      this.skipEols();
    }
  }

  private parseStatement(): void {
    const line = this.line;
    const t = this.peek();

    // A bare integer at the start of a statement is an old-style line number.
    // Recorded as a label so GOTO can find it, then ignored.
    if (t.kind === 'number' && Number.isInteger(t.value) && this.peek(1).kind !== 'op') {
      this.labels.set(t.text, this.instrs.length);
      this.pos += 1;
      if (this.endOfStatement()) return;
      return this.parseStatement();
    }

    // `Retry:` — a label. `:` is lexed as an end-of-statement, so the only
    // thing that separates this from the bare procedure call `Retry` is which
    // separator the lexer recorded; that is why pushEol() keeps the spelling.
    // The eol is deliberately left unconsumed, so parseProgram's expectEnd()
    // sees a well-formed statement.
    if (t.kind === 'ident' && !RESERVED.has(t.upper)
        && this.peek(1).kind === 'eol' && this.peek(1).text === ':') {
      this.labels.set(t.upper, this.instrs.length);
      this.pos += 1;
      return;
    }

    if (t.kind === 'ident') {
      switch (t.upper) {
        case 'LET': this.pos += 1; return this.parseAssignment(line);
        case 'DIM': return this.parseDim(line);
        case 'PRINT': return this.parsePrint(line);
        case 'IF': return this.parseIf(line);
        case 'FOR': return this.parseFor(line);
        case 'DO': return this.parseDo(line);
        case 'WHILE': return this.parseWhile(line);
        case 'SELECT': return this.parseSelect(line);
        case 'GOTO': return this.parseGoto(line, 'jump');
        case 'GOSUB': return this.parseGoto(line, 'gosub');
        case 'RETURN': this.pos += 1; this.emit({ op: 'return', line }); return;
        case 'SLEEP': return this.parseSleep(line);
        case 'EXIT': return this.parseExit(line);
        case 'STOP': this.pos += 1; this.emit({ op: 'end', line }); return;
        case 'END': this.pos += 1; this.emit({ op: 'end', line }); return;
        case 'CALL': {
          this.pos += 1;
          const name = this.next();
          if (name.kind !== 'ident') throw new BasicSyntaxError('Expected a procedure name after Call', line);
          const args: Expr[] = [];
          if (this.takeOp('(')) {
            if (!this.atOp(')')) { do { args.push(this.parseExpr()); } while (this.takeOp(',')); }
            this.expectOp(')');
          }
          this.emit({ op: 'call', name: name.upper, spelling: name.text, args, line });
          return;
        }
        default: break;
      }
      return this.parseAssignmentOrCall(line);
    }

    throw new BasicSyntaxError(`Unexpected '${t.text || 'end of line'}'`, line);
  }

  /**
   * `X = 1`, `A(2) = 3`, or a statement-form procedure call (`SetAo 0, 1.5`).
   *
   * Distinguished by looking for a top-level `=`: in a call there is none, and
   * a subscripted assignment's `=` sits outside the parentheses.
   */
  private parseAssignmentOrCall(line: number): void {
    const start = this.pos;
    const name = this.next();
    let depth = 0;
    let isAssignment = false;
    for (let i = this.pos; i < this.tokens.length; i += 1) {
      const tok = this.tokens[i];
      if (tok.kind === 'eol' || tok.kind === 'eof') break;
      if (tok.kind === 'op') {
        if (tok.text === '(') depth += 1;
        else if (tok.text === ')') depth -= 1;
        else if (tok.text === '=' && depth === 0) { isAssignment = true; break; }
      }
    }
    this.pos = start;
    if (isAssignment) return this.parseAssignment(line);

    this.pos += 1;
    const args: Expr[] = [];
    if (!this.endOfStatement()) {
      do { args.push(this.parseExpr()); } while (this.takeOp(','));
    }
    this.emit({ op: 'call', name: name.upper, spelling: name.text, args, line });
  }

  private parseAssignment(line: number): void {
    const name = this.next();
    if (name.kind !== 'ident' || RESERVED.has(name.upper)) {
      throw new BasicSyntaxError(`Cannot assign to '${name.text}'`, line);
    }
    const indices: Expr[] = [];
    if (this.takeOp('(')) {
      if (!this.atOp(')')) { do { indices.push(this.parseExpr()); } while (this.takeOp(',')); }
      this.expectOp(')');
    }
    this.expectOp('=');
    const value = this.parseExpr();
    this.emit({ op: 'assign', target: { name: name.upper, indices }, value, line });
  }

  private parseDim(line: number): void {
    this.expectKeyword('DIM');
    do {
      const name = this.next();
      if (name.kind !== 'ident') throw new BasicSyntaxError('Expected a variable name after Dim', line);
      const dims: Expr[] = [];
      if (this.takeOp('(')) {
        if (!this.atOp(')')) { do { dims.push(this.parseExpr()); } while (this.takeOp(',')); }
        this.expectOp(')');
      }
      // `As Double` and friends are accepted and discarded: there is one
      // Variant-ish value type here, so the annotation has nothing to change.
      // Rejecting it would fail programs that are correct VB6.
      if (this.takeKeyword('AS')) this.next();
      this.emit({ op: 'dim', name: name.upper, dims, line });
    } while (this.takeOp(','));
  }

  private parsePrint(line: number): void {
    this.expectKeyword('PRINT');
    const items: { expr: Expr | null; sep: ';' | ',' | null }[] = [];
    while (!this.endOfStatement()) {
      if (this.atOp(';', ',')) {
        const sep = this.next().text as ';' | ',';
        items.push({ expr: null, sep });
        continue;
      }
      const expr = this.parseExpr();
      let sep: ';' | ',' | null = null;
      if (this.atOp(';', ',')) sep = this.next().text as ';' | ',';
      items.push({ expr, sep });
    }
    this.emit({ op: 'print', items, line });
  }

  private parseSleep(line: number): void {
    this.expectKeyword('SLEEP');
    this.emit({ op: 'sleep', seconds: this.parseExpr(), line });
  }

  private parseGoto(line: number, op: 'jump' | 'gosub'): void {
    this.pos += 1;
    const target = this.next();
    if (target.kind !== 'ident' && target.kind !== 'number') {
      throw new BasicSyntaxError('Expected a label after GoTo/GoSub', line);
    }
    const index = this.emit(op === 'jump'
      ? { op: 'jump', target: -1, line }
      : { op: 'gosub', target: -1, line });
    this.gotoFixups.push({ index, label: target.kind === 'number' ? target.text : target.upper, line });
  }

  private parseExit(line: number): void {
    this.expectKeyword('EXIT');
    const what = this.next();
    const kind = what.upper === 'FOR' ? 'for' : what.upper === 'DO' ? 'do' : null;
    if (!kind) throw new BasicSyntaxError("Expected 'For' or 'Do' after Exit", line);
    // Innermost matching loop. A `Exit For` inside a Do inside a For should
    // leave the For, so search outwards rather than taking the top of stack.
    for (let i = this.loops.length - 1; i >= 0; i -= 1) {
      if (this.loops[i].kind === kind || (kind === 'do' && this.loops[i].kind === 'while')) {
        this.loops[i].exits.push(this.emit({ op: 'jump', target: -1, line }));
        return;
      }
    }
    throw new BasicSyntaxError(`Exit ${what.text} outside of a matching loop`, line);
  }

  /** Point every `Exit` recorded in `frame` at the instruction after the loop. */
  private closeLoop(frame: LoopFrame): void {
    const after = this.instrs.length;
    for (const index of frame.exits) {
      const instr = this.instrs[index];
      if (instr.op === 'jump') instr.target = after;
    }
  }

  /**
   * The body of a single-line `If ... Then X` / `Else X`.
   *
   * A bare line number there is an implied GoTo (`IF A>1 THEN 100`), which is
   * how every line-numbered BASIC writes a conditional branch. Without this it
   * would be read as parseStatement's line-number *label*, silently redefining
   * a label instead of jumping to one.
   */
  private parseThenBranch(line: number): void {
    const t = this.peek();
    if (t.kind === 'number' && this.peek(1).kind !== 'op') {
      this.pos += 1;
      const index = this.emit({ op: 'jump', target: -1, line });
      this.gotoFixups.push({ index, label: t.text, line });
      return;
    }
    this.parseStatement();
  }

  private parseIf(line: number): void {
    this.expectKeyword('IF');
    const cond = this.parseExpr();
    this.expectKeyword('THEN');

    // Single-line form: `If x > 1 Then y = 2 [Else y = 3]`. The block form is
    // the one with nothing but an end-of-line after Then.
    if (!this.endOfStatement()) {
      const skipThen = this.emit({ op: 'jumpIfFalse', cond, target: -1, line });
      this.parseThenBranch(line);
      if (this.takeKeyword('ELSE')) {
        const skipElse = this.emit({ op: 'jump', target: -1, line });
        (this.instrs[skipThen] as { target: number }).target = this.instrs.length;
        this.parseThenBranch(line);
        (this.instrs[skipElse] as { target: number }).target = this.instrs.length;
      } else {
        (this.instrs[skipThen] as { target: number }).target = this.instrs.length;
      }
      return;
    }

    // Block form. Every branch's trailing jump lands after End If, patched once
    // the whole chain is known.
    const endJumps: number[] = [];
    let condJump = this.emit({ op: 'jumpIfFalse', cond, target: -1, line });
    this.parseBlock(['ELSEIF', 'ELSE', 'END']);

    for (;;) {
      if (this.atKeyword('ELSEIF')) {
        const elseIfLine = this.line;
        this.pos += 1;
        endJumps.push(this.emit({ op: 'jump', target: -1, line: elseIfLine }));
        (this.instrs[condJump] as { target: number }).target = this.instrs.length;
        const nextCond = this.parseExpr();
        this.expectKeyword('THEN');
        condJump = this.emit({ op: 'jumpIfFalse', cond: nextCond, target: -1, line: elseIfLine });
        this.parseBlock(['ELSEIF', 'ELSE', 'END']);
        continue;
      }
      if (this.atKeyword('ELSE')) {
        const elseLine = this.line;
        this.pos += 1;
        endJumps.push(this.emit({ op: 'jump', target: -1, line: elseLine }));
        (this.instrs[condJump] as { target: number }).target = this.instrs.length;
        condJump = -1;
        this.parseBlock(['END']);
      }
      break;
    }

    this.expectKeyword('END');
    this.expectKeyword('IF');
    const after = this.instrs.length;
    if (condJump >= 0) (this.instrs[condJump] as { target: number }).target = after;
    for (const index of endJumps) (this.instrs[index] as { target: number }).target = after;
  }

  private parseFor(line: number): void {
    this.expectKeyword('FOR');
    const name = this.next();
    if (name.kind !== 'ident') throw new BasicSyntaxError('Expected a loop variable after For', line);
    this.expectOp('=');
    const from = this.parseExpr();
    this.expectKeyword('TO');
    const to = this.parseExpr();
    const step = this.takeKeyword('STEP') ? this.parseExpr() : null;

    const init = this.emit({ op: 'forInit', name: name.upper, from, to, step, exit: -1, line });
    const top = this.instrs.length;
    const frame: LoopFrame = { kind: 'for', exits: [] };
    this.loops.push(frame);
    this.parseBlock(['NEXT']);
    this.loops.pop();
    this.expectKeyword('NEXT');
    // `Next` may name its variable or not; if it does, it must be the right one.
    if (this.peek().kind === 'ident' && !RESERVED.has(this.peek().upper)) {
      const named = this.next();
      if (named.upper !== name.upper) {
        throw new BasicSyntaxError(`Next ${named.text} does not match For ${name.text}`, line);
      }
    }
    this.emit({ op: 'forNext', name: name.upper, top, line });
    (this.instrs[init] as { exit: number }).exit = this.instrs.length;
    this.closeLoop(frame);
  }

  private parseWhile(line: number): void {
    this.expectKeyword('WHILE');
    const top = this.instrs.length;
    const cond = this.parseExpr();
    const exit = this.emit({ op: 'jumpIfFalse', cond, target: -1, line });
    const frame: LoopFrame = { kind: 'while', exits: [] };
    this.loops.push(frame);
    this.parseBlock(['WEND']);
    this.loops.pop();
    this.expectKeyword('WEND');
    this.emit({ op: 'jump', target: top, line });
    (this.instrs[exit] as { target: number }).target = this.instrs.length;
    this.closeLoop(frame);
  }

  /** `Do [While|Until c]` ... `Loop [While|Until c]`, all four combinations. */
  private parseDo(line: number): void {
    this.expectKeyword('DO');
    const top = this.instrs.length;
    let headExit = -1;
    if (this.takeKeyword('WHILE')) {
      headExit = this.emit({ op: 'jumpIfFalse', cond: this.parseExpr(), target: -1, line });
    } else if (this.takeKeyword('UNTIL')) {
      const cond = this.parseExpr();
      headExit = this.emit({
        op: 'jumpIfFalse',
        cond: { kind: 'unary', op: 'NOT', operand: cond },
        target: -1,
        line,
      });
    }

    const frame: LoopFrame = { kind: 'do', exits: [] };
    this.loops.push(frame);
    this.parseBlock(['LOOP']);
    this.loops.pop();
    this.expectKeyword('LOOP');

    if (this.takeKeyword('WHILE')) {
      const cond = this.parseExpr();
      this.emit({ op: 'jumpIfFalse', cond, target: this.instrs.length + 2, line });
      this.emit({ op: 'jump', target: top, line });
    } else if (this.takeKeyword('UNTIL')) {
      const cond = this.parseExpr();
      this.emit({ op: 'jumpIfFalse', cond, target: top, line });
    } else {
      this.emit({ op: 'jump', target: top, line });
    }

    if (headExit >= 0) (this.instrs[headExit] as { target: number }).target = this.instrs.length;
    this.closeLoop(frame);
  }

  private parseSelect(line: number): void {
    this.expectKeyword('SELECT');
    this.expectKeyword('CASE');
    const subject = this.parseExpr();
    // Held in a hidden variable so the subject expression is evaluated once,
    // not once per Case — it may call GetAiPhy().
    const temp = `__SELECT${this.loops.length}_${this.instrs.length}`;
    this.emit({ op: 'assign', target: { name: temp, indices: [] }, value: subject, line });
    this.skipEols();

    const endJumps: number[] = [];
    let prevCondJump = -1;
    while (this.atKeyword('CASE')) {
      const caseLine = this.line;
      this.pos += 1;
      if (prevCondJump >= 0) {
        (this.instrs[prevCondJump] as { target: number }).target = this.instrs.length;
        prevCondJump = -1;
      }
      if (this.takeKeyword('ELSE')) {
        this.parseBlock(['CASE', 'END']);
        break;
      }
      // `Case 1, 2, 3` — any match wins.
      let cond: Expr | null = null;
      do {
        const value = this.parseExpr();
        const test: Expr = { kind: 'binary', op: '=', left: { kind: 'var', name: temp }, right: value };
        cond = cond === null ? test : { kind: 'binary', op: 'OR', left: cond, right: test };
      } while (this.takeOp(','));
      prevCondJump = this.emit({ op: 'jumpIfFalse', cond: cond!, target: -1, line: caseLine });
      this.parseBlock(['CASE', 'END']);
      endJumps.push(this.emit({ op: 'jump', target: -1, line: caseLine }));
    }

    this.expectKeyword('END');
    this.expectKeyword('SELECT');
    const after = this.instrs.length;
    if (prevCondJump >= 0) (this.instrs[prevCondJump] as { target: number }).target = after;
    for (const index of endJumps) (this.instrs[index] as { target: number }).target = after;
  }
}

export function parse(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}
