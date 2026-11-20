import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Button, re-tuned to this app's density and palette.
 *
 * Variants are by *meaning*, not by look (AGENTS.md 配色ルール):
 *   default      emerald fill — the "go" action of a group (Connect, Run, Apply)
 *   outline      slate outline with an emerald hover — everything ordinary
 *   destructive  rose outline — destroys work but sits next to ordinary controls
 *                (Clear). Outline, so it still loses the eye to Run beside it
 *   recording    pulsing red fill — "a run is in progress, this stops it"
 *                (Stop Save, Stop). The animation lives in index.css
 *   accent       emerald outline — a secondary action that is still "take this"
 *                (Input Calibrator's Grab)
 *   ghost        no frame — small controls inside dense rows
 *
 * Sizes are the app's established ones, largest first. `touch` is the header's
 * Connect / Start Save: those get hit under time pressure, so they stay a size
 * up from `sm` while the header saves height elsewhere.
 *
 * Disabled keeps pointer events (no `pointer-events-none`, unlike upstream):
 * several disabled buttons carry a `title` explaining *why* they are disabled
 * (e.g. locked while a script runs), and that tooltip needs the hover.
 *
 * Every hover style is written `enabled:hover:`, so a disabled button never
 * reacts to the pointer in either theme — no per-colour `disabled:hover:`
 * resets to keep in sync with the resting colours. Callers that recolour a
 * button's hover must use the same `enabled:hover:` prefix (and
 * `dark:enabled:hover:` for dark), so tailwind-merge replaces the variant's
 * rule instead of keeping both.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow enabled:hover:bg-primary-hover',
        outline: 'border border-input text-muted-foreground enabled:hover:border-primary-hover enabled:hover:text-primary-text',
        destructive:
          'border border-rose-300 text-rose-700 enabled:hover:border-rose-500 enabled:hover:bg-rose-50 dark:border-rose-500/60 dark:text-rose-300 dark:enabled:hover:border-rose-400 dark:enabled:hover:bg-rose-950/40',
        recording: 'stop-save-pulse text-destructive-foreground shadow',
        accent:
          'border border-primary-hover text-primary-text enabled:hover:bg-emerald-50 enabled:active:bg-emerald-100 dark:border-emerald-400/60 dark:enabled:hover:bg-emerald-400/10',
        ghost: 'text-slate-500 enabled:hover:bg-accent enabled:hover:text-accent-foreground dark:text-slate-400',
      },
      size: {
        default: 'rounded-lg px-4 py-1.5 text-sm',
        touch: 'rounded-lg px-3 py-1 text-sm',
        sm: 'rounded-lg px-3 py-1 text-xs',
        xs: 'rounded px-1.5 py-0.5 text-xs',
        '2xs': 'rounded px-1.5 py-0 text-[11px]',
        icon: 'rounded p-1',
        'icon-lg': 'rounded-lg p-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      // A bare <button> defaults to type="submit"; nothing in this app submits a form.
      type={asChild ? type : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
