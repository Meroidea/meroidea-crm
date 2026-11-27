import 'server-only';

import type { InboxArea } from '@/modules/social/components/inbox-list';
import { mailboxOf, type Mailbox } from '@/modules/social/providers/types';
import { countEmailUnread, countUnread, listAccounts } from '@/modules/social/queries';
import { hasPermission, type TenantContext } from '@/server/context';

/** What an area's list shows above its conversations, and whether it has any account yet. */
export async function loadInboxArea(
  ctx: TenantContext,
  mailbox: Mailbox,
): Promise<{ area: InboxArea; hasAccounts: boolean; mailboxLabel: string | null }> {
  const { accounts } = await listAccounts(ctx);
  const own = accounts.filter((account) => mailboxOf(account.platform) === mailbox);
  if (mailbox === 'email') {
    return {
      area: { kind: 'email', unread: await countEmailUnread(ctx) },
      hasAccounts: own.length > 0,
      mailboxLabel: own[0]?.username ?? own[0]?.name ?? null,
    };
  }
  return {
    area: {
      kind: 'social',
      platforms: [...new Set(own.map((account) => account.platform))],
      unread: await countUnread(ctx),
    },
    hasAccounts: own.length > 0,
    mailboxLabel: null,
  };
}

/** Whether an area's feature is on: email for Email; social media or live chat for the inbox. */
export function areaSwitchedOn(features: readonly string[], mailbox: Mailbox): boolean {
  return mailbox === 'email'
    ? features.includes('email_channel')
    : features.includes('social') || features.includes('live_chat');
}

/** The links in an area's Settings menu, by what the person may do (ADR-073). */
export function areaSettings(
  ctx: TenantContext,
  mailbox: Mailbox,
  area: InboxArea,
): { href: string; label: string }[] {
  const canManage = hasPermission(ctx, 'social.manage');
  return [
    canManage && {
      href: mailbox === 'email' ? '/social/accounts?area=email' : '/social/accounts',
      label: mailbox === 'email' ? 'Email inbox address' : 'Connected accounts',
    },
    mailbox === 'social' &&
      canManage &&
      area.kind === 'social' &&
      area.platforms.includes('whatsapp') && {
        href: '/social/templates',
        label: 'WhatsApp templates',
      },
    hasPermission(ctx, 'social.reply') && { href: '/social/replies', label: 'Saved replies' },
  ].filter((item): item is { href: string; label: string } => Boolean(item));
}
