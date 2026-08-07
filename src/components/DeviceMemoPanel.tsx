// A notepad for the rig, and nothing more.
//
// No fields, no validation, no schema: see deviceMemo.ts for why. The window's
// whole job is to be a textarea that is always there and always writable.
//
// Deliberately NOT locked while a script runs, which every other editing panel
// in the app is. The lock exists where an edit changes what the running script
// reads — a calibration coefficient, a Param value — and this text changes
// nothing the runner can see. The moment a memo is most worth writing is the
// moment something surprising happens on the rig, and that moment is during a
// run.
import { useRef } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { DEVICE_MEMO_MAX, DEVICE_MEMO_TEMPLATE, deviceMemoFileName } from '../utils/deviceMemo';

export function DeviceMemoPanel({
  open,
  onClose,
  memo,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  memo: string;
  onChange: (memo: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Plain .txt, UTF-8, the text exactly as typed. Not JSON and not a wrapper
  // format: the file is worth having precisely because someone can open it in
  // Notepad on the machine next to the rig, print it, and put it in the folder
  // with the test data. Anything that has to be parsed to be read would defeat
  // that.
  const exportMemo = () => {
    const blob = new Blob([memo], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = deviceMemoFileName();
    anchor.click();
    // Not revoked in the same tick: Chromium starts the download from the URL
    // asynchronously after click(), and revoking immediately cancels it.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const importMemo = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      window.alert(`Could not read "${file.name}": ${(err as Error).message}`);
      return;
    }
    // Confirmed, and only when there is something to lose. Import replaces the
    // whole memo — the file is a restore of one rig's notes, not an addition to
    // another's — and this is the one control in the window that can destroy
    // text the user cannot get back.
    if (memo.trim() !== '' && !window.confirm('Replace the current memo with this file?')) {
      return;
    }
    if (text.length > DEVICE_MEMO_MAX) {
      window.alert(
        `"${file.name}" is longer than the ${DEVICE_MEMO_MAX} characters the memo holds. It will be cut to fit.`,
      );
    }
    onChange(text.slice(0, DEVICE_MEMO_MAX));
  };

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Device Memo"
      // Says where the text goes, because that is the part a notepad cannot
      // show by itself: someone who does not know it is copied into the prompt
      // has no reason to write anything here rather than on a sticky note.
      subtitle="Free notes about this rig · any language · included in Copy AI Prompt"
      defaultWidth={520}
      defaultHeight={480}
      headerActions={
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared first: picking the same file twice in a row fires no
              // change event otherwise.
              event.target.value = '';
              if (file) void importMemo(file);
            }}
          />
          <button
            type="button"
            className="button-secondary py-0.5 text-[0.7rem]"
            onClick={() => fileInputRef.current?.click()}
            title="Replace the memo with a .txt file (UTF-8)"
          >
            Import
          </button>
          <button
            type="button"
            className="button-secondary py-0.5 text-[0.7rem]"
            onClick={exportMemo}
            disabled={memo === ''}
            title="Download the memo as a UTF-8 .txt file"
          >
            Export
          </button>
          {/* Only offered into an empty box. Overwriting notes someone already
              wrote is not something a header button should be able to do by
              accident, and "insert at the cursor" would leave the headings
              interleaved with the text they were meant to organise. */}
          {memo.trim() === '' && (
            <button
              type="button"
              className="button-secondary py-0.5 text-[0.7rem]"
              onClick={() => onChange(DEVICE_MEMO_TEMPLATE)}
              title="Fill the empty memo with headings for the things worth recording"
            >
              Template
            </button>
          )}
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-1.5">
        <textarea
          // Never translated. The whole point of this box is that it holds the
          // user's own words, in their own language, and gets copied verbatim
          // into the AI prompt — a translation layer rewriting it would change
          // what the assistant is told the machine is. It also protects the
          // placeholder, which is deliberately more than one language.
          translate="no"
          value={memo}
          onChange={(e) => onChange(e.target.value.slice(0, DEVICE_MEMO_MAX))}
          spellCheck={false}
          // "Any language" is the rule; the scripts after it are only evidence
          // that the box means it. Naming one language would have made it a
          // list to be a member of — the reader whose language is missing then
          // reads the list, not the rule. But an English-only sentence granting
          // permission is still an English box asking for English, so the
          // sentence has to be visibly not-only-English.
          //
          // The rest of the app is in English and stays that way; this is the
          // one field whose content is the user's own words, and rough notes in
          // a first language beat careful notes in a second — or, far more
          // likely, no notes at all.
          placeholder="What this machine is, what is on each channel, which way is positive, what the limits are, what was calibrated and when.&#10;&#10;Any language — 日本語 / 中文 / English / … Rough notes beat none."
          className="min-h-0 w-full flex-1 resize-none rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs leading-relaxed text-slate-800 outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        {/* The counter appears only once it is close enough to matter: sitting
            under an empty box it is a limit announcing itself to someone who
            will never reach it. */}
        <div className="flex justify-between text-[0.65rem] text-slate-500 dark:text-slate-400">
          <span>Saved as you type, in this browser only — Export for a copy that leaves it.</span>
          {memo.length > DEVICE_MEMO_MAX * 0.8 && (
            <span>
              {memo.length} / {DEVICE_MEMO_MAX}
            </span>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
