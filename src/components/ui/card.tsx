import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Card. Only the frame is used: the app's sections carry their own
 * compact header rows, so CardHeader/CardTitle/etc. are left out until
 * something needs them. Pass `className="p-1"` for the tight channel grids —
 * tailwind-merge resolves it against the default `p-2` (the old unlayered
 * `.card` needed a separate `.card-tight` rule placed after it to do that).
 */
function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('rounded-md border border-border bg-card p-2 text-card-foreground shadow-lg', className)}
      {...props}
    />
  );
}

export { Card };
