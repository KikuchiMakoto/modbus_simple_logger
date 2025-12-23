import { useMemo } from 'react';

type ThemeToggleProps = {
  isDarkMode: boolean;
  onToggle: () => void;
};

const lightIcon = '/light.svg';
const darkIcon = '/dark.svg';

const MaskIcon = ({ icon, className }: { icon: string; className?: string }) => (
  <span
    aria-hidden
    className={className}
    style={{
      mask: `url(${icon}) center / contain no-repeat`,
      WebkitMask: `url(${icon}) center / contain no-repeat`,
      backgroundColor: 'currentColor',
      display: 'inline-block',
    }}
  />
);

export function ThemeToggle({ isDarkMode, onToggle }: ThemeToggleProps) {
  const translate = useMemo(() => (isDarkMode ? 'translate-x-8' : 'translate-x-0'), [isDarkMode]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDarkMode}
      aria-label="Toggle dark mode"
      onClick={onToggle}
      className="relative inline-flex h-10 w-20 items-center rounded-full border border-slate-300 bg-white px-2 shadow-inner transition-colors duration-300 hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
    >
      <span className="sr-only">Toggle theme</span>
      <MaskIcon icon={lightIcon} className="absolute left-3 h-5 w-5 text-slate-500 dark:text-slate-300" />
      <MaskIcon icon={darkIcon} className="absolute right-3 h-5 w-5 text-slate-500 dark:text-slate-300" />
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow transition-transform duration-300 ${translate}`}
        aria-hidden
      >
        {isDarkMode ? '🌙' : '☀️'}
      </span>
    </button>
  );
}
