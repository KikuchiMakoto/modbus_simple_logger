import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Badge at the app's smallest type size. Variants carry state, so
 * they reuse the state colours: success = emerald, warning = amber, and the
 * neutral slate for labels that only name something.
 */
const badgeVariants = cva('inline-block rounded px-1 py-0.5 text-[0.6rem] font-semibold leading-none', {
  variants: {
    variant: {
      neutral: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
      success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
