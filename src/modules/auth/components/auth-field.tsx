'use client';

import type { ComponentProps } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type AuthFieldProps = ComponentProps<typeof Input> & {
  label: string;
  name: string;
  error?: string | undefined;
};

export function AuthField({ label, name, error, ...props }: AuthFieldProps) {
  const errorId = `${name}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
