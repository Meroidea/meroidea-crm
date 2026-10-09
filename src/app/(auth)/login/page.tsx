import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/card';
import { SignInForm } from '@/modules/auth/components/sign-in-form';
import { getTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const expired = (await searchParams).link === 'expired';
  if (await getTenantContext()) redirect('/dashboard');

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="flex flex-col gap-6 py-8">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">Welcome back to your workspace.</p>
        </div>
        {expired && (
          <p role="alert" className="rounded-md bg-warning px-3 py-2 text-sm text-warning-text">
            That link has already been used or has expired. Ask for a new one below, or from your
            workspace admin.
          </p>
        )}
        <SignInForm />
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
