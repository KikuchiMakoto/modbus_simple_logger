import { NativeSelect } from '@/components/ui/native-select';
import { DOC_LANGS, DOC_LANG_LABELS, parseDocLang, setDocLang, useDocLang } from '../utils/docLanguage';

/**
 * Language picker for the Tutorial and Connector Manual headers. A dropdown
 * rather than the old EN/JA toggle: six languages side by side do not fit a
 * window header, and a native select also works at every UI scale.
 */
export function DocLanguageSelect({ label }: { label: string }) {
  const lang = useDocLang();
  return (
    <NativeSelect
      value={lang}
      onChange={(e) => {
        const next = parseDocLang(e.target.value);
        if (next) setDocLang(next);
      }}
      aria-label={label}
      // The language names must reach the reader as written.
      translate="no"
      className="dark:border-slate-600 dark:bg-slate-700"
    >
      {DOC_LANGS.map((value) => (
        <option key={value} value={value}>
          {DOC_LANG_LABELS[value]}
        </option>
      ))}
    </NativeSelect>
  );
}
