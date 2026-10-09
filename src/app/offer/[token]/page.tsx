import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/hiring/compliance';
import { ContractBody } from '@/modules/hiring/components/contract-body';
import { AcceptOffer, Done, PayrollForm } from '@/modules/hiring/components/offer-response';
import { getOfferByToken } from '@/modules/hiring/public';

// The address itself is the secret: keep it out of search engines and out of Referer headers.
export const metadata: Metadata = {
  title: 'Your offer',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function OfferPage({ params }: PageProps<'/offer/[token]'>) {
  const { token } = await params;
  const offer = /^[A-Za-z0-9_-]{40,50}$/.test(token) ? await getOfferByToken(token) : null;

  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-10">
      <DotBackground />
      <div className="flex w-full max-w-2xl flex-col gap-5">
        {!offer ? (
          <Card>
            <CardHeader>
              <CardTitle>This link is no longer valid</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              It may have expired, been replaced by a newer one, or been withdrawn. Ask the person
              who sent it to you for a new link.
            </CardContent>
          </Card>
        ) : (
          <>
            <header>
              <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {offer.employerName}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                {offer.firstName}, here is your{' '}
                {offer.employmentType === 'contractor' ? 'agreement' : 'offer'}
              </h1>
              <p className="mt-1 text-muted-foreground">
                {offer.positionTitle} · {EMPLOYMENT_TYPE_LABELS[offer.employmentType]}
              </p>
            </header>

            {offer.status === 'declined' && (
              <Done title="You declined this offer">
                {offer.employerName} has been told. There is nothing more to do here.
              </Done>
            )}
            {offer.status === 'accepted' && (
              <Done title="You accepted">
                Recorded on{' '}
                {formatDateTime({ tenant: { timezone: offer.timezone } }, offer.acceptedAt)}. Keep a
                copy of the wording below for your records.
              </Done>
            )}

            {offer.payrollReceived && (
              <Done title="Your tax, bank and super details were received">
                To change them, contact {offer.employerName} directly.
              </Done>
            )}

            {offer.status === 'accepted' && offer.payrollWanted && (
              <Card>
                <CardHeader>
                  <CardTitle>One more step: tax, bank and super</CardTitle>
                </CardHeader>
                <CardContent>
                  {offer.payrollAvailable ? (
                    <>
                      <p className="mb-4 text-sm text-muted-foreground">
                        {offer.employerName} needs these to pay you. Your numbers are encrypted
                        before they are stored and can only be seen by people authorised to run
                        payroll.
                      </p>
                      <PayrollForm token={token} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {offer.employerName} will collect these from you directly.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent>
                <ContractBody body={offer.body} />
              </CardContent>
            </Card>

            {offer.status === 'sent' && (
              <Card>
                <CardHeader>
                  <CardTitle>Your response</CardTitle>
                </CardHeader>
                <CardContent>
                  <AcceptOffer
                    token={token}
                    statements={offer.statements}
                    contractor={offer.employmentType === 'contractor'}
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
