// Behaviour checks for the BASIC dialect. Run with `bun run basic:check`.
//
// This repo has no test framework and `bun run build` is otherwise its whole
// automated safety net — which is fine for React components a human is about to
// look at, and useless for a language implementation, where every rule in
// README-dialect.md is a claim that either holds or does not and none of them
// are visible on screen.
//
// Deliberately dependency-free and assertion-library-free: it is a script, it
// prints what failed, and it exits non-zero. Nothing here should ever need
// installing.
//
// The host is a stub, so this exercises the language and not the instrument.
// Anything touching Modbus, the SharedArrayBuffers or Stop belongs in
// basicWorker.ts and is checked on real hardware instead.
import { BasicInterpreter } from './interpreter';
import type { BasicHost } from './builtins';

let failures = 0;
let checks = 0;

const makeHost = (out: string[], clock = { t: new Date(2026, 6, 28, 3, 4, 5).getTime() }): BasicHost => ({
  write: (t) => out.push(t),
  warn: (t) => out.push(`<warn ${t}>`),
  getAiRaw: (ch) => ch * 100,
  getAiPhy: (ch) => ch * 1.5,
  getAo: (ch) => ch * 0.25,
  getParam: (ch) => ch + 0.5,
  setAo: (ch, v) => out.push(`<setAo ${ch} ${v}>`),
  setParam: (ch, v) => out.push(`<setParam ${ch} ${v}>`),
  setAiTare: (ch) => out.push(`<tare ${ch}>`),
  notify: (m) => out.push(`<notify ${m}>`),
  now: () => clock.t,
});

function run(source: string): { text: string; sleeps: number[] } {
  const out: string[] = [];
  const sleeps: number[] = [];
  const interp = BasicInterpreter.compile(source, makeHost(out));
  for (let guard = 0; guard < 10000; guard += 1) {
    const outcome = interp.resume(Date.now() + 50);
    if (outcome.kind === 'done') return { text: out.join(''), sleeps };
    if (outcome.kind === 'sleep') sleeps.push(outcome.ms);
  }
  throw new Error('did not terminate');
}

