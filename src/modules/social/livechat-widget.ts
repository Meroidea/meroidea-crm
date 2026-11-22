import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { socialAccounts, tenants } from '@/db/schema';
import { OPEN_TENANT_STATUSES } from '@/lib/tenant/status';
import { adminDb } from '@/server/db/admin';

import { WIDGET_KEY } from './livechat-schemas';
import { readAccountSettings } from './settings';

/*
 * Finding a live chat widget by its public key (ADR-072), with the privileged connection: for the
 * visitor's routes and for proxy.ts, which sets who may frame the widget. Kept apart from the rest
 * of live chat so proxy.ts loads only this.
 */

export type ChatWidget = {
  tenantId: string;
  accountId: string;
  /** What the visitor sees as the business's name in the chat. */
  name: string;
  businessName: string;
  greeting: string | null;
  requireEmail: boolean;
  allowedOrigins: string[];
};

/** The connected widget for a public key, or null. */
export async function findChatWidget(key: string): Promise<ChatWidget | null> {
  if (!WIDGET_KEY.test(key)) return null;
  const [row] = await adminDb()
    .select({
      tenantId: socialAccounts.tenantId,
      accountId: socialAccounts.id,
      name: socialAccounts.name,
      settings: socialAccounts.settings,
      businessName: tenants.name,
      tenantStatus: tenants.status,
      features: tenants.features,
    })
    .from(socialAccounts)
    .innerJoin(tenants, eq(tenants.id, socialAccounts.tenantId))
    .where(
      and(
        eq(socialAccounts.platform, 'livechat'),
        eq(socialAccounts.externalId, key),
        eq(socialAccounts.status, 'active'),
        isNull(socialAccounts.disconnectedAt),
      ),
    )
    .limit(1);
  if (
    !row ||
    !row.features.includes('live_chat') ||
    !(OPEN_TENANT_STATUSES as readonly string[]).includes(row.tenantStatus)
  ) {
    return null;
  }
  const settings = readAccountSettings(row.settings);
  return {
    tenantId: row.tenantId,
    accountId: row.accountId,
    name: row.name,
    businessName: row.businessName,
    greeting: settings.greeting,
    requireEmail: settings.requireEmail,
    allowedOrigins: settings.allowedOrigins,
  };
}

/** The sites allowed to frame a widget's page, for its Content-Security-Policy. */
export function frameAncestorsFor(widget: ChatWidget | null): string {
  if (!widget || widget.allowedOrigins.length === 0) return "'none'";
  return widget.allowedOrigins.join(' ');
}
