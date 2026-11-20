import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui ToggleGroup, used as the app's segmented control (exactly one of
 * a few modes, e.g. Measured / Spec). Radix gives it roving focus and arrow
 * keys; no portal, so the UI-scale zoom is unaffected.
 *
 * Use `type="single"` and keep a value selected: Radix lets a click on the
 * active item clear the selection (value ''), which a mode switch must not
 * allow — callers ignore an empty value (see SegmentedControl below).
 */
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('flex rounded border border-border p-0.5 dark:border-slate-700', className)}
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'flex-1 rounded-sm px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition-colors outline-none enabled:hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/60 dark:text-slate-300 dark:enabled:hover:bg-slate-800 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:enabled:hover:bg-primary',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The single-choice wrapper every caller wants: a value that can never be
 * deselected, and options given as data.
 */
function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  itemClassName,
  'aria-label': ariaLabel,
}: {
  value: T;
  onValueChange: (next: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
  className?: string;
  itemClassName?: string;
  'aria-label'?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      aria-label={ariaLabel}
      className={className}
    >
      {options.map(([optionValue, label]) => (
        <ToggleGroupItem key={optionValue} value={optionValue} className={itemClassName}>
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export { ToggleGroup, ToggleGroupItem, SegmentedControl };
