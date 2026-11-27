import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifyDocument } from '@/modules/esign/components/verify-document';

export const metadata: Metadata = {
  title: 'Check a signed document',
  description: 'Confirm a PDF signed with Meroidea is genuine and has not been changed.',
};

export default function VerifyPage() {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-10">
      <DotBackground />
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck aria-hidden className="size-6 text-primary" />
            Check a signed document
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose a PDF that was signed with Meroidea. We compare its fingerprint with the one
            recorded when the last person signed, so you can tell it is genuine and unchanged.
          </p>
        </CardHeader>
        <CardContent>
          <VerifyDocument />
        </CardContent>
      </Card>
    </div>
  );
}
