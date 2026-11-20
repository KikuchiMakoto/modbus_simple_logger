import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui NativeSelect — a styled native <select>, deliberately not the
 * Radix `Select`. Radix renders its listbox through a portal into <body>,
 * which is outside `#root` and therefore outside the UI-scale `zoom`
 * (utils/uiScale.ts): at 150% the trigger would be scaled and its popup not,
 * and the popup would be positioned in the wrong coordinate space. The native
 * popup is drawn by the browser and has neither problem. The same reasoning
 * rules out the other portal-based primitives (Dialog, Popover, Tooltip,
 * DropdownMenu) in this app.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'rounded border border-input bg-background px-1 py-0.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
