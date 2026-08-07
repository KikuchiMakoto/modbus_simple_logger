import { SlidePanel } from './SlidePanel';
import { ThemeToggle } from './ThemeToggle';
import { UiScaleControl } from './UiScaleControl';

type HamburgerMenuProps = {
  open: boolean;
  onClose: () => void;
  onSelectItem: (item: string) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
};

const MENU_ITEMS = [
  // The three AI-side windows share an "Input …" prefix and sit together, in
  // the order they are reached for: the coefficient table is what gets opened
  // day to day, the calibrator is what fills it in, and the range is set once
  // per sensor.
  { key: 'calibration', label: 'Input Calib Value', icon: '⚙️', wip: false },
  // One entry for both front-ends: the HX711 and ADS1115 windows differed only
  // in which channels they offered and which reference units the Spec tab
  // listed, and both of those follow the channel number the user picks.
  { key: 'inputCalibrator', label: 'Input Calibrator', icon: '⚖️', wip: false },
  // A mixer/knob panel rather than the old ⚡: what this sets is each channel's
  // range, and a lightning bolt read as "power".
  { key: 'inputConfig', label: 'Input Config', icon: '🎛️', wip: false },
  { key: 'outputTester', label: 'Output Setter', icon: '🎚️', wip: false },
  // 🔢 rather than a second ⚙️: Input Calib Value already owns the gear, and
  // what this window edits is a table of numbers per channel.
  { key: 'paramEditor', label: 'Param Editor', icon: '🔢', wip: false },
  { key: 'scriptRunner', label: 'Script Runner', icon: '📜', wip: false },
  // Directly under the runner, because it is still the runner's other half: the
  // window where a script is written, and the window where what it said is
  // read. It was a pane inside that window until the editor needed the height,
  // and it carries the app's own events — link, save, storage — as well now,
  // which is why it is no longer named after scripts.
  { key: 'systemLog', label: 'System Log', icon: '🧾', wip: false },
  // With the runner and the log rather than with the reference material below:
  // what is written here is copied into the runner's AI prompt, so it belongs
  // beside the window that copies it, not beside the manual.
  { key: 'deviceMemo', label: 'Device Memo', icon: '📝', wip: false },
  { key: 'manual', label: 'Connector Manual', icon: '📖', wip: false },
  { key: 'appInfo', label: 'Application Info', icon: 'ℹ️', wip: false },
];

export function HamburgerMenu({
  open,
  onClose,
  onSelectItem,
  isDarkMode,
  onToggleTheme,
}: HamburgerMenuProps) {
  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Menu"
      maxWidth="max-w-xs"
      // In the header rather than as menu rows: the rows all open a panel, and
      // ones that instead change a setting in place would be the odd ones out.
      // Both are appearance-only and take effect instantly, so they belong
      // where they can be used while looking at the page behind them — not
      // buried in Application Info, which is where the scale control was.
      headerActions={
        <>
          <UiScaleControl />
          <ThemeToggle isDarkMode={isDarkMode} onToggle={onToggleTheme} />
        </>
      }
    >
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
