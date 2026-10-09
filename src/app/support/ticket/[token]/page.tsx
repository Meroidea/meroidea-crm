import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CustomerReply } from '@/modules/helpdesk/components/public-forms';
import { getPublicTicket } from '@/modules/helpdesk/public';

// The address itself is the secret: keep it out of search engines and out of Referer headers.
export const metadata: Metadata = {
  title: 'Your request',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const STATUS_TEXT: Record<string, string> = {
  open: 'With the team',
  pending: 'Waiting for your reply',
  on_hold: 'With the team',
  solved: 'Solved',
  closed: 'Closed',
};

const when = (date: Date) =>
  new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);

export default async function PublicTicketPage({ params }: PageProps<'/support/ticket/[token]'>) {
  const { token } = await params;
  const ticket = await getPublicTicket(token);
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-10">
      <DotBackground />
      <div className="flex w-full max-w-xl flex-col gap-5">
        {!ticket ? (
          <Card>
            <CardHeader>
              <CardTitle>This request was not found</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Check the address, or contact the business again.
            </CardContent>
          </Card>
        ) : (
          <>
            <header className="flex flex-col gap-2">
              <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {ticket.businessName} · Request #{ticket.number}
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-balance">
                {ticket.subject}
              </h1>
              <div>
                <Badge variant={ticket.status === 'pending' ? 'default' : 'secondary'}>
                  {STATUS_TEXT[ticket.status] ?? 'With the team'}
                </Badge>
              </div>
            </header>
            <ol className="flex flex-col gap-3">
              {ticket.messages.map((message) => (
                <li
                  key={message.id}
                  className={cn(
                    'rounded-xl border bg-card p-4',
                    message.fromStaff && 'border-primary/30 bg-accent',
                  )}
                >
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {message.fromStaff ? `${message.authorName} · ${ticket.businessName}` : 'You'}
                    </span>{' '}
                    · {when(message.createdAt)}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{message.body}</p>
                </li>
              ))}
            </ol>
            {ticket.status === 'closed' ? (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                This request is closed. If you need more help, please send a new one.
              </p>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <CustomerReply token={token} />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
