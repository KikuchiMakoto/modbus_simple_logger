import { useEffect, useState, type ReactNode } from 'react';
import { Rnd } from 'react-rnd';

type WindowGeometry = { x: number; y: number; width: number; height: number };

// Remember each window's last position/size across close → reopen (per session).
const geometryStore = new Map<string, WindowGeometry>();

// Bring-to-front counter shared by all floating windows.
let zIndexCounter = 30;
// Cascade offset so windows opened in sequence don't fully overlap.
let cascadeCounter = 0;

const VIEWPORT_MARGIN = 8;

function clampToViewport(geometry: WindowGeometry): WindowGeometry {
  const width = Math.min(geometry.width, window.innerWidth - VIEWPORT_MARGIN * 2);
  const height = Math.min(geometry.height, window.innerHeight - VIEWPORT_MARGIN * 2);
  const x = Math.max(VIEWPORT_MARGIN, Math.min(geometry.x, window.innerWidth - width - VIEWPORT_MARGIN));
  const y = Math.max(VIEWPORT_MARGIN, Math.min(geometry.y, window.innerHeight - height - VIEWPORT_MARGIN));
  return { x, y, width, height };
}

function initialGeometry(id: string, defaultWidth: number, defaultHeight: number): WindowGeometry {
  const stored = geometryStore.get(id);
  if (stored) return clampToViewport(stored);
  const offset = (cascadeCounter++ % 8) * 28;
  return clampToViewport({
    x: 72 + offset,
    y: 64 + offset,
    width: defaultWidth,
    height: defaultHeight,
  });
}

type FloatingWindowProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  accent?: 'emerald' | 'blue';
  headerActions?: ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  children: ReactNode;
};

export function FloatingWindow({
  open,
  onClose,
  title,
  subtitle,
  accent = 'emerald',
  headerActions,
  defaultWidth = 384,
  defaultHeight = 520,
  children,
}: FloatingWindowProps) {
  const [geometry, setGeometry] = useState<WindowGeometry | null>(null);
  const [zIndex, setZIndex] = useState(zIndexCounter);

  useEffect(() => {
    if (open) {
      setGeometry(initialGeometry(title, defaultWidth, defaultHeight));
      setZIndex(++zIndexCounter);
    } else {
      setGeometry(null);
    }
  }, [open, title, defaultWidth, defaultHeight]);

  if (!open || !geometry) return null;

  const updateGeometry = (next: WindowGeometry) => {
    setGeometry(next);
    geometryStore.set(title, next);
  };

  const bringToFront = () => {
    setZIndex(++zIndexCounter);
  };

  const accentColor = accent === 'blue'
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex }}>
      <Rnd
        position={{ x: geometry.x, y: geometry.y }}
        size={{ width: geometry.width, height: geometry.height }}
        minWidth={280}
        minHeight={180}
        bounds="parent"
        dragHandleClassName="floating-window-drag-handle"
        onDragStart={bringToFront}
        onResizeStart={bringToFront}
        onDragStop={(_e, d) => {
          updateGeometry({ ...geometry, x: d.x, y: d.y });
        }}
        onResizeStop={(_e, _dir, ref, _delta, position) => {
          updateGeometry({
            x: position.x,
            y: position.y,
            width: ref.offsetWidth,
            height: ref.offsetHeight,
          });
        }}
        className="pointer-events-auto overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_0_20px_6px_rgba(0,0,0,0.25)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_0_20px_6px_rgba(255,255,255,0.15)]"
        style={{ display: 'flex', flexDirection: 'column' }}
        onMouseDown={bringToFront}
        onTouchStart={bringToFront}
        role="dialog"
        aria-label={title}
      >
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-700">
            <div className="floating-window-drag-handle min-w-0 flex-1 cursor-move touch-none select-none">
              <h2 className={`truncate text-lg font-bold ${accentColor}`}>
                {title}
              </h2>
              {subtitle && (
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                  {subtitle}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 pl-2">
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

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </div>
      </Rnd>
    </div>
  );
}
