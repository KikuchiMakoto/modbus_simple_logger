import { useEffect, useRef, useState, type ReactNode } from 'react';

type SlidePanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  accent?: 'emerald' | 'blue';
  maxWidth?: string;
  headerActions?: ReactNode;
  children: ReactNode;
};

export function SlidePanel({
  open,
  onClose,
  title,
  subtitle,
  accent = 'emerald',
  maxWidth = 'max-w-md',
  headerActions,
  children,
}: SlidePanelProps) {
  const [visible, setVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setVisible(true);
      const raf = requestAnimationFrame(() => setPanelOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    setPanelOpen(false);
    // Fallback for when the close transition's transitionend never fires
    // (interrupted transition, background tab, etc.) — otherwise the
    // invisible backdrop stays mounted and blocks all pointer events.
    const timer = window.setTimeout(() => setVisible(false), 350);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    if (e.target === panelRef.current && !open) {
      setVisible(false);
    }
  };

  const accentColor = accent === 'blue'
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-emerald-600 dark:text-emerald-400';

  return (
    <>
      {visible && (
        <div
          className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${panelOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={onClose}
        />
      )}

      <div
        ref={panelRef}
        onTransitionEnd={handleTransitionEnd}
        className={`fixed inset-y-0 right-0 z-50 w-full ${maxWidth} transform bg-white transition-transform duration-300 dark:bg-slate-900 ${
          panelOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <h2 className={`text-xl font-bold ${accentColor}`}>
                {title}
              </h2>
              {subtitle && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {subtitle}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
              className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
              aria-label={`Close ${title}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            </div>
          </div>

          {children}
        </div>
      </div>
    </>
  );
}
