import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/card';
import { getTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Get started' };

/** Businesses are onboarded by Meroidea after a conversation, not by signing up here (ADR-029). */
export default async function SignupPage() {
  if (await getTenantContext()) redirect('/dashboard');

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
