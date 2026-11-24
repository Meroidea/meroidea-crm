import { CalendarDays, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { addDaysToDate, daysBetweenDates, mondayOf, zonedToday } from '@/lib/dates';
import { MeroAIRosterCard } from '@/modules/ai/components/meroai-roster';
import { rosterStrategyOptions } from '@/modules/ai/roster-planner';
import { listActiveMembers } from '@/modules/members/queries';
import { CreateRosterCard } from '@/modules/roster/components/create-roster-card';
import { RosterBoard } from '@/modules/roster/components/roster-board';
import { dayParts } from '@/modules/roster/hours';
import {
  canSeeWholeRoster,
  getRosterForDate,
  getRosterRules,
  hasEarlierRoster,
  listRemovedShifts,
  listRosterLeave,
  listRosterRates,
  listRosterShifts,
  listRosterTeams,
} from '@/modules/roster/queries';
import { rosterPageParamsSchema } from '@/modules/roster/schemas';
import { isAiConfigured } from '@/server/ai';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Roster' };

export default async function RosterPage({ searchParams }: PageProps<'/roster'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'rosters.view');
  const canManage = hasPermission(ctx, 'rosters.manage');
  const canPay = hasPermission(ctx, 'payroll.manage');
  // MeroAI builds rosters for whoever can manage them, once the platform owner has switched the
  // assistant on for this business (ADR-076).
  const meroAI = canManage && hasPermission(ctx, 'ai.use');
  const canEditSettings = hasPermission(ctx, 'settings.manage');
  const today = zonedToday(ctx.tenant.timezone);
  const params = rosterPageParamsSchema.parse(await searchParams);
  const date = params.date ?? today;
  const roster = await getRosterForDate(ctx, date);

  const header = (
    <PageHeader
      title="Roster"
      description={
        canManage
          ? 'Plan who works when, see what it costs, and publish it to your team.'
          : canSeeWholeRoster(ctx)
            ? 'Published shifts for your workspace.'
            : 'Your own shifts, once a roster is published.'
      }
    />
  );

  if (roster) {
    const wholeRoster = canSeeWholeRoster(ctx);
    const editable = canManage && !roster.authorisedAt;
    const [shifts, everyone, teams, rules, rates, leave, removed, meroAIOptions] =
      await Promise.all([
        listRosterShifts(ctx, roster.id),
        listActiveMembers(ctx),
        listRosterTeams(ctx),
        getRosterRules(ctx),
        listRosterRates(ctx),
        listRosterLeave(ctx, roster.startsOn, roster.endsOn),
        editable ? listRemovedShifts(ctx, roster.id) : [],
        meroAI && editable ? rosterStrategyOptions(ctx, roster.startsOn) : null,
      ]);
    // General staff get a roster of one: themselves.
    const people = wholeRoster
      ? everyone
      : everyone.filter((person) => person.userId === ctx.userId);
    return (
      <div className="flex w-full flex-col gap-5">
        {header}
        {params.skipped && editable && (
          <p
            role="status"
            className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text"
          >
            {params.skipped === 1 ? '1 shift was' : `${params.skipped} shifts were`} not copied
            because the person already has a shift at that time.
          </p>
        )}
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
        {meroAIOptions && (
          <details className="group rounded-xl border border-primary/30 bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
              <Sparkles aria-hidden className="size-4 text-primary" />
              Fill this roster with MeroAI
              <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">
                Copy last week, lowest wage cost, most productive or even hours
              </span>
            </summary>
            <div className="border-t p-4">
              <MeroAIRosterCard
                defaultStart={roster.startsOn}
                fixed={{
                  startsOn: roster.startsOn,
                  span:
                    daysBetweenDates(roster.startsOn, roster.endsOn) + 1 > 7 ? 'fortnight' : 'week',
                }}
                options={meroAIOptions.options}
                tradingHoursSet={meroAIOptions.tradingHoursSet}
                canEditSettings={canEditSettings}
                canReadNotes={isAiConfigured()}
                className="border-0 p-0 shadow-none"
              />
            </div>
          </details>
        )}
        <RosterBoard
          roster={roster}
          shifts={shifts}
          removed={removed}
          people={people}
          teams={teams}
          leave={leave}
          rules={rules}
          rates={rates}
          currency={ctx.tenant.currency}
          canManage={editable}
          wholeRoster={wholeRoster}
          today={today}
        />
      </div>
    );
  }

  const weekStart = mondayOf(date);
  const [canCopy, meroAIOptions] = await Promise.all([
    canManage ? hasEarlierRoster(ctx, weekStart) : false,
    meroAI ? rosterStrategyOptions(ctx, weekStart) : null,
  ]);

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
        // Keyed so the forms' defaults follow the week being looked at.
        <div className={meroAIOptions ? 'grid items-start gap-5 lg:grid-cols-2' : undefined}>
          <CreateRosterCard key={weekStart} defaultStart={weekStart} canCopy={canCopy} />
          {meroAIOptions && (
            <MeroAIRosterCard
              key={`meroai-${weekStart}`}
              defaultStart={weekStart}
              options={meroAIOptions.options}
              tradingHoursSet={meroAIOptions.tradingHoursSet}
              canEditSettings={canEditSettings}
              canReadNotes={isAiConfigured()}
            />
          )}
        </div>
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
