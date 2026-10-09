'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { signUpAction } from '@/modules/auth/actions';
import { signUpSchema, type SignUpInput } from '@/modules/auth/schemas';

import { AuthField } from './auth-field';

export function SignUpForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await signUpAction(values);
    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <AuthField
        label="Your name"
        autoComplete="name"
        error={errors.fullName?.message}
        {...register('fullName')}
      />
      <AuthField
        label="Company name"
        autoComplete="organization"
        error={errors.companyName?.message}
        {...register('companyName')}
      />
      <AuthField
        label="Work email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <AuthField
        label="Password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register('password')}
      />

      {formError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {formError}
        </p>
      )}

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Creating your workspace…' : 'Create workspace'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        14-day trial. No card needed. You can invite your team once you are in.
      </p>
    </form>
  );
}
