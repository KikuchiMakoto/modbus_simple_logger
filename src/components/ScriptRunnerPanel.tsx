import { useEffect, useRef, useState } from 'react';
import type { useScriptRunner } from '../hooks/useScriptRunner';
import { CodeEditor } from './CodeEditor';
import { CollapseButton } from './CollapseButton';
import {
  SCRIPT_LANGUAGES,
  SCRIPT_LANGUAGE_LIST,
  buildAiPrompt,
} from '../utils/scriptLanguages';
import { FloatingWindow } from './FloatingWindow';
import { SlideToConfirm } from './SlideToConfirm';

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

const formatLogTime = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export function ScriptRunnerPanel({
  open,
  onClose,
  scriptRunner,
  channelLabels,
}: ScriptRunnerPanelProps) {
  const [promptCopied, setPromptCopied] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const { scriptLog } = scriptRunner;
  const language = SCRIPT_LANGUAGES[scriptRunner.scriptLanguage];

  // Follow the tail: a script that prints while it runs is only useful if the
  // newest line is the one on screen.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [scriptLog]);

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
          <button
            type="button"
            className={
              scriptRunner.scriptRunning
                ? 'button-stop-save-pulse py-1 text-sm'
                : 'button-primary py-1 text-sm'
            }
            onClick={scriptRunner.toggleScriptRunner}
            disabled={!scriptRunner.scriptRunnerSupported}
          >
            {scriptRunner.scriptRunning ? 'Stop' : 'Run'}
          </button>
          {/* A swipe, not a button: it discards whatever is in the editor for
              the default script, and an editor holds work that exists nowhere
              else — there is no undo behind it. Same gesture as the header's
              Disconnect and the Output Tester's zero. */}
          <SlideToConfirm
            label="Slide to clear"
            armedLabel="Release"
            knobLabel="✕"
            onConfirm={scriptRunner.clearScriptCode}
            disabled={scriptRunner.scriptRunning}
            knobPx={24}
            className="h-[26px] w-[7.5rem]"
            labelClassName="text-[0.7rem]"
            aria-label="Slide to reset the script to the default"
          />
        </>
      }
    >
      {/* The editor is the only flex-1 child, so every pixel this column does
          not spend on padding, gaps and the fixed rows around it becomes
          editor height. That is why the type here runs a step smaller than the
          rest of the app: the language row, the Output header and the API list
          are all glanced at, while the editor is worked in. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-slate-500 dark:text-slate-400">
          {/* Disabled while running: the worker executing belongs to the
              current language, and switching would leave Stop pointing at a
              script no longer on screen. */}
          <label className="flex items-center gap-1">
            <span className="font-semibold">Language</span>
            <select
              value={scriptRunner.scriptLanguage}
              onChange={(event) =>
                scriptRunner.setScriptLanguage(
                  event.target.value as typeof scriptRunner.scriptLanguage,
                )
              }
              disabled={scriptRunner.scriptRunning}
              className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {SCRIPT_LANGUAGE_LIST.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <span>Status: {scriptRunner.scriptRunnerStatus}</span>
        </div>
        <CodeEditor
          value={scriptRunner.scriptCode}
          onValueChange={scriptRunner.setScriptCode}
          language={scriptRunner.scriptLanguage}
          className="min-h-[180px] w-full flex-1"
        />
        {/* print() output and tracebacks. Before this existed a failing script
            left only a one-line status with no way to see which line failed.
            Always open: it is the answer to "what did my script do", and a
            traceback nobody can see is the same as no traceback. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex select-none items-center justify-between px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span>
              Output
              {scriptRunner.scriptRun.outcome === 'error' && (
                <span className="ml-2 rounded bg-rose-500 px-1.5 py-0.5 text-[0.65rem] font-semibold text-rose-50">
                  Error
                </span>
              )}
            </span>
            <button
              type="button"
              className="button-secondary py-0.5 text-[0.7rem]"
              onClick={scriptRunner.clearScriptLog}
              title="Clear the output log"
            >
              Clear
            </button>
          </div>
          <div className="max-h-16 min-h-[1.5rem] overflow-auto px-3 pb-1.5 font-mono text-[0.7rem] leading-[1.05rem]">
            {scriptLog.length === 0 ? (
              <p className="py-1 text-slate-400 dark:text-slate-500">
                No output. Printed text goes here, along with errors.
              </p>
            ) : (
              scriptLog.map((entry, index) => (
                <div
                  key={`${entry.t}-${index}`}
                  className={
                    entry.stream === 'stderr'
                      ? 'whitespace-pre-wrap break-words text-rose-600 dark:text-rose-400'
                      : entry.stream === 'system'
                        ? 'whitespace-pre-wrap break-words text-slate-400 dark:text-slate-500'
                        : 'whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200'
                  }
                >
                  <span className="mr-2 text-slate-400 dark:text-slate-600">{formatLogTime(entry.t)}</span>
                  {entry.text}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
        {/* Collapsed by default — the editor is what this window is for, and
            the list is long. It used to be a <details>, where the only hint
            that the section opened at all was the tiny native triangle; the
            chevron button is the same control the main page's Analog Input
            group uses, so "this opens" is stated the same way everywhere. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex select-none items-center justify-between px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
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
            <ul className="space-y-1.5 px-3 pb-3 text-[0.7rem] leading-snug text-slate-600 dark:text-slate-400">
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
