import type { KeyboardEvent } from 'react';
import type { useScriptRunner } from '../hooks/useScriptRunner';
import { FloatingWindow } from './FloatingWindow';

type ScriptRunnerPanelProps = {
  open: boolean;
  onClose: () => void;
  scriptRunner: ReturnType<typeof useScriptRunner>;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

const API_DOCS = [
  { name: 'get_ai_raw(ch)', desc: 'Read raw AI value for channel ch (0-15).' },
  { name: 'get_ai_raw_all()', desc: 'Read all raw AI values as a list of 16 floats.' },
  { name: 'get_ai_phy(ch)', desc: 'Read calibrated AI value for channel ch (0-15).' },
  { name: 'get_ai_phy_all()', desc: 'Read all calibrated AI values as a list of 16 floats.' },
  { name: 'set_ao(ch, data)', desc: 'Write AO voltage in V (internally clamped to 0-10V).' },
  { name: 'set_ao_all(data)', desc: 'Write all AO channels from a list of 8 values.' },
  { name: 'await asyncio.sleep(s)', desc: 'Non-blocking sleep. Do NOT use time.sleep().' },
];

export function ScriptRunnerPanel({
  open,
  onClose,
  scriptRunner,
  onEditorKeyDown,
}: ScriptRunnerPanelProps) {
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
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            API Reference
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
