import { useSyncExternalStore } from 'react';
import { readJsonStorage, writeLocalPreference } from './cookies';

// Language of the two reading windows (Tutorial, Connector Manual).
//
// Only these windows are multilingual. The rest of the UI is English (and may
// be run through the browser's page translation); these two are long-form
// instructions read by the people wiring and running the rig, where a
// machine-translated wiring step is a hazard rather than a convenience — so
// they carry their own reviewed text instead.
//
// One choice shared by both windows and remembered across launches: someone
// who switched the Tutorial to 中文 should not meet the Manual in English.

export const DOC_LANGS = ['en', 'ja', 'zh-CN', 'zh-TW', 'es', 'ko'] as const;
export type DocLang = (typeof DOC_LANGS)[number];

/**
 * Each language named in itself, never in English: a reader looking for their
 * language scans for the word they would write.
 */
export const DOC_LANG_LABELS: Record<DocLang, string> = {
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
  ko: '한국어',
};

const DOC_LANG_KEY = 'doc_language_v1';
const DEFAULT_DOC_LANG: DocLang = 'en';

const isDocLang = (value: unknown): value is DocLang =>
  typeof value === 'string' && (DOC_LANGS as readonly string[]).includes(value);

function load(): DocLang {
  if (typeof window === 'undefined') return DEFAULT_DOC_LANG;
  const stored = readJsonStorage<string>(DOC_LANG_KEY);
  return isDocLang(stored) ? stored : DEFAULT_DOC_LANG;
}

let current: DocLang = load();
const listeners = new Set<() => void>();

export function setDocLang(next: DocLang): void {
  if (next === current) return;
  current = next;
  writeLocalPreference(DOC_LANG_KEY, next);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The shared reading-window language, re-rendering on change. */
export function useDocLang(): DocLang {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_DOC_LANG);
}

/** Narrow an arbitrary <select> value; unknown values are ignored. */
export const parseDocLang = (value: string): DocLang | null => (isDocLang(value) ? value : null);
