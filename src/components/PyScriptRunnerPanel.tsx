import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { useScriptRunner } from '../hooks/useScriptRunner';
import { FloatingWindow } from './FloatingWindow';
import { SlideToConfirm } from './SlideToConfirm';

type ChannelLabels = {
  ai: string[];
  ao: string[];
  param: string[];
};

type PyScriptRunnerPanelProps = {
  open: boolean;
  onClose: () => void;
  scriptRunner: ReturnType<typeof useScriptRunner>;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  channelLabels: ChannelLabels;
};

const API_DOCS = [
  { name: 'get_ai_raw(ch)', desc: 'Raw AI value. ch: 0-15.' },
  { name: 'get_ai_phy(ch)', desc: 'Calibrated AI value. ch: 0-15.' },
  { name: 'set_ai_tare(ch)', desc: 'Tare AI ch: set offset c so the current phy reads 0 (a, b kept). Applied async.' },
  { name: 'get_ao(ch)', desc: 'AO voltage [V]. ch: 0-7.' },
  { name: 'set_ao(ch, vlt)', desc: 'Set AO voltage [V], clamped to 0-10. Applied async; get_ao() updates slightly later.' },
  { name: 'get_param(ch)', desc: 'Scratch value. ch: 0-15. Starts at 0.' },
  { name: 'set_param(ch, val)', desc: 'Set scratch value. Shown in Parameter panel, logged to TSV. Not persisted.' },
  { name: 'set_notify(msg)', desc: 'Raise an OS notification (needs Notifications on in the menu). Always written to Output.' },
  { name: 'await asyncio.sleep(s)', desc: 'Non-blocking wait. NEVER time.sleep().' },
];

const buildAiPrompt = (channelLabels: ChannelLabels): string =>
  [
    'Write a Python script for ModbusSimpleLogger PyScript Runner (Pyodide; async context, top-level await OK).',
    '',
    'API:',
    ...API_DOCS.map((api) => `- ${api.name}: ${api.desc}`),
    '',
    'Absolute rules:',
    '- Wait only with `await asyncio.sleep(s)`. NEVER time.sleep().',
    '- Repeat/feedback control only with a plain `while`/`for` loop awaiting asyncio.sleep(s) each iteration. No timers, callbacks or threads.',
    '',
    'Channel labels (JSON; index = ch, "" = unlabeled):',
    JSON.stringify(channelLabels),
    '',
    'Task: <your request here>',
  ].join('\n');

const formatLogTime = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export function PyScriptRunnerPanel({
  open,
  onClose,
  scriptRunner,
  onEditorKeyDown,
  channelLabels,
}: PyScriptRunnerPanelProps) {
  const [promptCopied, setPromptCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const { scriptLog } = scriptRunner;

  // Follow the tail: a script that prints while it runs is only useful if the
  // newest line is the one on screen.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [scriptLog]);

  const copyAiPrompt = (event: MouseEvent<HTMLButtonElement>) => {
    // Inside <summary>: keep the click from toggling the <details>.
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard.writeText(buildAiPrompt(channelLabels)).then(() => {
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1500);
    });
  };

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="PyScript Runner"
      subtitle="Python (Pyodide)"
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
          {scriptRunner.hasScriptBackup && (
            <button
              type="button"
              className="button-secondary py-1 text-sm"
              onClick={scriptRunner.restoreScriptBackup}
              disabled={scriptRunner.scriptRunning}
              title="Restore the script that was in the editor before MCP replaced it"
            >
              Restore
            </button>
          )}
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
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Status: {scriptRunner.scriptRunnerStatus}</span>
          {/* One PyScriptRunner, one editor: a script submitted over MCP replaces
              what is shown here, so say where the running code came from. */}
          {scriptRunner.scriptRunning && scriptRunner.scriptSource === 'mcp' && (
            <span className="rounded bg-emerald-500 px-1.5 py-0.5 font-semibold text-emerald-950">
              Running from MCP
            </span>
          )}
        </p>
        <textarea
          value={scriptRunner.scriptCode}
          onChange={(e) => scriptRunner.setScriptCode(e.target.value)}
          onKeyDown={onEditorKeyDown}
          className="min-h-[180px] w-full flex-1 resize-none rounded border border-slate-300 bg-white p-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          spellCheck={false}
        />
        {/* print() output and Python tracebacks. Before this existed a failing
            script left only a one-line status, and a script started over MCP
            left nothing the caller could read at all. */}
        <details
          className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          open
        >
          <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <span>
              Output
              {scriptRunner.scriptRun.outcome === 'error' && (
                <span className="ml-2 rounded bg-rose-500 px-1.5 py-0.5 text-xs font-semibold text-rose-50">
                  Error
                </span>
              )}
            </span>
            <button
              type="button"
              className="button-secondary py-0.5 text-xs"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                scriptRunner.clearScriptLog();
              }}
              title="Clear the output log"
            >
              Clear
            </button>
          </summary>
          <div className="max-h-16 min-h-[2rem] overflow-auto px-3 pb-2 font-mono text-xs">
            {scriptLog.length === 0 ? (
              <p className="py-1 text-slate-400 dark:text-slate-500">
                No output. print() goes here, along with errors and tracebacks.
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
        </details>
        <details className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
          <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            API Reference
            <button
              type="button"
              className="button-secondary py-0.5 text-xs"
              onClick={copyAiPrompt}
              title="Copy an AI-ready prompt of this API reference to the clipboard"
            >
              {promptCopied ? 'Copied!' : 'Copy for AI'}
            </button>
          </summary>
          <ul className="space-y-2 px-3 pb-3 text-xs text-slate-600 dark:text-slate-400">
            {API_DOCS.map((api) => (
              <li key={api.name}>
                <code translate="no" className="rounded bg-slate-200 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  {api.name}
                </code>
                <span className="ml-2">{api.desc}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </FloatingWindow>
  );
}
