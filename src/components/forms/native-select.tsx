import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A styled native <select>: works with React Hook Form's register(), the mobile OS picker and
 * screen readers without extra wiring.
 */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
