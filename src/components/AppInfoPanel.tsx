import { FloatingWindow } from './FloatingWindow';

const LIBRARIES = [
  { name: 'React', version: '19.2', license: 'MIT' },
  { name: 'React DOM', version: '19.2', license: 'MIT' },
  { name: 'Plotly.js', version: '3.6', license: 'MIT' },
  { name: 'react-plotly.js', version: '3.0', license: 'MIT' },
  { name: 'react-rnd', version: '10.5', license: 'MIT' },
  { name: 'Tailwind CSS', version: '4.3', license: 'MIT' },
  { name: 'Vite', version: '8', license: 'MIT' },
  { name: 'TypeScript', version: '6.0', license: 'Apache-2.0' },
  { name: 'web-serial-polyfill', version: '1.0', license: 'BSD-3-Clause' },
  // Version injected from the exact pin in package.json (see vite.config.ts).
  { name: 'Pyodide', version: import.meta.env.VITE_PYODIDE_VERSION ?? 'unknown', license: 'MPL-2.0' },
];

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'unknown';
const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'modbus_simple_logger';

export function AppInfoPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <FloatingWindow open={open} onClose={onClose} title="App Info" defaultWidth={384} defaultHeight={560}>
      <div className="flex flex-col gap-4 p-2 text-sm text-slate-700 dark:text-slate-200">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="mb-1 text-base font-bold text-emerald-600 dark:text-emerald-400">
            {APP_NAME}
          </h3>
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Version</dt>
              <dd className="font-mono font-semibold">v{APP_VERSION}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Author</dt>
              <dd>
                <a
                  href="https://github.com/KikuchiMakoto"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  Makoto KUNO
                </a>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">License</dt>
              <dd>MIT</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Repository</dt>
              <dd>
                <a
                  href="https://github.com/KikuchiMakoto/modbus_simple_logger"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  GitHub
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Special Thanks</h4>
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
            <li className="flex items-center justify-between rounded px-2 py-1">
              <span className="font-medium">Ryota MANO</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Bug Reporter</span>
            </li>
            <li className="flex items-center justify-between rounded px-2 py-1">
              <span className="font-medium">Itsuki SATO</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Feature Proposal</span>
            </li>
            <li className="flex items-center justify-between rounded px-2 py-1">
              <span className="font-medium">Ying CUI</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Feature Proposal</span>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Libraries</h4>
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
            {LIBRARIES.map((lib) => (
              <li
                key={lib.name}
                className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700/50"
              >
                <span className="font-medium">{lib.name}</span>
                <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono dark:bg-slate-700">
                    v{lib.version}
                  </span>
                  <span className="rounded border border-slate-300 px-1.5 py-0.5 dark:border-slate-600">
                    {lib.license}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </FloatingWindow>
  );
}
