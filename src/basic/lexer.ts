// Tokenizer for the BASIC dialect described in src/basic/README-dialect.md.
//
// VB6-flavoured, but deliberately accepting of the neighbouring dialects the
// audience may have learned instead (N88-BASIC, QBasic): keywords and
// identifiers are case-insensitive, type sigils (`A$`, `N%`) are optional and
// ignored, leading line numbers are accepted as labels, and both `'` and `REM`
// start a comment. None of that costs anything at this layer, and each one is a
// thing a user would otherwise have typed correctly and been told was wrong.

export type TokenKind =
  | 'number'
  | 'string'
  | 'ident'
  | 'op'
  /** Statement separator: a newline or a `:`. */
  | 'eol'
  | 'eof';

export type Token = {
  kind: TokenKind;
  /** Identifiers keep their original spelling; `upper` is what code compares. */
  text: string;
  upper: string;
  value?: number;
  line: number;
};

export class BasicSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'BasicSyntaxError';
  }
}

// Longest first: `<=` must win over `<`, `<>` over `<`, and every compound
// assignment over the bare operator it is built from.
const OPERATORS = [
  '+=', '-=', '*=', '/=', '\\=', '^=', '&=',
  '<=', '>=', '<>', '=', '<', '>',
  '+', '-', '*', '/', '\\', '^', '&',
  '(', ')', ',', ';',
];

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_.]/.test(c);
// VB6/N88 type-declaration characters. Kept out of the name so `A$` and `A`
// are the same variable — this interpreter has one numeric/string Variant type,
// so the sigil carries no information worth preserving.
const isSigil = (c: string) => c === '$' || c === '%' || c === '&' || c === '!' || c === '#' || c === '@';

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const push = (kind: TokenKind, text: string, value?: number) => {
    tokens.push({ kind, text, upper: text.toUpperCase(), value, line });
  };
  // Suppress a run of blank statements so the parser never has to skip them.
  // The separator's spelling is kept: a ':' immediately after an identifier at
  // the start of a line is a GoTo label, and a newline there is not.
  const pushEol = (text: string) => {
    const prev = tokens[tokens.length - 1];
    if (prev && prev.kind === 'eol') {
      // ':' is the more specific of the two, so never let a following newline
      // overwrite it — otherwise `Retry:` alone on a line stops looking like a
      // label by the time the parser sees it.
      if (text === ':' && prev.text === '\n') { prev.text = ':'; prev.upper = ':'; }
      return;
    }
    if (tokens.length > 0) push('eol', text);
  };

  while (i < source.length) {
    const c = source[i];

    if (c === '\r') { i += 1; continue; }

    if (c === '\n') {
      pushEol('\n');
      i += 1;
      line += 1;
      continue;
    }

    if (c === ' ' || c === '\t') { i += 1; continue; }

    // Line continuation: an underscore ending a line joins it to the next.
    if (c === '_' && /^[ \t]*\r?\n/.test(source.slice(i + 1))) {
      i += 1;
      while (i < source.length && source[i] !== '\n') i += 1;
      i += 1;
      line += 1;
      continue;
    }

    if (c === "'") {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (c === ':') {
      pushEol(':');
      i += 1;
      continue;
    }

    if (c === '"') {
      i += 1;
      let text = '';
      for (;;) {
        if (i >= source.length || source[i] === '\n') {
          throw new BasicSyntaxError('Unterminated string', line);
        }
        // "" is an escaped quote, as in every Microsoft BASIC.
        if (source[i] === '"') {
          if (source[i + 1] === '"') { text += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        text += source[i];
        i += 1;
      }
      push('string', text);
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      const start = i;
      while (i < source.length && isDigit(source[i])) i += 1;
      if (source[i] === '.') {
        i += 1;
        while (i < source.length && isDigit(source[i])) i += 1;
      }
      // Exponent: 1E-3, 1.5e6. `D` is the old double-precision spelling.
      if (/[eEdD]/.test(source[i] ?? '') && /[0-9+-]/.test(source[i + 1] ?? '')) {
        i += 1;
        if (source[i] === '+' || source[i] === '-') i += 1;
        while (i < source.length && isDigit(source[i])) i += 1;
      }
      const text = source.slice(start, i);
      push('number', text, Number(text.replace(/[dD]/, 'e')));
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i])) i += 1;
      let text = source.slice(start, i);
      if (i < source.length && isSigil(source[i])) i += 1;

      // REM runs to end of line. Handled here rather than as a keyword so the
      // rest of the line is never tokenized at all.
      if (text.toUpperCase() === 'REM') {
        while (i < source.length && source[i] !== '\n') i += 1;
        continue;
      }
      // `Print` accepts a trailing `.`; identifiers do not otherwise end in one.
      text = text.replace(/\.$/, '');
      push('ident', text);
      continue;
    }

    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      push('op', op);
      i += op.length;
      continue;
    }

    throw new BasicSyntaxError(`Unexpected character '${c}'`, line);
  }

  pushEol('\n');
  push('eof', '');
  return tokens;
}
