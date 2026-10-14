import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { SignOutButton } from '@/components/layout/sign-out-button';

export const metadata: Metadata = { title: 'Service agreement' };

export default function AwaitingAgreementPage() {
  return (
    <div className="relative isolate flex min-h-svh items-center justify-center p-6">
      <DotBackground />
      <div className="max-w-md rounded-xl border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold">Accept the service agreement first</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your workspace opens once your business’s admin has accepted the service agreement with
          Meroidea. Use the link in the email Meroidea sent them, or ask Meroidea to send a new one.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
