import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Avatar } from '@/components/data/avatar';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { ConnectButton, DisconnectButton } from '@/modules/social/components/social-tools';
import { ACCOUNT_STATUS_LABELS, PLATFORM_LABELS } from '@/modules/social/format';
import { listAccounts } from '@/modules/social/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Connected accounts' };

const ERRORS: Record<string, string> = {
  cancelled: 'Connecting was cancelled before any account was shared.',
  expired: 'That sign-in took too long or came from another window. Please try again.',
  forbidden: 'You do not have permission to connect accounts.',
  provider: 'The platform refused the connection. Please try again, or ask the platform owner.',
  internal: 'Something went wrong on our side while connecting. Please try again.',
  unknown: 'That is not a platform Meroidea connects to.',
};

export default async function ConnectedAccountsPage({
  searchParams,
}: PageProps<'/social/accounts'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.manage');
  const params = await searchParams;
  const { accounts, available } = await listAccounts(ctx);
  const one = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : null);
  const error = one('error');
  const connected = Number(one('connected') ?? NaN);
  const skipped = Number(one('skipped') ?? 0);
  const failed = Number(one('failed') ?? 0);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <Link
        href="/social"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Social inbox
      </Link>
      <PageHeader
        title="Connected accounts"
        description="The business accounts whose direct messages arrive in your social inbox."
      />

      {error && ERRORS[error] && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {ERRORS[error]}
        </p>
      )}
      {Number.isFinite(connected) && (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm">
          {connected === 0
            ? 'No accounts were connected.'
            : `Connected ${connected} ${connected === 1 ? 'account' : 'accounts'} and imported recent conversations.`}
          {skipped > 0 &&
            ` ${skipped} ${skipped === 1 ? 'account is' : 'accounts are'} already connected to another business and ${skipped === 1 ? 'was' : 'were'} left alone.`}
          {failed > 0 && ` ${failed} could not import messages yet; see the account below for why.`}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Facebook and Instagram</CardTitle>
            <CardDescription>
              Log in with Facebook or Instagram and choose your Facebook Pages and Instagram
              professional accounts. Messenger and Instagram Direct messages then arrive here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {available.meta ? (
              <ConnectButton provider="meta" label="Connect Facebook or Instagram" />
            ) : (
              <p className="text-sm text-muted-foreground">
                Not available yet: the platform owner has not finished setting it up.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>TikTok</CardTitle>
            <CardDescription>
              Log in with your TikTok business account. It needs to be a Verified Business Account
              set to accept messages from everyone. Not available for accounts registered in the EU,
              Switzerland or the UK.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {available.tiktok ? (
              <ConnectButton provider="tiktok" label="Connect TikTok" />
            ) : (
              <p className="text-sm text-muted-foreground">
                Not available yet: the platform owner has not finished setting it up.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <section
        aria-label="Connected accounts"
        className="overflow-hidden rounded-xl border bg-card"
      >
        <header className="border-b bg-muted/40 px-4 py-2.5">
          <h2 className="text-sm font-medium">Connected</h2>
        </header>
        {accounts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No accounts connected yet.</p>
        ) : (
          <ul className="divide-y">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <Avatar name={account.name} className="size-9 text-xs" />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{account.name}</span>
                    <Badge variant="outline">{PLATFORM_LABELS[account.platform]}</Badge>
                    <Badge variant={account.status === 'active' ? 'secondary' : 'destructive'}>
                      {ACCOUNT_STATUS_LABELS[account.status] ?? account.status}
                    </Badge>
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {account.username ? `@${account.username} · ` : ''}
                    {account.conversations}{' '}
                    {account.conversations === 1 ? 'conversation' : 'conversations'} · connected{' '}
                    {formatDateTime(ctx, account.connectedAt)}
                  </p>
                  {account.lastError && (
                    <p className="text-sm text-destructive-text">{account.lastError}</p>
                  )}
                </div>
                <DisconnectButton accountId={account.id} name={account.name} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
