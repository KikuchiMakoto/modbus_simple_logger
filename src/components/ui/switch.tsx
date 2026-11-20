import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Switch (Radix; no portal). `thumbClassName` and `children` exist
 * for the theme toggle, whose thumb carries the current mode's icon and whose
 * track shows both icons behind it — `children` render inside the track,
 * under the thumb.
 */
function Switch({
  className,
  thumbClassName,
  thumbContent,
  children,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  thumbClassName?: string;
  thumbContent?: React.ReactNode;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-input bg-background px-0.5 shadow-inner transition-colors outline-none enabled:hover:border-primary-hover focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition-transform duration-300 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
          thumbClassName,
        )}
      >
        {thumbContent}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

export { Switch };
