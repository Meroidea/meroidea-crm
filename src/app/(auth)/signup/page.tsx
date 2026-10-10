import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/card';
import { SignUpForm } from '@/modules/auth/components/sign-up-form';
import { getTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Get started' };

/** Businesses are onboarded by Meroidea after a conversation, not by signing up here (ADR-029). */
export default async function SignupPage() {
  if (await getTenantContext()) redirect('/dashboard');

  // The one exception: while the platform owner is creating the very first account, the
  // sign-up form is shown. The action checks the same setting, so the form alone opens nothing.
  if (process.env.ALLOW_PUBLIC_SIGNUP === 'true') {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-6 py-8">
          <div className="space-y-1.5 text-center">
            <h1 className="text-xl font-semibold">Create the first account</h1>
            <p className="text-sm text-muted-foreground">
              Sign-up is open for setup. Switch it off again once your account exists.
            </p>
          </div>
          <SignUpForm />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="flex flex-col gap-4 py-8 text-center">
        <h1 className="text-xl font-semibold">We set it up with you</h1>
        <p className="text-sm text-muted-foreground">
          Every business works differently, so we start with a short conversation and build your
          workspace around what you need. You then receive your sign-in details from us.
        </p>
        <p className="text-sm text-muted-foreground">
          Already have them?{' '}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
