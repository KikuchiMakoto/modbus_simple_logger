import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Checkbox (Radix; no portal, so the UI-scale zoom is unaffected).
 * The check mark is an inline SVG rather than lucide-react's CheckIcon: it is
 * the only icon the ui/ set needs, and a whole icon package is not worth one
 * glyph in a bundle that is precached and embedded in the exe.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-3.5 shrink-0 rounded-[4px] border border-input bg-background outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center text-current">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
