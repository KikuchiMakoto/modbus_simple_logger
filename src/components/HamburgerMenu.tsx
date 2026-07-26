import { SlidePanel } from './SlidePanel';

type HamburgerMenuProps = {
  open: boolean;
  onClose: () => void;
  onSelectItem: (item: string) => void;
  /** MCP is a desktop-launcher feature; the entry is hidden in the web build. */
  showMcp?: boolean;
  /** Remote monitoring is likewise launcher-only. */
  showRemoteViewer?: boolean;
};

const MENU_ITEMS = [
  { key: 'modbusConfig', label: 'Connection Config', icon: '🔌', wip: false },
  { key: 'calibration', label: 'Calibration Value', icon: '⚙️', wip: false },
  { key: 'hx711Calibration', label: 'HX711 Calib (CH00–07)', icon: '⚖️', wip: false },
  { key: 'ads1115Calibration', label: 'ADS1115 Calib (CH08–15)', icon: '🎚️', wip: false },
  { key: 'voltageConfig', label: 'Voltage Config', icon: '⚡', wip: false },
  { key: 'scriptRunner', label: 'ScriptRunner', icon: '📜', wip: false },
  { key: 'mcp', label: 'MCP Access', icon: '🤖', wip: false },
  { key: 'remoteViewer', label: 'Remote Monitoring', icon: '📡', wip: false },
  { key: 'manual', label: 'Connector Manual', icon: '📖', wip: false },
  { key: 'appInfo', label: 'Application Info', icon: 'ℹ️', wip: false },
];

export function HamburgerMenu({
  open,
  onClose,
  onSelectItem,
  showMcp = false,
  showRemoteViewer = false,
}: HamburgerMenuProps) {
  const items = MENU_ITEMS.filter((item) => {
    if (item.key === 'mcp') return showMcp;
    if (item.key === 'remoteViewer') return showRemoteViewer;
    return true;
  });

  return (
    <SlidePanel open={open} onClose={onClose} title="Menu" maxWidth="max-w-xs">
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                disabled={item.wip}
                onClick={() => {
                  onSelectItem(item.key);
                  onClose();
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold ${
                  item.wip
                    ? 'cursor-not-allowed text-slate-400 dark:text-slate-600'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <span className="w-6 shrink-0 text-center text-lg">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </SlidePanel>
  );
}
