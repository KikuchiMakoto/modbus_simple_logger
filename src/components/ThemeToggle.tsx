// Not a Unicode glyph (☀ / ☾): those render from whatever font the platform
// picks — colour emoji on some, a thin outline on others — and would be the one
// element in the UI not drawn from the bundled Iosevka stack.
function SunIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 1.5v2M12 20.5v2M3.6 3.6l1.4 1.4M19 19l1.4 1.4M1.5 12h2M20.5 12h2M3.6 20.4 5 19M19 5l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/**
 * Light/dark switch. Its home is the Menu panel's header.
 */
export function ThemeToggle({ isDarkMode, onToggle }: { isDarkMode: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDarkMode}
      aria-label="Toggle dark mode"
      onClick={onToggle}
      className="relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border border-slate-300 bg-white px-1 shadow-inner transition-colors duration-300 hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
    >
      <span className="sr-only">Toggle theme</span>
      <span className="absolute left-1 text-slate-400 dark:text-slate-500" aria-hidden>
        <SunIcon className="h-3.5 w-3.5" />
      </span>
      <span className="absolute right-1 text-slate-400 dark:text-slate-500" aria-hidden>
        <MoonIcon className="h-3.5 w-3.5" />
      </span>
      {/* The knob covers whichever side icon is active, so the pair below reads
          as "current mode" rather than duplicating it. */}
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow transition-transform duration-300 ${isDarkMode ? 'translate-x-[26px]' : 'translate-x-0'}`}
        aria-hidden
      >
        {isDarkMode ? <MoonIcon className="h-3.5 w-3.5" /> : <SunIcon className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}
