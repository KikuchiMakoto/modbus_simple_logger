// The Script Runner's editor: a textarea with a highlighted layer behind it
// (react-simple-code-editor) and a line-number gutter.
//
// Not a full editor component (CodeMirror/Monaco): those are ~100 kB gzipped
// each, and this app precaches everything it ships — into the Service Worker
// and into the exe — so weight here is weight on every first load and every
// download. What is actually missing from a plain textarea is *reading* the
// script: which line an error names, and where a string or a comment ends.
// Highlighting and a gutter cover both at a few kB.
import { useMemo } from 'react';
import EditorImport from 'react-simple-code-editor';
import { interopDefault } from '../utils/interopDefault';
import { highlightScript } from '../utils/prism';
import type { ScriptLanguageId } from '../utils/scriptLanguages';

// Kept in one place because three things have to agree to the pixel or the
// gutter drifts from the code: the gutter rows, the highlighted <pre>, and the
// textarea. Line height and padding are set on the container and inherited (the
// editor's own styles are all `inherit`).
//
// The type is a step smaller than the panel's prose (text-xs, 12px, on an 18px
// line) because a script is read as a shape — indentation, block structure —
// more than as sentences, and the extra lines on screen are worth more here
// than the extra pixels per glyph. Iosevka stays legible well below this.
const PADDING_PX = 8;

// react-simple-code-editor ships CommonJS only (no `exports` map, no `module`
// field), so the default import can arrive wrapped as `{ default: … }` — which
// React reports as "Element type is invalid … but got: object". Same treatment
// as Plotly gets in src/plotly.ts.
const Editor = interopDefault(EditorImport);

type CodeEditorProps = {
  value: string;
  onValueChange: (value: string) => void;
  language: ScriptLanguageId;
  className?: string;
  /**
   * Frozen: the caret still moves and the text can still be selected and
   * copied, but nothing types. Used while this script is the one executing —
   * see the note on setScriptCode in useScriptRunner.
   */
  readOnly?: boolean;
};

export function CodeEditor({
  value,
  onValueChange,
  language,
  className = '',
  readOnly = false,
}: CodeEditorProps) {
  // One entry per line. A trailing newline means a real (empty) last line, which
  // is why this counts separators rather than non-empty lines.
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  // `items-start` below is load-bearing. Under flexbox's default `stretch` the
  // editor is sized to the box rather than to the script, and its own wrapper
  // (react-simple-code-editor sets `overflow: hidden` on it) then clips every
  // line past the bottom edge — while the gutter, which is not clipped, is what
  // makes the box scroll. The result is a box that scrolls the line numbers
  // away from code that cannot move with them.
  return (
    <div
      // Never translated. A page-translate pass over this box rewrites
      // identifiers, string literals and the highlighted <pre> behind the
      // textarea — and the result is a script that no longer runs, presented as
      // if it were the one the user wrote.
      translate="no"
      // The frozen state is dimmed rather than only announced in words: the
      // editor looks identical whether or not it accepts keys, and finding out
      // by typing a line that goes nowhere is the wrong way to learn it.
      className={`relative flex items-start overflow-auto rounded border font-mono text-xs leading-[1.125rem] text-slate-900 dark:text-slate-100 ${
        readOnly
          ? 'border-amber-300 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/5'
          : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800'
      } ${className}`}
    >
      {/* sticky so the numbers stay put when a long line scrolls the box
          sideways; aria-hidden because a screen reader reading the code out
          does not want "1 2 3 4" first. */}
      <div
        aria-hidden="true"
        className="sticky left-0 z-10 shrink-0 select-none border-r border-slate-200 bg-slate-100 px-2 text-right text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500"
        // Both children are content-sized now (see items-start above), so the
        // gutter needs its own minimum or its stripe stops at the last line
        // instead of running the height of the box.
        style={{ paddingTop: PADDING_PX, paddingBottom: PADDING_PX, minHeight: '100%' }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <Editor
        value={value}
        onValueChange={onValueChange}
        // The library's own readOnly, so Tab/Shift+Tab and its undo stack are
        // held back too — a `disabled` textarea would also stop the text being
        // selected and copied, which is most of what a frozen script is for.
        readOnly={readOnly}
        highlight={(code) => highlightScript(code, language)}
        padding={PADDING_PX}
        // Tab indents by two spaces, Shift+Tab outdents, both across a
        // selection — handled by the editor itself, which also records them in
        // its own undo stack (an outside handler calling setState would edit
        // behind that stack's back and desync Ctrl+Z).
        tabSize={2}
        insertSpaces
        // Code does not wrap: a wrapped line would occupy two rows against one
        // gutter number and put every number below it out of step. The box
        // scrolls sideways instead. Both layers must agree, hence both classes —
        // `!` because the library sets `pre-wrap` inline.
        preClassName="whitespace-pre!"
        textareaClassName="whitespace-pre! caret-slate-900 outline-none dark:caret-slate-100"
        // Fill the box even when the script is shorter than it, so clicking the
        // empty space below the last line still lands in the editor.
        style={{ minHeight: '100%', minWidth: 'max-content', flex: 1 }}
      />
    </div>
  );
}
