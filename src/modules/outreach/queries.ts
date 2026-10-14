import 'server-only';

import { and, asc, count, desc, eq, sql } from 'drizzle-orm';

import { sequenceEnrollments, sequences, tasks, users } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

/** A contact's sequences with progress; the page has already checked the contact is in scope. */
export async function listEnrollments(ctx: TenantContext, contactId: string) {
  return withRls(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: sequenceEnrollments.id,
        name: sequences.name,
        status: sequenceEnrollments.status,
        assignedName: users.fullName,
        enrolledAt: sequenceEnrollments.enrolledAt,
      })
      .from(sequenceEnrollments)
      .innerJoin(
        sequences,
        and(
          eq(sequences.tenantId, sequenceEnrollments.tenantId),
          eq(sequences.id, sequenceEnrollments.sequenceId),
        ),
      )
      .leftJoin(users, eq(users.id, sequenceEnrollments.assignedTo))
      .where(
        and(
          eq(sequenceEnrollments.tenantId, ctx.tenantId),
          eq(sequenceEnrollments.contactId, contactId),
        ),
      )
      .orderBy(desc(sequenceEnrollments.enrolledAt));
    const progress = rows.length
      ? await tx
          .select({
            enrollmentId: tasks.sequenceEnrollmentId,
            total: count(),
            done: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.tenantId, ctx.tenantId),
              eq(tasks.contactId, contactId),
              sql`${tasks.sequenceEnrollmentId} is not null`,
            ),
          )
          .groupBy(tasks.sequenceEnrollmentId)
          .orderBy(asc(tasks.sequenceEnrollmentId))
      : [];
    return rows.map((row) => {
      const counts = progress.find((item) => item.enrollmentId === row.id);
      return { ...row, total: counts?.total ?? 0, done: counts?.done ?? 0 };
    });
  });
}
