type HamburgerMenuProps = {
  open: boolean;
  onClose: () => void;
  onSelectItem: (item: string) => void;
};

const MENU_ITEMS = [
  { key: 'modbusConfig', label: 'Modbus Config', icon: '🔌', wip: false },
  { key: 'voltageConfig', label: 'Voltage Config', icon: '🔋', wip: false },
  { key: 'calibration', label: 'Calibration', icon: '⚙', wip: false },
  { key: 'menu1', label: 'Menu 1 (WIP)', icon: '📊', wip: true },
];

export function HamburgerMenu({
  open,
  onClose,
  onSelectItem,
}: HamburgerMenuProps) {
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Slide-in Menu from right */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-72 transform bg-white shadow-2xl transition-transform duration-300 dark:bg-slate-900 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h2 className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              Menu
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
              aria-label="Close menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Menu Items */}
          <nav className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-1">
              {MENU_ITEMS.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={item.wip}
                    onClick={() => {
                      if (!item.wip) {
                        onSelectItem(item.key);
                        onClose();
                      }
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
        </div>
      </div>
    </>
  );
}
