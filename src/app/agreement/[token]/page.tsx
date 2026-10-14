import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContractBody } from '@/modules/hiring/components/contract-body';
import { getAgreementByToken } from '@/modules/platform/agreement-public';
import { AcceptAgreement } from '@/modules/platform/components/agreement-accept';

// The address itself is the secret: keep it out of search engines and out of Referer headers.
export const metadata: Metadata = {
  title: 'Service agreement',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function AgreementPage({ params }: PageProps<'/agreement/[token]'>) {
  const { token } = await params;
  const agreement = /^[A-Za-z0-9_-]{40,50}$/.test(token) ? await getAgreementByToken(token) : null;

  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-10">
      <DotBackground />
      <div className="flex w-full max-w-2xl flex-col gap-5">
        {!agreement ? (
          <Card>
            <CardHeader>
              <CardTitle>This link is no longer valid</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              It may have expired, been replaced by a newer one, or already been used to accept. If
              you have already accepted, sign in, or use “Forgot password” to choose your password.
              Otherwise, ask Meroidea for a new link.
            </CardContent>
          </Card>
        ) : (
          <>
            <header>
              <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {agreement.businessName}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                {agreement.recipientName}, please review your service agreement
              </h1>
              <p className="mt-1 text-muted-foreground">
                Your workspace opens once you accept. You will then choose your own password.
              </p>
            </header>
            <Card>
              <CardHeader>
                <CardTitle>
                  {agreement.title}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    · version {agreement.version}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ContractBody body={agreement.body} />
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <AcceptAgreement token={token} businessName={agreement.businessName} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
