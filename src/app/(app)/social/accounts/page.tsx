import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Avatar } from '@/components/data/avatar';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { getLeadConfig } from '@/modules/leads/config';
import {
  AccountLeadSetting,
  ConnectButton,
  DisconnectButton,
} from '@/modules/social/components/social-tools';
import {
  ChatWidgetCreate,
  ChatWidgetSettings,
} from '@/modules/social/components/chat-widget-setup';
import { EmailInboxConnect } from '@/modules/social/components/email-inbox-connect';
import { WhatsAppConnect } from '@/modules/social/components/whatsapp-connect';
import { inboxDomain } from '@/modules/social/providers/resend';
import {
  ACCOUNT_STATUS_LABELS,
  HISTORY_SYNC_LABELS,
  PLATFORM_LABELS,
} from '@/modules/social/format';
import { whatsappSignupSettings } from '@/modules/social/providers/whatsapp';
import { mailboxOf, type Mailbox } from '@/modules/social/providers/types';
import { listAccounts } from '@/modules/social/queries';
import { requirePermission, requireTenantContext } from '@/server/context';
import { serverEnv } from '@/server/env';

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
  // Each area keeps its own settings (ADR-073): Email's inbox address, or the Social inbox's
  // social media accounts and website chat.
  const area: Mailbox = params.area === 'email' ? 'email' : 'social';
  const listed = await listAccounts(ctx);
  const available = listed.available;
  const accounts = listed.accounts.filter((account) => mailboxOf(account.platform) === area);
  // New leads for unknown senders need the CRM (ADR-068).
  const crm = ctx.tenant.features.includes('crm');
  // Tickets for new conversations need the helpdesk (ADR-069).
  const helpdesk = ctx.tenant.features.includes('helpdesk');
  // Each channel is its own feature (ADR-070): social media, and the email inbox.
  const socialOn = area === 'social' && ctx.tenant.features.includes('social');
  const emailOn = area === 'email' && ctx.tenant.features.includes('email_channel');
  const chatOn = area === 'social' && ctx.tenant.features.includes('live_chat');
  const appUrl = serverEnv().APP_URL.replace(/\/+$/, '');
  const domain = inboxDomain();
  const sources = crm
    ? (await getLeadConfig(ctx)).sources
        .filter((source) => source.isActive)
        .map((source) => ({ id: source.id, name: source.name }))
    : [];
  const whatsapp = available.whatsapp ? whatsappSignupSettings() : null;
  const one = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : null);
  const error = one('error');
  const connected = Number(one('connected') ?? NaN);
  const skipped = Number(one('skipped') ?? 0);
  const failed = Number(one('failed') ?? 0);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <Link
        href={area === 'email' ? '/email' : '/social'}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {area === 'email' ? 'Email' : 'Social inbox'}
      </Link>
      <PageHeader
        title={area === 'email' ? 'Email inbox address' : 'Connected accounts'}
        description={
          area === 'email'
            ? 'The address whose emails arrive in Email, threaded, with replies sent from it.'
            : 'The social media accounts and website chats whose messages arrive in the Social inbox.'
        }
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
        {chatOn && (
          <Card>
            <CardHeader>
              <CardTitle>Live chat</CardTitle>
              <CardDescription>
                A chat button for your website. Visitors&rsquo; messages arrive here and your
                replies appear in their chat straight away.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChatWidgetCreate appUrl={appUrl} defaultName={ctx.tenant.name} />
            </CardContent>
          </Card>
        )}
        {emailOn && (
          <Card>
            <CardHeader>
              <CardTitle>Email</CardTitle>
              <CardDescription>
                An address whose emails arrive here, threaded, with replies sent from it. Publish
                it, or forward your own support address to it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {available.email && domain ? (
                <EmailInboxConnect
                  domain={domain}
                  defaultName={ctx.tenant.name}
                  defaultLocal={ctx.tenant.slug.slice(0, 40)}
                  contactLabel={ctx.tenant.labels.contact.singular}
                  crm={crm}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not available yet: the platform owner has not finished setting it up.
                </p>
              )}
            </CardContent>
          </Card>
        )}
        {socialOn && (
          <>
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
                <CardTitle>WhatsApp</CardTitle>
                <CardDescription>
                  Connect your business&rsquo;s WhatsApp number through Meta. Customers&rsquo;
                  WhatsApp messages then arrive here, and you can answer them.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {whatsapp ? (
                  <WhatsAppConnect
                    appId={whatsapp.appId}
                    configId={whatsapp.configId}
                    graphVersion={whatsapp.graphVersion}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Not available yet: the platform owner has not finished setting it up.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Meta charges your business directly: approved templates, and replies beyond 1,000
                  a month per number. Add a payment method in Meta Business Suite (Billing &amp;
                  payments), or replies past the free 1,000 are not delivered.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>TikTok</CardTitle>
                <CardDescription>
                  Log in with your TikTok business account. It needs to be a Verified Business
                  Account set to accept messages from everyone. Not available for accounts
                  registered in the EU, Switzerland or the UK.
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
          </>
        )}
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
                    {account.username
                      ? account.platform === 'whatsapp' || account.platform === 'email'
                        ? `${account.username} · `
                        : `@${account.username} · `
                      : ''}
                    {account.conversations}{' '}
                    {account.conversations === 1 ? 'conversation' : 'conversations'} · connected{' '}
                    {formatDateTime(ctx, account.connectedAt)}
                  </p>
                  {account.platform === 'whatsapp' && account.coexistence && (
                    <p className="text-sm text-muted-foreground">
                      Also used in the WhatsApp Business app
                      {account.historySync && HISTORY_SYNC_LABELS[account.historySync]
                        ? ` · ${HISTORY_SYNC_LABELS[account.historySync]}${
                            account.historySync === 'in_progress' &&
                            account.historyProgress !== null
                              ? ` (${account.historyProgress}%)`
                              : ''
                          }`
                        : ''}
                    </p>
                  )}
                  {account.lastError && (
                    <p className="text-sm text-destructive-text">{account.lastError}</p>
                  )}
                  {account.platform === 'whatsapp' && (
                    <Link
                      href="/social/templates"
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Message templates
                    </Link>
                  )}
                </div>
                <DisconnectButton accountId={account.id} name={account.name} />
                {account.platform === 'livechat' && account.widgetKey && (
                  <div className="w-full sm:pl-13">
                    <ChatWidgetSettings
                      appUrl={appUrl}
                      accountId={account.id}
                      widgetKey={account.widgetKey}
                      name={account.name}
                      settings={account.settings}
                    />
                  </div>
                )}
                {(crm || helpdesk) && (
                  <div className="w-full sm:pl-13">
                    <AccountLeadSetting
                      accountId={account.id}
                      settings={account.settings}
                      sources={sources}
                      contactLabel={ctx.tenant.labels.contact.singular}
                      crm={crm}
                      helpdesk={helpdesk}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
