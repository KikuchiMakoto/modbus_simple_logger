import { SlidePanel } from './SlidePanel';
import { useCallback, type KeyboardEvent } from 'react';

type ScriptRunnerPanelProps = {
  open: boolean;
  onClose: () => void;
  scriptCode: string;
  onScriptCodeChange: (code: string) => void;
  scriptRunning: boolean;
  scriptRunnerStatus: string;
  scriptRunnerSupported: boolean;
  onToggleScriptRunner: () => void;
  onClearScript: () => void;
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
  scriptCode,
  onScriptCodeChange,
  scriptRunning,
  scriptRunnerStatus,
  scriptRunnerSupported,
  onToggleScriptRunner,
  onClearScript,
}: ScriptRunnerPanelProps) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();

      const textarea = event.currentTarget;
      const value = textarea.value;
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const lineStartIndex = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const hasSelection = selectionStart !== selectionEnd;
      const indent = '  ';

      if (!event.shiftKey) {
        if (!hasSelection) {
          const nextValue = `${value.slice(0, selectionStart)}${indent}${value.slice(selectionEnd)}`;
          onScriptCodeChange(nextValue);
          window.requestAnimationFrame(() => {
            const nextCursor = selectionStart + indent.length;
            textarea.setSelectionRange(nextCursor, nextCursor);
          });
          return;
        }

        const blockStart = lineStartIndex;
        const blockEnd = selectionEnd;
        const block = value.slice(blockStart, blockEnd);
        const indentedBlock = block
          .split('\n')
          .map((line) => (!line.trim() ? line : `${indent}${line}`))
          .join('\n');
        const nextValue = `${value.slice(0, blockStart)}${indentedBlock}${value.slice(blockEnd)}`;
        onScriptCodeChange(nextValue);
        window.requestAnimationFrame(() => {
          const selectionEndOffset = indentedBlock.length - block.length;
          textarea.setSelectionRange(
            selectionStart + indent.length,
            selectionEnd + selectionEndOffset
          );
        });
        return;
      }

      const blockStart = lineStartIndex;
      const nextLineBreak = value.indexOf('\n', selectionStart);
      let blockEnd = selectionEnd;
      if (!hasSelection) {
        blockEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
      }
      const block = value.slice(blockStart, blockEnd);
      const lines = block.split('\n');

      let removedFromFirstLine = 0;
      let removedTotal = 0;
      const outdentedBlock = lines
        .map((line, idx) => {
          let removeCount = 0;
          if (line.startsWith(indent)) {
            removeCount = indent.length;
          } else if (line.startsWith(' ')) {
            removeCount = 1;
          }
          if (idx === 0) {
            removedFromFirstLine = removeCount;
          }
          removedTotal += removeCount;
          return line.slice(removeCount);
        })
        .join('\n');

      const nextValue = `${value.slice(0, blockStart)}${outdentedBlock}${value.slice(blockEnd)}`;
      onScriptCodeChange(nextValue);
      window.requestAnimationFrame(() => {
        if (!hasSelection) {
          const nextCursor = Math.max(
            lineStartIndex,
            selectionStart - removedFromFirstLine
          );
          textarea.setSelectionRange(nextCursor, nextCursor);
          return;
        }
        const nextStart = Math.max(
          lineStartIndex,
          selectionStart - removedFromFirstLine
        );
        const nextEnd = Math.max(nextStart, selectionEnd - removedTotal);
        textarea.setSelectionRange(nextStart, nextEnd);
      });
    },
    [onScriptCodeChange]
  );

  return (
    <SlidePanel open={open} onClose={onClose} title="Script Runner" maxWidth="max-w-2xl">
      <div className="flex h-full flex-col gap-3 p-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Available APIs
          </h3>
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
            {API_DOCS.map((api) => (
              <li key={api.name}>
                <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  {api.name}
                </code>
                <span className="ml-2">{api.desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="button-primary"
              onClick={onToggleScriptRunner}
              disabled={!scriptRunnerSupported}
            >
              {scriptRunning ? 'Stop' : 'Run'}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={onClearScript}
              disabled={scriptRunning}
              title="Reset script to default"
            >
              Clear All
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Status: {scriptRunnerStatus}
          </p>
        </div>

        <textarea
          value={scriptCode}
          onChange={(e) => onScriptCodeChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[300px] w-full flex-1 rounded border border-slate-300 bg-white p-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          spellCheck={false}
        />
      </div>
    </SlidePanel>
  );
}
