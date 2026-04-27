import { SlidePanel } from './SlidePanel';

type HamburgerMenuProps = {
  open: boolean;
  onClose: () => void;
  onSelectItem: (item: string) => void;
};

const MENU_ITEMS = [
  { key: 'modbusConfig', label: 'Modbus Config', icon: '🔌', wip: false },
  { key: 'calibration', label: 'Input Calibration', icon: '⚙', wip: false },
  { key: 'voltageConfig', label: 'Voltage Config', icon: '⚡', wip: false },
  { key: 'manual', label: 'Manual', icon: '📖', wip: false },
  { key: 'appInfo', label: 'App Info', icon: 'ℹ️', wip: false },
];

export function HamburgerMenu({
  open,
  onClose,
  onSelectItem,
}: HamburgerMenuProps) {
  return (
    <SlidePanel open={open} onClose={onClose} title="Menu" maxWidth="max-w-xs">
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {MENU_ITEMS.map((item) => (
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
                <span className="text-lg">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </SlidePanel>
  );
}
