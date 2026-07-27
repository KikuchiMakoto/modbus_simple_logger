import { useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import type { McpBridgeState } from '../hooks/useMcpBridge';

type McpPanelProps = {
  open: boolean;
  onClose: () => void;
  bridge: McpBridgeState;
  writeEnabled: boolean;
  onWriteEnabledChange: (enabled: boolean) => void;
};

const READ_TOOLS = [
  { name: 'get_status', desc: 'Connection, polling, saving and script state.' },
  { name: 'get_labels()', desc: 'Free-text AI / AO / Parameter channel labels.' },
  { name: 'get_ai_raw(ch)', desc: 'Raw AI value. ch: 0-15.' },
  { name: 'get_ai_phy(ch)', desc: 'Calibrated AI value. ch: 0-15.' },
  { name: 'get_ao(ch)', desc: 'AO voltage [V]. ch: 0-7.' },
  { name: 'get_param(ch)', desc: 'Parameter scratch value. ch: 0-15.' },
  { name: 'read_recent(n)', desc: 'Up to 200 recent samples from the chart buffer.' },
  { name: 'get_script()', desc: 'Editor contents, run state and how the last run ended.' },
  { name: 'get_script_log(n)', desc: 'print() output, tracebacks and run events of the last run.' },
];

const WRITE_TOOLS = [
  { name: 'set_ao(ch, volt)', desc: 'Set AO voltage [V], clamped to 0-10.' },
  { name: 'set_param(ch, value)', desc: 'Set a Parameter scratch value.' },
  { name: 'set_ai_tare(ch)', desc: 'Tare AI ch (offset c only).' },
  { name: 'run_script(code, wait_ms)', desc: 'Run Python in PyScriptRunner; returns its outcome and errors.' },
  { name: 'stop_script()', desc: 'Interrupt the running script; returns the outcome.' },
];

export function McpPanel({ open, onClose, bridge, writeEnabled, onWriteEnabledChange }: McpPanelProps) {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    if (!bridge.mcpUrl) return;
    navigator.clipboard.writeText(bridge.mcpUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="MCP Server"
      subtitle="Desktop app only"
      defaultWidth={440}
      defaultHeight={560}
    >
      <div className="flex flex-col gap-4 p-3 text-sm text-slate-700 dark:text-slate-200">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <dl className="space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Endpoint</dt>
              <dd className="font-mono text-xs break-all text-right">
                {bridge.mcpUrl ?? 'not available'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Server</dt>
              <dd className={bridge.mcpEnabled ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                {bridge.mcpEnabled ? 'Listening' : 'Disabled (port in use by another instance)'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">App bridge</dt>
              <dd className={bridge.bridgeConnected ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                {bridge.bridgeConnected ? 'Connected' : 'Disconnected'}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="button-secondary mt-3 w-full py-1 text-xs"
            onClick={copyUrl}
            disabled={!bridge.mcpUrl}
          >
            {copied ? 'Copied!' : 'Copy endpoint URL'}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="font-semibold">Allow write access</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Lets a connected AI client set AO outputs, Parameter values, tare channels and run
                scripts. Reading is always allowed.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-emerald-500"
              checked={writeEnabled}
              onChange={(e) => onWriteEnabledChange(e.target.checked)}
            />
          </label>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {writeEnabled
              ? 'Write access is ON. Outputs can change without further confirmation.'
              : 'Write access is OFF. Write tools are rejected.'}
          </p>
        </div>

        <div>
          <h4 className="mb-1 font-semibold text-emerald-600 dark:text-emerald-400">Read tools</h4>
          <ToolList tools={READ_TOOLS} />
          <h4 className="mt-3 mb-1 font-semibold text-emerald-600 dark:text-emerald-400">
            Write tools
          </h4>
          <ToolList tools={WRITE_TOOLS} />
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            There is only one PyScriptRunner: a script started here and one started over MCP are the
            same run, sharing the same editor contents. Whichever starts first holds it until it
            stops. Direct writes are refused while a script is running — the script owns the outputs.
          </p>
        </div>
      </div>
    </FloatingWindow>
  );
}

function ToolList({ tools }: { tools: { name: string; desc: string }[] }) {
  return (
    <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
      {tools.map((tool) => (
        <li key={tool.name}>
          <code translate="no" className="rounded bg-slate-200 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            {tool.name}
          </code>
          <span className="ml-2">{tool.desc}</span>
        </li>
      ))}
    </ul>
  );
}
