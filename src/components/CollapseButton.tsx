// The chevron that expands and collapses a section, used by the Analog Input /
// Analog Output / Parameter groups on the main page and by the Script Runner's
// API Reference.
//
// It exists as a visible control rather than a clickable heading because a
// heading that happens to toggle is invisible: nothing on screen says the
// section can be opened. That was the concrete problem with the <details>
// element this replaced in the Script Runner.
//
// Drawn inline as a Feather Icon (MIT, (c) Cole Bemis) on the same stroked
// 24x24 grid as the hamburger and the theme switch, so the app reads as one
// icon set. Inlined rather than pulled from an icon package because everything
// this app ships has to be precached for offline use, and this is one path.
export function CollapseButton({
  collapsed,
  onToggle,
  label,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** What is being collapsed — read out in the tooltip and by screen readers. */
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? `Expand ${label}` : `Minimize ${label}`}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
      >
        <polyline points="5 8 10 13 15 8" />
      </svg>
    </button>
  );
}
