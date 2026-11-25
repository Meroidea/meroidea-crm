import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { maySignOffFor } from '@/lib/permissions/sign-off';
import { addDaysToDate, instantToZoned, zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { listActiveMembers } from '@/modules/members/queries';
import { ApprovalViews, TimesheetViewNav } from '@/modules/timesheets/components/approval-views';
import { ExportPeriod } from '@/modules/timesheets/components/timesheet-day';
import { TimesheetSheet } from '@/modules/timesheets/components/timesheet-sheet';
import { ClockCard, EntryButton } from '@/modules/timesheets/components/timesheet-tools';
import { payrollPreview } from '@/modules/ai/meroai-payroll';
import { getTimesheetPeriod, previousPeriodCosts } from '@/modules/timesheets/period';
import { getOpenEntry } from '@/modules/timesheets/queries';
import { timesheetParamsSchema } from '@/modules/timesheets/schemas';
import { getTimesheet } from '@/modules/timesheets/sheet';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Timesheets' };

export default async function TimesheetsPage({ searchParams }: PageProps<'/timesheets'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'timesheets.clock');
  const canManage = hasPermission(ctx, 'timesheets.manage');
  const params = timesheetParamsSchema.parse(await searchParams);
  const timezone = ctx.tenant.timezone;
  const today = zonedToday(timezone);
  if (canManage && (params.view === 'day' || params.view === 'period')) {
    const period = await getTimesheetPeriod(ctx, params.date ?? today);
    return (
      <ApprovalViews
        view={params.view}
        show={params.show ?? 'all'}
        period={period}
        previousCosts={
          params.view === 'period' ? await previousPeriodCosts(ctx, period.from) : null
        }
        payroll={
          params.view === 'period' &&
          hasPermission(ctx, 'ai.use') &&
          hasPermission(ctx, 'payroll.manage')
            ? await payrollPreview(ctx, period.from)
            : null
        }
        currency={ctx.tenant.currency}
        today={today}
        meroAI={hasPermission(ctx, 'ai.use')}
      />
    );
  }

  // The Timesheet (ADR-083): everyone's for a manager, the person's own otherwise.
  const date = params.date ?? params.week ?? today;
  const [open, sheet, people] = await Promise.all([
    getOpenEntry(ctx),
    getTimesheet(ctx, date),
    canManage ? listActiveMembers(ctx) : undefined,
  ]);
  const openLabel = open ? instantToZoned(timezone, open.clockIn) : null;

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Timesheets"
        description={
          canManage
            ? 'Everyone’s clock-ins against the roster, and the authorised hours once a pay period is authorised for pay.'
            : 'Clock in and out, see your times against your roster, and your authorised hours once they are paid.'
        }
        actions={
          (canManage || !ctx.tenant.clockLocation) && (
            <EntryButton
              today={today}
              people={people?.filter((person) => person.userId !== ctx.userId)}
            />
          )
        }
      />

      <ClockCard
        workplaceRadius={ctx.tenant.clockLocation?.radiusMetres ?? null}
        open={
          open && openLabel
            ? {
                since: open.clockIn.getTime(),
                label:
                  openLabel.date === today
                    ? openLabel.time
                    : `${openLabel.time} on ${formatCalendarDate(openLabel.date)}`,
              }
            : null
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canManage ? <TimesheetViewNav view="mine" date={date} /> : <span />}
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Previous pay period">
            <Link href={`/timesheets?date=${addDaysToDate(sheet.from, -1)}`}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <p className="min-w-48 text-center text-sm font-medium">
            {formatCalendarDate(sheet.from)} – {formatCalendarDate(sheet.to)}
          </p>
          <Button asChild variant="ghost" size="icon" aria-label="Next pay period">
            <Link href={`/timesheets?date=${addDaysToDate(sheet.to, 1)}`}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>

      <TimesheetSheet
        sheet={sheet}
        today={today}
        viewerId={ctx.userId}
        mayApprove={(userId) => maySignOffFor(ctx, userId)}
        staffMayEdit={!ctx.tenant.clockLocation}
        exportButton={<ExportPeriod date={sheet.from} disabled={false} />}
      />
    </div>
  );
}
