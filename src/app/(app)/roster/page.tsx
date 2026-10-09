import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { addDaysToDate, mondayOf, zonedToday } from '@/lib/dates';
import { listActiveMembers } from '@/modules/members/queries';
import { CreateRosterCard } from '@/modules/roster/components/create-roster-card';
import { RosterBoard } from '@/modules/roster/components/roster-board';
import { dayParts } from '@/modules/roster/hours';
import {
  canSeeWholeRoster,
  getRosterForDate,
  hasEarlierRoster,
  listRosterShifts,
} from '@/modules/roster/queries';
import { rosterPageParamsSchema } from '@/modules/roster/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Roster' };

export default async function RosterPage({ searchParams }: PageProps<'/roster'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'rosters.view');
  const canManage = hasPermission(ctx, 'rosters.manage');
  const canPay = hasPermission(ctx, 'payroll.manage');
  const today = zonedToday(ctx.tenant.timezone);
  const date = rosterPageParamsSchema.parse(await searchParams).date ?? today;
  const roster = await getRosterForDate(ctx, date);

  const header = (
    <PageHeader
      title="Roster"
      description={
        canManage
          ? 'Plan who works when, a week or a fortnight at a time.'
          : canSeeWholeRoster(ctx)
            ? 'Published shifts for your workspace.'
            : 'Your own shifts, once a roster is published.'
      }
    />
  );

  if (roster) {
    const wholeRoster = canSeeWholeRoster(ctx);
    const [shifts, everyone] = await Promise.all([
      listRosterShifts(ctx, roster.id),
      listActiveMembers(ctx),
    ]);
    // General staff get a roster of one: themselves.
    const people = wholeRoster
      ? everyone
      : everyone.filter((person) => person.userId === ctx.userId);
    return (
      <div className="flex w-full flex-col gap-5">
        {header}
        {roster.authorisedAt ? (
          <p className="rounded-lg border bg-card px-4 py-3 text-sm">
            This roster has been authorised for pay and is locked.
            {canPay && (
              <>
                {' '}
                <Link
                  href={`/payroll/${roster.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  Open the pay run
                </Link>
              </>
            )}
          </p>
        ) : (
          canPay &&
          roster.status === 'published' && (
            <p className="rounded-lg border bg-card px-4 py-3 text-sm">
              Once this period has been worked, correct any shifts to the hours actually worked,
              then{' '}
              <Link
                href={`/payroll/${roster.id}`}
                className="text-primary underline underline-offset-4"
              >
                authorise it for pay
              </Link>
              .
            </p>
          )
        )}
        <RosterBoard
          roster={roster}
          shifts={shifts}
          people={people}
          canManage={canManage && !roster.authorisedAt}
          today={today}
        />
      </div>
    );
  }

  const weekStart = mondayOf(date);
  const canCopy = canManage ? await hasEarlierRoster(ctx, weekStart) : false;

  return (
    <div className="flex w-full flex-col gap-5">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border bg-card">
          <Button asChild variant="ghost" size="icon" aria-label="Previous week">
            <Link href={`/roster?date=${addDaysToDate(weekStart, -1)}`}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <span className="px-2 text-sm font-medium tabular-nums">
            {dayParts(weekStart).day} – {dayParts(addDaysToDate(weekStart, 6)).day}
          </span>
          <Button asChild variant="ghost" size="icon" aria-label="Next week">
            <Link href={`/roster?date=${addDaysToDate(weekStart, 7)}`}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        <Button asChild variant="outline">
          <Link href="/roster">Today</Link>
        </Button>
      </div>

      {canManage ? (
        // Keyed so the form's defaults follow the week being looked at.
        <CreateRosterCard key={weekStart} defaultStart={weekStart} canCopy={canCopy} />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={CalendarDays}
              title="No roster for these days yet"
              description="Shifts appear here once a roster covering this week is published."
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
