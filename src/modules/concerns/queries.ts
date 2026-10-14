import 'server-only';

import { and, asc, desc, eq, ne } from 'drizzle-orm';

import { concernMessages, concerns, payslips, users } from '@/db/schema';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ConcernCategory, ConcernStatus, RaisedWith } from './schemas';

export type ConcernRow = {
  id: string;
  raisedBy: string;
  raisedByName: string;
  raisedWith: RaisedWith;
  category: ConcernCategory;
  subject: string;
  status: ConcernStatus;
  lastActivityAt: Date;
  createdAt: Date;
};

/** May answer concerns at all: managers and the admin. */
export const canHandleConcerns = (ctx: TenantContext) =>
  hasPermission(ctx, 'concerns.handle') || hasPermission(ctx, 'concerns.handle_all');

/** May answer this one: the admin always, a manager only if it was raised with a manager. */
export const canHandleConcern = (
  ctx: TenantContext,
  concern: { raisedBy: string; raisedWith: string },
) =>
  concern.raisedBy !== ctx.userId &&
  (hasPermission(ctx, 'concerns.handle_all') ||
    (concern.raisedWith === 'manager' && hasPermission(ctx, 'concerns.handle')));

const columns = {
  id: concerns.id,
  raisedBy: concerns.raisedBy,
  raisedByName: users.fullName,
  raisedWith: concerns.raisedWith,
  category: concerns.category,
  subject: concerns.subject,
  status: concerns.status,
  lastActivityAt: concerns.lastActivityAt,
  createdAt: concerns.createdAt,
};

/**
 * `mine`: what the person raised. `raised`: what others raised that they may answer; the
 * database leaves out any concern raised with the admin when the reader is a manager.
 */
export async function listConcerns(
  ctx: TenantContext,
  view: 'mine' | 'raised',
): Promise<ConcernRow[]> {
  requirePermission(ctx, 'concerns.raise');
  const others = view === 'raised' && canHandleConcerns(ctx);
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(concerns)
      .innerJoin(users, eq(users.id, concerns.raisedBy))
      .where(
        and(
          eq(concerns.tenantId, ctx.tenantId),
          others ? ne(concerns.raisedBy, ctx.userId) : eq(concerns.raisedBy, ctx.userId),
        ),
      )
      .orderBy(desc(concerns.lastActivityAt))
      .limit(200),
  );
  return rows as ConcernRow[];
}

export type ConcernDetail = ConcernRow & {
  resolvedAt: Date | null;
  /** The payslip it is about. Its period is shown to whoever can read the question. */
  payslip: { id: string; number: number | null; periodStart: string; periodEnd: string } | null;
  messages: {
    id: string;
    authorUserId: string;
    authorName: string;
    body: string;
    createdAt: Date;
  }[];
  /** It is about a payslip the reader may not open (a manager answering). */
  payslipHidden: boolean;
  /** The reader may change its status and answer it as the business. */
  canHandle: boolean;
};

/** One concern and its conversation, or null when it does not exist or is not the reader's to see. */
export async function getConcern(ctx: TenantContext, id: string): Promise<ConcernDetail | null> {
  requirePermission(ctx, 'concerns.raise');
  return withRls(ctx, async (tx) => {
    const [concern] = await tx
      .select({ ...columns, resolvedAt: concerns.resolvedAt, payslipId: concerns.payslipId })
      .from(concerns)
      .innerJoin(users, eq(users.id, concerns.raisedBy))
      .where(and(eq(concerns.tenantId, ctx.tenantId), eq(concerns.id, id)))
      .limit(1);
    if (!concern) return null;
    const messages = await tx
      .select({
        id: concernMessages.id,
        authorUserId: concernMessages.authorUserId,
        authorName: users.fullName,
        body: concernMessages.body,
        createdAt: concernMessages.createdAt,
      })
      .from(concernMessages)
      .innerJoin(users, eq(users.id, concernMessages.authorUserId))
      .where(and(eq(concernMessages.tenantId, ctx.tenantId), eq(concernMessages.concernId, id)))
      .orderBy(asc(concernMessages.createdAt), asc(concernMessages.id));
    const row = concern as ConcernRow & { resolvedAt: Date | null; payslipId: string | null };
    // Read with the reader's own rights: the person who asked, and whoever runs payroll, see it;
    // a manager answering does not, because managers cannot see pay.
    const [payslip] = row.payslipId
      ? await tx
          .select({
            id: payslips.id,
            number: payslips.number,
            periodStart: payslips.periodStart,
            periodEnd: payslips.periodEnd,
          })
          .from(payslips)
          .where(and(eq(payslips.tenantId, ctx.tenantId), eq(payslips.id, row.payslipId)))
          .limit(1)
      : [];
    const { payslipId, ...rest } = row;
    return {
      ...rest,
      payslip: payslip ?? null,
      payslipHidden: Boolean(payslipId && !payslip),
      messages,
      canHandle: canHandleConcern(ctx, row),
    };
  });
}
