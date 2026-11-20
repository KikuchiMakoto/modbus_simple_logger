import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Alert, as the app's inline notice box. Variants follow the colour
 * rules (AGENTS.md 配色ルール), not severity for its own sake:
 *   neutral  slate — a standing state worth knowing: locked, not connected
 *   warning  amber — "this can cost you something": an unlocked lock, data
 *            that will not survive, a step that must not be skipped
 * There is deliberately no red variant yet: an error that *happened* goes to
 * the System Log, which already renders ERROR in red.
 */
const alertVariants = cva('rounded border px-2 py-1 font-medium leading-snug', {
  variants: {
    variant: {
      neutral:
        'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
      warning:
        'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-300',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="note" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export { Alert, alertVariants };
