// The Script Runner's open documents.
//
// The editor used to hold exactly one script, keyed by
// SCRIPT_LANGUAGES[id].storageKey. That is one script per *runtime*, which is
// not how the panel is actually used: a rig ends up with a warm-up script, a
// sweep and a shutdown, and keeping three of those meant keeping two of them
// somewhere outside the app.
//
// So: tabs, shown as one strip. Each tab still carries a `language` field —
// this used to also select between Python/BASIC/Lua, and only Python remains,
// but keeping the field is what lets loadScriptTabs drop a tab persisted under
// one of the removed languages instead of needing a separate migration path.
import {
  DEFAULT_SCRIPT_LANGUAGE,
  SCRIPT_LANGUAGES,
  isScriptLanguageId,
  type ScriptLanguageId,
} from './scriptLanguages';
import { readJsonStorage, writeJsonStorage } from './cookies';

export type ScriptTab = {
  id: string;
  /** Shown on the tab. Free text; the extension is only a default. */
  name: string;
  language: ScriptLanguageId;
  code: string;
};

export const SCRIPT_TABS_STORAGE_KEY = 'scriptRunnerTabs';

/**
 * Upper bound on open tabs *per language*. Not a storage limit — it is that the
 * strip is the width of a floating window, and past a dozen it is a scrollbar
 * with no readable labels on it.
 */
export const SCRIPT_TABS_MAX = 12;

/**
 * Longest tab name, in characters. Names are the only thing telling two Python
 * scripts apart, so they are the user's to choose — but a tab is about eight
 * characters wide before it starts pushing its neighbours off the strip, and a
 * name that has to be truncated to be shown is not doing its job. Long enough
 * for `sweep-up-slow`, short enough that a dozen tabs still fit.
 */
export const SCRIPT_TAB_NAME_MAX = 24;

// Names carry no extension. `main.py` was how the default names started, from
// the habit of files — but a tab is not a file, and it sits in a strip that
// belongs to exactly one language, under a selector naming that language. The
// `.py` restated in every tab what the window says once, and it cost the widest
// part of a name that has about eight characters to work with. Names already
// stored with one are trimmed on load; see loadScriptTabs.

type StoredTabs = {
  tabs: { id: string; name: string; language: string; code: string }[];
  activeId: string;
};

let idCounter = 0;

/**
 * Unique enough to key a React list and to name a tab. Not crypto.randomUUID():
 * that is unavailable outside secure contexts, and the launcher serves this app
 * over plain HTTP to other machines on the LAN.
 */
export const newTabId = (): string => {
  idCounter += 1;
  return `tab-${Date.now().toString(36)}-${idCounter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
};

export const sanitizeTabName = (name: string): string => {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, SCRIPT_TAB_NAME_MAX);
  // An empty name would leave a tab that cannot be pointed at, so fall back to
  // the same default a new tab would have got. Typed extensions are the user's
  // business — only the names this module generates are kept bare.
  return trimmed === '' ? 'main' : trimmed;
};

/** `main`, then `main2`, … — the first name not already on a tab. */
export const defaultTabName = (language: ScriptLanguageId, existing: ScriptTab[]): string => {
  const taken = new Set(
    tabsOfLanguage(existing, language).map((tab) => tab.name.toLowerCase()),
  );
  for (let n = 1; n <= SCRIPT_TABS_MAX + 1; n += 1) {
    const candidate = `main${n === 1 ? '' : n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `main-${newTabId()}`;
};

export const createTab = (language: ScriptLanguageId, existing: ScriptTab[]): ScriptTab => ({
  id: newTabId(),
  name: defaultTabName(language, existing),
  language,
  code: SCRIPT_LANGUAGES[language].defaultScript,
});

export const tabsOfLanguage = (tabs: ScriptTab[], language: ScriptLanguageId): ScriptTab[] =>
  tabs.filter((tab) => tab.language === language);

/**
 * The open tabs, or — on the first run after this replaced the per-language
 * editors — one tab per language that had a script stored under the old keys.
 *
 * The legacy keys are left in place rather than deleted. They are a few kB, and
 * they are the only copy of that code if this version is ever rolled back.
 */
export function loadScriptTabs(): { tabs: ScriptTab[]; activeId: string } {
  const stored = readJsonStorage<StoredTabs>(SCRIPT_TABS_STORAGE_KEY) as StoredTabs | null;
  const tabs: ScriptTab[] = [];
  if (stored && Array.isArray(stored.tabs)) {
    for (const entry of stored.tabs) {
      // Also drops any tab persisted under the old 'basic'/'lua' language ids,
      // from a build that still had those languages: isScriptLanguageId now
      // only accepts 'python', so such a tab is silently skipped rather than
      // carried forward or crashing the load.
      if (!entry || typeof entry.code !== 'string' || !isScriptLanguageId(entry.language)) continue;
      tabs.push({
        id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : newTabId(),
        // `main.py` → `main` for the names this module generated back when the
        // defaults carried an extension. Only those: a name someone typed with a
        // dot in it (`sweep.slow`) survives whatever it happens to end with.
        name: sanitizeTabName(
          typeof entry.name === 'string' ? entry.name.replace(/^(main\d*)\.(py|bas|lua)$/i, '$1') : '',
        ),
        language: entry.language,
        code: entry.code,
      });
      // The cap is per language (a no-op with only one language left, but
      // harmless to keep general).
      if (tabsOfLanguage(tabs, entry.language).length > SCRIPT_TABS_MAX) tabs.pop();
    }
  }
  if (tabs.length > 0) {
    const activeId = tabs.some((tab) => tab.id === stored?.activeId) ? stored!.activeId : tabs[0].id;
    return { tabs, activeId };
  }
  return migrateLegacyTabs();
}

function migrateLegacyTabs(): { tabs: ScriptTab[]; activeId: string } {
  const tabs: ScriptTab[] = [];
  // BASIC and Lua are gone, so their old per-language storage keys
  // ('scriptRunnerCodeBasic', 'scriptRunnerCodeLua') are simply never read
  // again here — the code that used to live under them is orphaned but
  // harmless, same as any other dead localStorage key.
  const code = readJsonStorage<string>(SCRIPT_LANGUAGES[DEFAULT_SCRIPT_LANGUAGE].storageKey);
  if (typeof code === 'string') {
    tabs.push({
      id: newTabId(),
      name: defaultTabName(DEFAULT_SCRIPT_LANGUAGE, tabs),
      language: DEFAULT_SCRIPT_LANGUAGE,
      code,
    });
  }
  if (tabs.length === 0) tabs.push(createTab(DEFAULT_SCRIPT_LANGUAGE, tabs));

  // Whichever language the panel was last set to is the tab that should be in
  // front, so the window opens on the script it closed on. A stored value of
  // 'basic'/'lua' fails isScriptLanguageId now, so `active` falls through to
  // undefined and the fallback below (tabs[0]) is used instead.
  const last = readJsonStorage<string>('scriptRunnerLanguage');
  const active = isScriptLanguageId(last) ? tabs.find((tab) => tab.language === last) : undefined;
  return { tabs, activeId: (active ?? tabs[0]).id };
}

export const saveScriptTabs = (tabs: ScriptTab[], activeId: string): void => {
  writeJsonStorage(SCRIPT_TABS_STORAGE_KEY, { tabs, activeId });
};
