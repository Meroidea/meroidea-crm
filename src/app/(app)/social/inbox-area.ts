import 'server-only';

import type { InboxArea } from '@/modules/social/components/inbox-list';
import { mailboxOf, type Mailbox } from '@/modules/social/providers/types';
import { countEmailUnread, countUnread, listAccounts } from '@/modules/social/queries';
import type { TenantContext } from '@/server/context';

/** What an area's list shows above its conversations, and whether it has any account yet. */
export async function loadInboxArea(
  ctx: TenantContext,
  mailbox: Mailbox,
): Promise<{ area: InboxArea; hasAccounts: boolean }> {
  const { accounts } = await listAccounts(ctx);
  const own = accounts.filter((account) => mailboxOf(account.platform) === mailbox);
  if (mailbox === 'email') {
    return {
      area: { kind: 'email', unread: await countEmailUnread(ctx) },
      hasAccounts: own.length > 0,
    };
  }
  return {
    area: {
      kind: 'social',
      platforms: [...new Set(own.map((account) => account.platform))],
      unread: await countUnread(ctx),
    },
    hasAccounts: own.length > 0,
  };
}

/** Whether an area's feature is on: email for Email; social media or live chat for the inbox. */
export function areaSwitchedOn(features: readonly string[], mailbox: Mailbox): boolean {
  return mailbox === 'email'
    ? features.includes('email_channel')
    : features.includes('social') || features.includes('live_chat');
}
