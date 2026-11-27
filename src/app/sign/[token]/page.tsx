import { CheckCircle2, CircleSlash, Clock, FileSignature } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';

import { DotBackground } from '@/components/layout/dot-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CodeGate,
  DownloadSigned,
  SigningForm,
} from '@/modules/esign/components/signing-experience';
import { getSigningView } from '@/modules/esign/public';
import { clientAddress } from '@/server/request';

// The address itself is the secret: keep it out of search engines and out of Referer headers.
export const metadata: Metadata = {
  title: 'Review and sign',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4 text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

const when = (date: Date | null, timezone: string) =>
  date
    ? new Intl.DateTimeFormat('en-AU', {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : '';

export default async function SignPage({ params }: PageProps<'/sign/[token]'>) {
  const { token } = await params;
  const store = await cookies();
  const list = await headers();
  const view = /^[A-Za-z0-9_-]{40,50}$/.test(token)
    ? await getSigningView(token, (name) => store.get(name)?.value, {
        ip: clientAddress(list),
        userAgent: list.get('user-agent'),
      })
    : null;

  let body: ReactNode;
  if (!view) {
    body = (
      <Notice
        icon={<CircleSlash aria-hidden className="size-5" />}
        title="This link is no longer valid"
      >
        It may have expired, been replaced by a newer one, or the request may have been withdrawn.
        Ask the person who sent it to you for a new link.
      </Notice>
    );
  } else if (view.needsCode) {
    body = <CodeGate token={token} maskedEmail={view.maskedEmail} />;
  } else if (view.requestStatus === 'completed') {
    body = (
      <Notice
        icon={<CheckCircle2 aria-hidden className="size-5 text-chart-1" />}
        title="Everyone has signed"
      >
        <p>
          The signed copy includes a certificate with the signing history. Download it and keep it
          somewhere safe; this link closes 30 days after signing finished.
        </p>
        <DownloadSigned token={token} />
      </Notice>
    );
  } else if (view.requestStatus === 'declined' || view.requestStatus === 'voided') {
    body = (
      <Notice icon={<CircleSlash aria-hidden className="size-5" />} title="This request is closed">
        {view.signerStatus === 'declined'
          ? `You declined to sign. ${view.senderName} has been told.`
          : view.requestStatus === 'declined'
            ? 'Someone declined to sign, so the request was closed. There is nothing more to do.'
            : `${view.businessName} withdrew this request. There is nothing to sign.`}
      </Notice>
    );
  } else if (view.expired) {
    body = (
      <Notice icon={<Clock aria-hidden className="size-5" />} title="This request has expired">
        It could be signed until {when(view.expiresAt, view.timezone)}. Ask {view.senderName} to
        send it again.
      </Notice>
    );
  } else if (view.signerStatus === 'signed') {
    body = (
      <Notice
        icon={<CheckCircle2 aria-hidden className="size-5 text-chart-1" />}
        title="You’ve signed"
      >
        Signed {when(view.signedAt, view.timezone)}. {view.progress.signed} of {view.progress.total}{' '}
        have signed so far. We’ll email you a link to the signed copy once everyone has.
      </Notice>
    );
  } else if (view.waitingFor) {
    body = (
      <Notice icon={<Clock aria-hidden className="size-5" />} title="Not your turn yet">
        This request is signed in order, and {view.waitingFor} signs before you. We’ll email you
        when it’s your turn.
      </Notice>
    );
  } else {
    body = <SigningForm token={token} view={view} />;
  }

  const signing = Boolean(view && !view.needsCode && body && view.fields.length > 0);

  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-8">
      <DotBackground />
      <div
        className={
          signing ? 'flex w-full max-w-3xl flex-col gap-5' : 'flex w-full max-w-xl flex-col gap-5'
        }
      >
        {view && (
          <header>
            <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {view.businessName}
            </p>
            <h1 className="mt-2 flex items-start gap-2 text-2xl font-semibold tracking-tight">
              <FileSignature aria-hidden className="mt-1 size-6 shrink-0 text-primary" />
              {view.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              From {view.senderName} for {view.signerName}
            </p>
            {view.message && !view.needsCode && (
              <p className="mt-3 rounded-lg border bg-card px-4 py-3 text-sm whitespace-pre-line">
                {view.message}
              </p>
            )}
          </header>
        )}
        {body}
        <p className="text-center text-xs text-muted-foreground">
          Signed electronically with Meroidea. Anyone can check a signed copy at{' '}
          <a href="/verify" className="underline underline-offset-4">
            /verify
          </a>
          .
        </p>
      </div>
    </div>
  );
}
