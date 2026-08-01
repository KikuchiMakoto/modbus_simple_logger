import { useState } from 'react';
import type { useScriptRunner } from '../hooks/useScriptRunner';
import { CodeEditor } from './CodeEditor';
import { CollapseButton } from './CollapseButton';
import {
  SCRIPT_LANGUAGES,
  SCRIPT_LANGUAGE_LIST,
  buildAiPrompt,
} from '../utils/scriptLanguages';
import { SCRIPT_TAB_NAME_MAX } from '../utils/scriptTabs';
import { FloatingWindow } from './FloatingWindow';
import { HoldToConfirm } from './HoldToConfirm';

type ChannelLabels = {
  ai: string[];
  ao: string[];
  param: string[];
};

type ScriptRunnerPanelProps = {
  open: boolean;
  onClose: () => void;
  scriptRunner: ReturnType<typeof useScriptRunner>;
  channelLabels: ChannelLabels;
};

export function ScriptRunnerPanel({
  open,
  onClose,
  scriptRunner,
  channelLabels,
}: ScriptRunnerPanelProps) {
  const [promptCopied, setPromptCopied] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  // Which tab is being renamed, and the text so far. Renaming is inline because
  // the name is the only thing telling two Python tabs apart, and a dialog for
  // one field is more ceremony than the edit deserves.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // `tabs` is the selected language's strip only; `runningTab` comes from the
  // hook because the script executing may belong to a strip that is not on
  // screen.
  const { tabs, activeTabId, runningTabId, runningTab } = scriptRunner;
  const language = SCRIPT_LANGUAGES[scriptRunner.scriptLanguage];

  const commitRename = () => {
    if (renamingId) scriptRunner.renameTab(renamingId, renameDraft);
    setRenamingId(null);
  };

  // The code in a tab exists nowhere else — there is no file behind it and no
  // way back once the tab is gone. Untouched example scripts are the one case
  // worth closing without a question: nothing is lost that "+" cannot recreate.
  const requestCloseTab = (id: string) => {
    const tab = tabs.find((entry) => entry.id === id);
    if (!tab) return;
    const untouched = tab.code === SCRIPT_LANGUAGES[tab.language].defaultScript;
    if (untouched || window.confirm(`Close "${tab.name}"? Its script is discarded.`)) {
      scriptRunner.closeTab(id);
    }
  };

  const copyAiPrompt = () => {
    navigator.clipboard.writeText(buildAiPrompt(language, channelLabels)).then(() => {
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1500);
    });
  };

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Script Runner"
      subtitle={language.runtime}
      defaultWidth={640}
      defaultHeight={620}
      headerActions={
        <>
          {/* The language belongs up here with Run/Stop, not in the body: it
              selects which set of scripts the window is showing at all, which
              makes it chrome in the same sense the title is — and every row it
              does not occupy below is a row of editor.

              Frozen for the length of a run, which is what keeps the executing
              script visible: tabs can only be paged within one language, so
              while the selector cannot move, the running tab is always in the
              strip on screen, marked. Nothing then has to explain in words
              where the run went. */}
          <select
            value={scriptRunner.scriptLanguage}
            onChange={(event) =>
              scriptRunner.setScriptLanguage(
                event.target.value as typeof scriptRunner.scriptLanguage,
              )
            }
            disabled={scriptRunner.scriptRunning}
            className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            aria-label="Script language"
            title={
              scriptRunner.scriptRunning
                ? 'Stop the script to switch language'
                : "Which language's scripts this window shows"
            }
          >
            {SCRIPT_LANGUAGE_LIST.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          {/* Was a slide-to-confirm, which cost the width of a track this header
              no longer has to spare. Held instead of swiped: the gesture is
              smaller but it is still a gesture, which is what this needs — it
              discards work that exists nowhere else, and there is no undo behind
              it.

              It sits to the LEFT of Run/Stop, which keeps Run/Stop as the
              control nearest the window's edge — the one reached for in a
              hurry, and the one whose position should not move. */}
          <HoldToConfirm
            label="Clear"
            holdingLabel="Hold…"
            onConfirm={scriptRunner.clearScriptCode}
            disabled={!scriptRunner.scriptEditable}
            // .button-danger carries no disabled state of its own, and a
            // control that is dead while a script runs has to look it.
            className="button-danger py-1 text-xs disabled:opacity-50"
            title={`Hold to reset ${scriptRunner.activeTab.name} to the example script`}
          />
          <button
            type="button"
            className={
              scriptRunner.scriptRunning
                ? 'button-stop-save-pulse py-1 text-sm'
                : 'button-primary py-1 text-sm'
            }
            onClick={scriptRunner.toggleScriptRunner}
            disabled={!scriptRunner.scriptRunnerSupported}
            // One runner, one script at a time — so while something runs this
            // stops THAT script, which may not be the tab on screen. Say which.
            title={
              runningTab
                ? `Stop ${runningTab.name}`
                : `Run ${scriptRunner.activeTab.name}`
            }
          >
            {scriptRunner.scriptRunning ? 'Stop' : 'Run'}
          </button>
        </>
      }
    >
      {/* The editor is the only flex-1 child, so every pixel this column does
          not spend on padding, gaps and the fixed rows around it becomes
          editor height. That is why the type here runs a step smaller than the
          rest of the app: the language row, the Output header and the API list
          are all glanced at, while the editor is worked in. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-1.5">
        {/* The last thing that still needs a row of its own, and only when it
            happens: the runner cannot run at all. Everything else that used to
            live here — "Status: Stopped", which the Run/Stop button, the Output
            pane and the bottom status bar all already carried, and the running /
            read-only note, now in the subtitle — cost a row of editor for the
            whole session to say something already on screen. This one is a dead
            Run button with the reason nowhere else. */}
        {!scriptRunner.scriptRunnerSupported && (
          <div className="text-[0.7rem] text-rose-600 dark:text-rose-400">
            {scriptRunner.scriptRunnerStatus}
          </div>
        )}
        {/* One row, scrolled sideways rather than wrapped: a strip that grows a
            second line steals the height the editor is here for, and the tab
            count is capped low enough that scrolling stays short. */}
        <div role="tablist" aria-label="Scripts" className="flex shrink-0 items-center gap-1 overflow-x-auto pb-0.5">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const running = tab.id === runningTabId;
            return (
              <div
                key={tab.id}
                className={`group flex shrink-0 items-center gap-1 rounded-t border-b-2 px-2 py-1 text-[0.7rem] ${
                  active
                    ? 'border-sky-500 bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    : 'border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60'
                }`}
              >
                {/* The red dot is the same one the bottom status bar uses for a
                    live run, so "this is the script executing" is stated the
                    same way in both places. */}
                {running && (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500 shadow-[0_0_5px_1px_rgba(239,68,68,0.7)]"
                  />
                )}
                {renamingId === tab.id ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename();
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                    // Capped at the width a tab can actually show. Enforced
                    // again in sanitizeTabName, since maxLength does not survive
                    // a paste into a value set from elsewhere.
                    maxLength={SCRIPT_TAB_NAME_MAX}
                    className="w-28 rounded border border-sky-400 bg-white px-1 text-[0.7rem] text-slate-900 outline-none dark:bg-slate-900 dark:text-slate-100"
                    aria-label="Script name"
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className="max-w-[9rem] truncate"
                    onClick={() => scriptRunner.selectTab(tab.id)}
                    onDoubleClick={() => {
                      setRenamingId(tab.id);
                      setRenameDraft(tab.name);
                    }}
                    title={`${tab.name}${running ? ' (running)' : ''}\nDouble-click to rename`}
                  >
                    {tab.name}
                  </button>
                )}
                {/* Never for the running script (closing it would leave a run
                    with no tab to stop it from) and never for the last one in
                    this language, which selecting the language has to land on. */}
                <button
                  type="button"
                  className="rounded px-0.5 text-slate-400 hover:bg-slate-300 hover:text-slate-900 disabled:invisible dark:hover:bg-slate-600 dark:hover:text-slate-50"
                  onClick={() => requestCloseTab(tab.id)}
                  disabled={running || !scriptRunner.canCloseTab}
                  title={running ? 'Stop the script before closing this tab' : `Close ${tab.name}`}
                  aria-label={`Close ${tab.name}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-1 text-sm leading-none text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={scriptRunner.addTab}
            disabled={!scriptRunner.canAddTab}
            title={
              scriptRunner.canAddTab
                ? `New ${language.label} script`
                : `At most ${tabs.length} ${language.label} scripts`
            }
            aria-label="New script"
          >
            ＋
          </button>
        </div>
        <CodeEditor
          value={scriptRunner.scriptCode}
          onValueChange={scriptRunner.setScriptCode}
          language={scriptRunner.scriptLanguage}
          readOnly={!scriptRunner.scriptEditable}
          className="min-h-[180px] w-full flex-1"
        />
        {/* The Output pane used to sit here — print() lines and tracebacks, in a
            box about five lines tall. It is now the System Log window (Menu →
            System Log), which can be opened beside this one and made as tall as
            a traceback needs. What a script records is unchanged; it is now
            interleaved with the app's own events (link, save, recording) on one
            clock, at INFO, and the footer still carries the newest line. */}
        {/* Collapsed by default — the editor is what this window is for, and
            the list is long. It used to be a <details>, where the only hint
            that the section opened at all was the tiny native triangle; the
            chevron button is the same control the main page's Analog Input
            group uses, so "this opens" is stated the same way everywhere. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex select-none items-center justify-between px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
            API Reference
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="button-secondary py-0.5 text-[0.7rem]"
                onClick={copyAiPrompt}
                title="Copy an AI-ready prompt of this API reference to the clipboard"
              >
                {promptCopied ? 'Copied!' : 'Copy for AI'}
              </button>
              <CollapseButton
                collapsed={!apiOpen}
                onToggle={() => setApiOpen((v) => !v)}
                label="API Reference"
              />
            </div>
          </div>
          {apiOpen && (
            <ul className="space-y-1 px-2 pb-1.5 text-[0.7rem] leading-snug text-slate-600 dark:text-slate-400">
              {language.apiDocs.map((api) => (
                <li key={api.name}>
                  <code translate="no" className="rounded bg-slate-200 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    {api.name}
                  </code>
                  <span className="ml-2">{api.desc}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
