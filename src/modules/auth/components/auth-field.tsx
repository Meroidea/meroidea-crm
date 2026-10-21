'use client';

import type { ComponentProps } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';

type AuthFieldProps = ComponentProps<typeof Input> & {
  label: string;
  name: string;
  error?: string | undefined;
};

export function AuthField({ label, name, error, type, ...props }: AuthFieldProps) {
  const errorId = `${name}-error`;
  const fieldProps = {
    id: name,
    name,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? errorId : undefined,
    ...props,
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {type === 'password' ? (
        <PasswordInput {...fieldProps} />
      ) : (
        <Input type={type} {...fieldProps} />
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
