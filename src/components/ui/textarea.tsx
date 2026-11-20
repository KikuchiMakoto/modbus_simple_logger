import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:placeholder:text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
