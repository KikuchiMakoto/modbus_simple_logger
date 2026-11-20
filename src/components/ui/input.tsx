import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Input at the app's density. Callers routinely restyle size and
 * alignment (channel-card labels are text-xs and centred, numeric cells are
 * right-aligned); tailwind-merge lets those override the defaults below.
 */
function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'min-w-0 rounded border border-input bg-background px-2 py-0.5 text-sm text-foreground outline-none placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-slate-400 dark:placeholder:text-slate-500 dark:disabled:text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