function expect(name: string, source: string, want: string) {
  checks += 1;
  let got: string;
  try {
    got = run(source).text;
  } catch (err) {
    got = `THREW: ${(err as Error).message}`;
  }
  if (got !== want) {
    failures += 1;
    console.log(`FAIL ${name}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
  }
}

function expectThrows(name: string, source: string, fragment: string) {
  checks += 1;
  try {
    run(source);
    failures += 1;
    console.log(`FAIL ${name}: expected an error containing ${JSON.stringify(fragment)}`);
  } catch (err) {
    const message = (err as Error).message;
    if (!message.includes(fragment)) {
      failures += 1;
      console.log(`FAIL ${name}\n  want error containing ${JSON.stringify(fragment)}\n  got  ${JSON.stringify(message)}`);
    }
  }
}

// --- Print formatting (the three number-to-string conversions) -------------
expect('print positive', 'Print 5', ' 5 \n');
expect('print negative', 'Print -5', '-5 \n');
expect('print string', 'Print "hi"', 'hi\n');
expect('concat no space', 'Print "n=" & 5', 'n=5\n');
expect('str$ leading space', 'Print "[" & Str$(5) & "]"', '[ 5]\n');
expect('semicolon holds line', 'Print "a";\nPrint "b"', 'ab\n');
expect('comma zone', 'Print "a","b"', 'a             b\n');
expect('binary noise hidden', 'Print 0.1 + 0.2', ' 0.3 \n');
expect('exponent form', 'Print 1.5E-7', ' 1.5E-07 \n');
expect('empty is blank string', 'Print "[" & Undefined & "]"', '[]\n');
expect('empty is zero', 'Print Undefined + 1', ' 1 \n');

// --- operators --------------------------------------------------------------
expect('vb6 true is -1', 'Print (1 = 1)', '-1 \n');
expect('not true is 0', 'Print Not (1 = 1)', ' 0 \n');
expect('bitwise and', 'Print 5 And 3', ' 1 \n');
expect('logical and via -1', 'If (1=1) And (2=2) Then Print "y"', 'y\n');
expect('power right assoc', 'Print 2 ^ 3 ^ 2', ' 512 \n');
expect('mod binds tighter than plus', 'Print 1 + 7 Mod 4', ' 4 \n');
expect('mod is integer', 'Print 7.5 Mod 2', ' 1 \n');
expect('integer division', 'Print 7 \\ 2', ' 3 \n');
expect('unary minus power', 'Print -2 ^ 2', ' 4 \n');
expect('string compare', 'Print "abc" < "abd"', '-1 \n');
expectThrows('divide by zero', 'Print 1 / 0', 'Division by zero');

// --- control flow -----------------------------------------------------------
expect('for next', 'For I = 1 To 3\nPrint I;\nNext I', ' 1  2  3 \n');
expect('for step negative', 'For I = 3 To 1 Step -1\nPrint I;\nNext', ' 3  2  1 \n');
expect('for never runs', 'For I = 5 To 1\nPrint "x"\nNext\nPrint "done"', 'done\n');
expect('for limit evaluated once', 'N = 3\nFor I = 1 To N\nN = 99\nPrint I;\nNext', ' 1  2  3 \n');
expect('exit for', 'For I = 1 To 9\nIf I = 3 Then Exit For\nPrint I;\nNext\nPrint "e"', ' 1  2 e\n');
expect('nested for exit inner', 'For I = 1 To 2\nFor J = 1 To 9\nIf J = 2 Then Exit For\nPrint I;J;\nNext\nNext', ' 1  1  2  1 \n');
expect('while wend', 'I = 0\nWhile I < 3\nI = I + 1\nPrint I;\nWend', ' 1  2  3 \n');
expect('do while loop', 'I = 0\nDo While I < 2\nI = I + 1\nPrint I;\nLoop', ' 1  2 \n');
expect('do until loop', 'I = 0\nDo Until I >= 2\nI = I + 1\nPrint I;\nLoop', ' 1  2 \n');
expect('do loop while', 'I = 5\nDo\nI = I + 1\nPrint I;\nLoop While I < 3', ' 6 \n');
expect('do loop until', 'I = 0\nDo\nI = I + 1\nPrint I;\nLoop Until I >= 2', ' 1  2 \n');
expect('exit do', 'Do\nI = I + 1\nIf I = 2 Then Exit Do\nLoop\nPrint I', ' 2 \n');
expect('if elseif else', 'X = 5\nIf X < 3 Then\nPrint "a"\nElseIf X < 9 Then\nPrint "b"\nElse\nPrint "c"\nEnd If', 'b\n');
expect('single line if else', 'If 1 > 2 Then Print "a" Else Print "b"', 'b\n');
expect('end inside if block', 'If 1 = 1 Then\nPrint "x"\nEnd\nEnd If\nPrint "never"', 'x\n');
expect('select case', 'X = 2\nSelect Case X\nCase 1\nPrint "one"\nCase 2, 3\nPrint "two-ish"\nCase Else\nPrint "other"\nEnd Select', 'two-ish\n');
expect('select case else', 'X = 9\nSelect Case X\nCase 1\nPrint "one"\nCase Else\nPrint "other"\nEnd Select', 'other\n');
expect('goto label', 'GoTo Skip\nPrint "no"\nSkip:\nPrint "yes"', 'yes\n');
expect('line number goto', '10 Print "a"\n20 GoTo 40\n30 Print "no"\n40 Print "b"', 'a\nb\n');
expect('if then linenumber', '10 If 1 = 1 Then 30\n20 Print "no"\n30 Print "yes"', 'yes\n');
expect('gosub return', 'GoSub Sub1\nPrint "back"\nEnd\nSub1:\nPrint "in"\nReturn', 'in\nback\n');
expect('colon separated', 'A = 1 : B = 2 : Print A + B', ' 3 \n');
expectThrows('return without gosub', 'Return', 'Return without GoSub');

// --- arrays -----------------------------------------------------------------
expect('dim and index', 'Dim A(5)\nA(2) = 7\nPrint A(2)', ' 7 \n');
expect('auto dim', 'A(3) = 4\nPrint A(3)', ' 4 \n');
expect('two dimensions', 'Dim M(2,2)\nM(1,2) = 9\nPrint M(1,2)', ' 9 \n');
expect('dim as type accepted', 'Dim S As String\nS = S & "ab"\nPrint S', 'ab\n');
expectThrows('subscript range', 'Dim A(2)\nA(5) = 1', 'Subscript out of range');
expectThrows('unknown function', 'Print Nope(1)', "Unknown array or function 'Nope'");

// --- builtins ---------------------------------------------------------------
expect('sqr', 'Print Sqr(9)', ' 3 \n');
expect('int vs fix', 'Print Int(-2.5); Fix(-2.5)', '-3 -2 \n');
expect('round is bankers', 'Print Round(0.5); Round(1.5); Round(2.5)', ' 0  2  2 \n');
expect('round digits', 'Print Round(3.14159, 2)', ' 3.14 \n');
expect('log10', 'Print Log10(1000)', ' 3 \n');
expect('deg', 'Print Round(Deg(Atn(1) * 4), 6)', ' 180 \n');
expect('asin mohr coulomb', 'Print Round(Deg(Asin(0.5)), 4)', ' 30 \n');
expect('min max', 'Print Min(3, 1, 2); Max(3, 1, 2)', ' 1  3 \n');
expect('format decimals', 'Print Format(3.14159, "0.00")', '3.14\n');
expect('format pads', 'Print Format(5, "000.0")', '005.0\n');
expect('format grouping', 'Print Format(1234567.5, "#,##0.00")', '1,234,567.50\n');
expect('format hash drops', 'Print Format(1.5, "0.0##")', '1.5\n');
expect('format negative', 'Print Format(-2.345, "0.00")', '-2.35\n');
expect('left right mid', 'Print Left("abcdef", 2); Right("abcdef", 2); Mid("abcdef", 3, 2)', 'abefcd\n');
expect('instr', 'Print InStr("hello", "ll"); InStr(4, "hello", "l")', ' 3  4 \n');
expect('val', 'Print Val("12.5abc"); Val("nope")', ' 12.5  0 \n');
expect('ucase trim', 'Print "[" & UCase(Trim("  ab  ")) & "]"', '[AB]\n');
expect('chr asc', 'Print Chr(65); Asc("A")', 'A 65 \n');
expect('string$ space$', 'Print "[" & String(3, "-") & Space(2) & "]"', '[---  ]\n');
expect('cint bankers', 'Print CInt(2.5); CInt(3.5)', ' 2  4 \n');
expect('iif', 'Print IIf(1 > 0, "y", "n")', 'y\n');
expect('pi', 'Print Round(Pi, 5)', ' 3.14159 \n');
expect('timer no parens', 'Print Timer', ` ${3 * 3600 + 4 * 60 + 5} \n`);
expect('time$ date$', 'Print Time$; " "; Date$', '03:04:05 2026/07/28\n');
expect('elapsed', 'Print Elapsed', ' 0 \n');
expect('randomize reproducible', 'Randomize 42\nA = Rnd\nRandomize 42\nPrint A = Rnd', '-1 \n');
expect('rnd zero repeats', 'Randomize 1\nA = Rnd\nPrint A = Rnd(0)', '-1 \n');
expectThrows('sqr negative', 'Print Sqr(-1)', 'Sqr of a negative');
expectThrows('arity', 'Print Sqr(1, 2)', 'Wrong number of arguments');

// --- instrument API ---------------------------------------------------------
expect('get_ai_phy underscore', 'Print get_ai_phy(2)', ' 3 \n');
expect('GetAiPhy camel', 'Print GetAiPhy(2)', ' 3 \n');
expect('GetAiRaw', 'Print GetAiRaw(3)', ' 300 \n');
expect('GetAo GetParam', 'Print GetAo(4); GetParam(1)', ' 1  1.5 \n');
expect('SetAo statement', 'SetAo 1, 2.5', '<setAo 1 2.5>');
expect('SET_AO underscore', 'SET_AO 1, 2.5', '<setAo 1 2.5>');
expect('Call SetAo', 'Call SetAo(0, 1)', '<setAo 0 1>');
expect('SetAiTare', 'SetAiTare 3', '<tare 3>');
expect('SetNotify', 'SetNotify "done " & 5', '<notify done 5>');
expectThrows('bad channel', 'SetAo 1.5, 0', 'Channel must be');
expectThrows('typo statement', 'Prnt "x"', "Unknown statement or procedure 'Prnt'");
expectThrows('function as statement', 'Sqr 2', 'cannot be used as a statement');

// --- lexer niceties ---------------------------------------------------------
expect('case insensitive', 'pRiNt "a"', 'a\n');
expect('rem and tick', "REM nope\nPrint 1 ' also nope", ' 1 \n');
expect('sigils ignored', 'A$ = "x"\nPrint A', 'x\n');
expect('line continuation', 'Print 1 + _\n2', ' 3 \n');
expect('escaped quotes', 'Print "say ""hi"""', 'say "hi"\n');

// --- Const ------------------------------------------------------------------
expect('const', 'Const G = 9.81\nPrint G', ' 9.81 \n');
expect('const multiple', 'Const A = 1, B = 2\nPrint A + B', ' 3 \n');
expectThrows('const reassign', 'Const G = 9.81\nG = 1', "'G' is a constant");
expectThrows('const as for var', 'Const I = 1\nFor I = 1 To 3\nNext', "'I' is a constant");

// --- added VB6 intrinsics ---------------------------------------------------
expect('replace', 'Print Replace("a-b-c", "-", "+")', 'a+b+c\n');
expect('strreverse', 'Print StrReverse("abc")', 'cba\n');
expect('isnumeric', 'Print IsNumeric("12.5"); IsNumeric("x")', '-1  0 \n');

// --- VB.NET spellings, accepted alongside VB6's ----------------------------
expect('end while', 'I = 0\nWhile I < 2\nI = I + 1\nEnd While\nPrint I', ' 2 \n');
expect('wend still works', 'I = 0\nWhile I < 2\nI = I + 1\nWend\nPrint I', ' 2 \n');
expect('exit while', 'I = 0\nWhile 1\nI = I + 1\nIf I = 3 Then Exit While\nEnd While\nPrint I', ' 3 \n');
expect('end alone inside while', 'While 1\nEnd\nEnd While\nPrint "no"', '');
expect('compound add', 'A = 1\nA += 2\nPrint A', ' 3 \n');
expect('compound all', 'A = 10\nA -= 2\nA *= 3\nA /= 4\nA ^= 2\nPrint A', ' 36 \n');
expect('compound concat', 'S = "a"\nS &= "b"\nPrint S', 'ab\n');
expect('compound on array', 'Dim A(2)\nA(1) = 5\nA(1) += 3\nPrint A(1)', ' 8 \n');
expect('andalso is boolean', 'Print 5 AndAlso 3', '-1 \n');
expect('and stays bitwise', 'Print 5 And 3', ' 1 \n');
// Short-circuit: the right side must not run, so the guard actually guards.
expect('andalso short circuits', 'N = 0\nIf (N <> 0) AndAlso (10 / N > 1) Then Print "a"\nPrint "ok"', 'ok\n');
expect('orelse short circuits', 'N = 0\nIf (N = 0) OrElse (10 / N > 1) Then Print "ok"', 'ok\n');

// --- DoEvents: accepted, and unnecessary -----------------------------------
expect('doevents accepted', 'For I = 1 To 2\nDoEvents\nNext\nPrint "ok"', 'ok\n');

// --- Sleep is milliseconds -------------------------------------------------
expect('sleep units notice once', 'Sleep 1\nSleep 1\nPrint "x"',
  '<warn Sleep 1 waits 1 ms: Sleep takes milliseconds, not seconds. Use Sleep 1000 for 1 second(s) (line 1).>x\n');
expect('normal sleep is quiet', 'Sleep 1000\nPrint "x"', 'x\n');

// --- sleep ------------------------------------------------------------------
{
  checks += 1;
  const { text, sleeps } = run('Print "a"\nSleep 250\nPrint "b"');
  if (text !== 'a\nb\n' || sleeps.length !== 1 || sleeps[0] !== 250) {
    failures += 1;
    console.log(`FAIL sleep: text=${JSON.stringify(text)} sleeps=${JSON.stringify(sleeps)}`);
  }
}

// --- yielding: an endless loop must hand control back ----------------------
{
  checks += 1;
  const out: string[] = [];
  const interp = BasicInterpreter.compile('Do\nX = X + 1\nLoop', makeHost(out));
  const outcome = interp.resume(Date.now() + 5);
  if (outcome.kind !== 'yield') {
    failures += 1;
    console.log(`FAIL endless loop yields: got ${outcome.kind}`);
  }
}

// --- a realistic control script --------------------------------------------
expect(
  'realistic script',
  [
    "' Consolidation-style stage log",
    'Dim Peak(3)',
    'For Ch = 0 To 3',
    '  Peak(Ch) = GetAiPhy(Ch)',
    'Next Ch',
    'Total = 0',
    'For Ch = 0 To 3',
    '  Total = Total + Peak(Ch)',
    'Next Ch',
    'Print "mean="; Format(Total / 4, "0.000")',
    'If Total > 5 Then SetNotify "over " & Format(Total, "0.0")',
  ].join('\n'),
  'mean=2.250\n<notify over 9.0>',
);

console.log(`${checks - failures}/${checks} passed`);
// Reached through globalThis because this file is inside the app's tsconfig,
// which has no Node types — and adding @types/node to type one line would put
// Node's globals in scope for the whole browser bundle.
if (failures > 0) {
  (globalThis as { process?: { exit(code: number): void } }).process?.exit(1);
}
