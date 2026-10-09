import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Label + control + hint/error, wired for screen readers. The control gets id={name}. */
export function Field({
  name,
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  name: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={name}>
        {label}
        {required && (
          <span aria-hidden className="text-destructive-text">
            *
          </span>
        )}
      </Label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="text-sm text-destructive-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function fieldA11y(name: string, error?: string) {
  return {
    id: name,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${name}-error` : undefined,
  };
}
