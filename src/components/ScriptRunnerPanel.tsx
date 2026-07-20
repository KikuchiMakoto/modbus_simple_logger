import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { useScriptRunner } from '../hooks/useScriptRunner';
import { FloatingWindow } from './FloatingWindow';

type ChannelLabels = {
  ai: string[];
  ao: string[];
  param: string[];
};

type ScriptRunnerPanelProps = {
  open: boolean;
  onClose: () => void;
  scriptRunner: ReturnType<typeof useScriptRunner>;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  channelLabels: ChannelLabels;
};

const API_DOCS = [
  { name: 'get_ai_raw(ch)', desc: 'Read raw AI value for channel ch (0-15).' },
  { name: 'get_ai_phy(ch)', desc: 'Read calibrated AI value for channel ch (0-15).' },
  { name: 'get_ao(ch)', desc: 'Read back AO voltage in V for channel ch (0-7).' },
  { name: 'set_ao(ch, data)', desc: 'Write AO voltage in V (internally clamped to 0-10V). Applied asynchronously, so get_ao() reflects it only after the main thread applies it.' },
  { name: 'get_param(ch)', desc: 'Read scratch Parameter value for channel ch (0-7). Always 0 at app startup.' },
  { name: 'set_param(ch, data)', desc: 'Write scratch Parameter value for channel ch (0-7). Shown in the Parameter panel and logged to TSV; not persisted.' },
  { name: 'await asyncio.sleep(s)', desc: 'Non-blocking sleep. Do NOT use time.sleep().' },
];

const buildAiPrompt = (channelLabels: ChannelLabels): string =>
  [
    'Write a Python script for ModbusSimpleLogger ScriptRunner (Python 3 / Pyodide, runs inside an asyncio event loop; top-level await is allowed).',
    '',
    'API:',
    ...API_DOCS.map((api) => `- ${api.name}: ${api.desc}`),
    '',
    'Absolute rules:',
    '- Every wait MUST be `await asyncio.sleep(seconds)`. NEVER use time.sleep() — it blocks the runtime.',
    '- Repeated processing (e.g. feedback control) MUST be an explicit `while` or `for` loop with `await asyncio.sleep()` inside each iteration. Timers, callbacks and threads are not available.',
    '',
    'User-defined channel labels (JSON; array index = ch, "" = unlabeled):',
    JSON.stringify(channelLabels),
    '',
    'Task: <describe the script you want here>',
  ].join('\n');

export function ScriptRunnerPanel({
  open,
  onClose,
  scriptRunner,
  onEditorKeyDown,
  channelLabels,
}: ScriptRunnerPanelProps) {
  const [promptCopied, setPromptCopied] = useState(false);

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
      title="ScriptRunner"
      subtitle="Python (Pyodide)"
      defaultWidth={640}
      defaultHeight={620}
      headerActions={
        <>
          <button
            type="button"
            className="button-primary py-1 text-sm"
            onClick={scriptRunner.toggleScriptRunner}
            disabled={!scriptRunner.scriptRunnerSupported}
          >
            {scriptRunner.scriptRunning ? 'Stop' : 'Run'}
          </button>
          <button
            type="button"
            className="button-secondary py-1 text-sm"
            onClick={scriptRunner.clearScriptCode}
            disabled={scriptRunner.scriptRunning}
            title="Reset script to default"
          >
            Clear All
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Status: {scriptRunner.scriptRunnerStatus}
        </p>
        <textarea
          value={scriptRunner.scriptCode}
          onChange={(e) => scriptRunner.setScriptCode(e.target.value)}
          onKeyDown={onEditorKeyDown}
          className="min-h-[180px] w-full flex-1 resize-none rounded border border-slate-300 bg-white p-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          spellCheck={false}
        />
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
                <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
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
