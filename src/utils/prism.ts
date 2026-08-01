// Syntax highlighting for the Script Runner editor: Prism, with exactly the
// one grammar this app can run and nothing else.
//
// Grammars are imported individually rather than via `prismjs/components/`
// wholesale — the full set is ~300 languages, all of which would land in the
// bundle (and in the Service Worker precache, and in the exe) for no reason.
import './prismManual';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import type { ScriptLanguageId } from './scriptLanguages';

const GRAMMARS: Record<ScriptLanguageId, { grammar: Prism.Grammar; name: string }> = {
  python: { grammar: Prism.languages.python, name: 'python' },
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
