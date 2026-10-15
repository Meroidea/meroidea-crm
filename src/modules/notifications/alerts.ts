import 'server-only';

import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import { OPEN_TENANT_STATUSES } from '@/lib/tenant/status';
import { notifications, tenants, users } from '@/db/schema';
import { adminDb } from '@/server/db/admin';
import { consumeRateLimit } from '@/server/rate-limit';

import { sendNoticeEmails } from './service';

/**
 * Lead and follow-up alerts (docs/leads.md §6.4). The checks themselves are one SQL function,
 * app.sweep_lead_alerts, which writes in-app notices with dedupe keys; this file runs it and
 * emails the notices that ask for an email. It works across businesses for the scheduler, so it
 * uses the privileged client and never takes a business id from a request: the scheduler covers
 * every business, and the app passes the signed-in person's own.
 */

/** How often a business's alerts are checked while its people are using the app. */
const IN_APP_EVERY_SECONDS = 15 * 60;
/** Emails for notices older than this are dropped rather than sent late. */
const EMAIL_WITHIN_HOURS = 48;
const EMAIL_BATCH = 200;

export async function sweepTenant(tenantId: string): Promise<number> {
  const rows = (await adminDb().execute(
    sql`select app.sweep_lead_alerts(${tenantId}::uuid) as added`,
  )) as unknown as { added: number }[];
  return rows[0]?.added ?? 0;
}

/** Sends the alert emails not yet sent, claiming each first so two runs never both send it. */
export async function sendPendingAlertEmails(tenantId?: string): Promise<number> {
  const db = adminDb();
  const claimed = await db
    .update(notifications)
    .set({ emailedAt: new Date() })
    .where(
      inArray(
        notifications.id,
        db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.emailWanted, true),
              isNull(notifications.emailedAt),
              isNull(notifications.readAt),
              gt(notifications.createdAt, new Date(Date.now() - EMAIL_WITHIN_HOURS * 3_600_000)),
              tenantId ? eq(notifications.tenantId, tenantId) : undefined,
            ),
          )
          .limit(EMAIL_BATCH)
          .for('update', { skipLocked: true }),
      ),
    )
    .returning({
      tenantId: notifications.tenantId,
      userId: notifications.userId,
      type: notifications.type,
      url: notifications.url,
    });
  if (claimed.length === 0) return 0;

  const [people, businesses] = await Promise.all([
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, [...new Set(claimed.map((row) => row.userId))])),
    db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(inArray(tenants.id, [...new Set(claimed.map((row) => row.tenantId))])),
  ]);
  for (const business of businesses) {
    const pending = claimed
      .filter((row) => row.tenantId === business.id)
      .map((row) => ({ userId: row.userId, type: row.type, url: row.url ?? '/notifications' }));
    await sendNoticeEmails(business.name, pending, people).catch(() => undefined);
  }
  return claimed.length;
}

/** The scheduler's run: every business with the CRM switched on. */
export async function sweepAllTenants(): Promise<{
  businesses: number;
  alerts: number;
  emails: number;
}> {
  const open = await adminDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(
      and(
        inArray(tenants.status, [...OPEN_TENANT_STATUSES]),
        sql`'crm' = any(${tenants.features})`,
      ),
    );
  let alerts = 0;
  for (const tenant of open) alerts += await sweepTenant(tenant.id);
  const emails = await sendPendingAlertEmails();
  return { businesses: open.length, alerts, emails };
}

/**
 * Run from the app after a page is sent, for the signed-in person's business: at most once per
 * quarter hour per business, so alerts stay current between the daily scheduled runs.
 */
export async function sweepIfDue(tenantId: string): Promise<void> {
  const due = await consumeRateLimit({
    bucket: 'lead-alerts',
    subject: tenantId,
    limit: 1,
    windowSeconds: IN_APP_EVERY_SECONDS,
  });
  if (!due) return;
  await sweepTenant(tenantId);
  await sendPendingAlertEmails(tenantId);
}
