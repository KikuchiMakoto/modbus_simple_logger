// Syntax highlighting for the Script Runner editor: Prism, with exactly the
// three grammars this app can run and nothing else.
//
// Grammars are imported individually rather than via `prismjs/components/`
// wholesale — the full set is ~300 languages, all of which would land in the
// bundle (and in the Service Worker precache, and in the exe) for no reason.
import './prismManual';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-lua';
// ORDER MATTERS: prism-vbnet is defined as `Prism.languages.extend('basic',…)`
// but does not import prism-basic itself (Prism resolves that dependency in its
// own loader, which a bundler does not use). Import them the wrong way round
// and vbnet throws at module-evaluation time — taking the whole app down before
// it renders, not just the editor.
import 'prismjs/components/prism-basic';
import 'prismjs/components/prism-vbnet';
import type { ScriptLanguageId } from './scriptLanguages';

// The Script Runner's BASIC is a VB6 dialect, so `vbnet` fits it far better
// than Prism's `basic` (which is QBasic/N88-flavoured): only vbnet treats a
// leading `'` as a comment, which is what the default script and every example
// in this app use. What it cannot know is this dialect's own vocabulary —
// `Sleep`, `SetParam`, `Elapsed` and friends highlight as plain identifiers, and
// the few VB.NET spellings the dialect accepts (`AndAlso`, `End While`) are the
// ones it gets right for free.
const GRAMMARS: Record<ScriptLanguageId, { grammar: Prism.Grammar; name: string }> = {
  python: { grammar: Prism.languages.python, name: 'python' },
  lua: { grammar: Prism.languages.lua, name: 'lua' },
  basic: { grammar: Prism.languages.vbnet, name: 'vbnet' },
};

/**
 * Highlight `code` as `language`, returning Prism's HTML.
 *
 * Falls back to escaped plain text if a grammar somehow failed to register:
 * an editor that shows the script unhighlighted is a cosmetic problem, one
 * that throws on every keystroke is a lost script.
 */
export const highlightScript = (code: string, language: ScriptLanguageId): string => {
  const entry = GRAMMARS[language];
  if (!entry?.grammar) return escapeHtml(code);
  try {
    return Prism.highlight(code, entry.grammar, entry.name);
  } catch {
    return escapeHtml(code);
  }
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
