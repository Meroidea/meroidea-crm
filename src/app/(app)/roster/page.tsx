import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { addDaysToDate, daysBetweenDates, mondayOf, zonedToday } from '@/lib/dates';
import { RosterAgent } from '@/modules/ai/components/roster-agent';
import { MeroAIRosterTimesheets } from '@/modules/ai/components/meroai-roster-timesheets';
import { RosterAgentButton, RosterAgentLayout } from '@/modules/ai/components/roster-agent-layout';
import { rosterAgentSetup } from '@/modules/ai/roster-agent';
import { demandByDate } from '@/modules/ai/roster-coverage';
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
import { getTradingHours } from '@/modules/trading-hours/queries';
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
    // General staff get a roster of one: themselves.
    const people = <T extends { userId: string }>(everyone: T[]) =>
      wholeRoster ? everyone : everyone.filter((person) => person.userId === ctx.userId);
    const [shifts, everyone, teams, rules, rates, leave, removed, agentSetup, tradingDays] =
      await Promise.all([
        listRosterShifts(ctx, roster.id),
        listActiveMembers(ctx),
        listRosterTeams(ctx),
        getRosterRules(ctx),
        listRosterRates(ctx),
        listRosterLeave(ctx, roster.startsOn, roster.endsOn),
        editable ? listRemovedShifts(ctx, roster.id) : [],
        meroAI && editable ? rosterAgentSetup(ctx, roster.startsOn) : null,
        canManage ? getTradingHours(ctx) : [],
      ]);
    const days = daysBetweenDates(roster.startsOn, roster.endsOn) + 1;
    const demand = tradingDays.some((day) => day.opensAt !== null)
      ? demandByDate(
          tradingDays,
          Array.from({ length: days }, (_, index) => addDaysToDate(roster.startsOn, index)),
        )
      : null;
    const storageKey = `meroai-roster-agent:${ctx.tenantId}:${roster.startsOn}`;
    const board = (
      <RosterBoard
        roster={roster}
        shifts={shifts}
        removed={removed}
        people={people(everyone)}
        teams={teams}
        leave={leave}
        rules={rules}
        rates={rates}
        currency={ctx.tenant.currency}
        canManage={editable}
        wholeRoster={wholeRoster}
        today={today}
        demand={demand}
        toolbarExtra={agentSetup ? <RosterAgentButton key="roster-agent" /> : null}
      />
    );

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
        {/* Once staff have worked to it: MeroAI authorises the timesheets (ADR-084). */}
        {roster.status === 'published' &&
          !roster.authorisedAt &&
          roster.startsOn <= today &&
          hasPermission(ctx, 'ai.use') &&
          hasPermission(ctx, 'timesheets.manage') && (
            <MeroAIRosterTimesheets rosterId={roster.id} startsOn={roster.startsOn} />
          )}
        {agentSetup ? (
          <RosterAgentLayout
            storageKey={storageKey}
            panel={
              <RosterAgent
                variant="panel"
                storageKey={storageKey}
                startsOn={roster.startsOn}
                span={days > 7 ? 'fortnight' : 'week'}
                rosterId={roster.id}
                existingShifts={shifts.length}
                setup={agentSetup}
                teamColors={Object.fromEntries(teams.map((team) => [team.id, team.color]))}
                canChat={isAiConfigured()}
                canEditSettings={canEditSettings}
              />
            }
          >
            {board}
          </RosterAgentLayout>
        ) : (
          board
        )}
      </div>
    );
  }

  const weekStart = mondayOf(date);
  const [canCopy, agentSetup, teams] = await Promise.all([
    canManage ? hasEarlierRoster(ctx, weekStart) : false,
    meroAI ? rosterAgentSetup(ctx, weekStart) : null,
    meroAI ? listRosterTeams(ctx) : [],
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
        <div className={agentSetup ? 'grid items-start gap-5 lg:grid-cols-2' : undefined}>
          <CreateRosterCard key={weekStart} defaultStart={weekStart} canCopy={canCopy} />
          {agentSetup && (
            <div className="flex max-h-[44rem] min-h-[30rem] flex-col">
              <RosterAgent
                key={`agent-${weekStart}`}
                variant="card"
                storageKey={`meroai-roster-agent:${ctx.tenantId}:${weekStart}`}
                startsOn={weekStart}
                span="week"
                rosterId={null}
                existingShifts={0}
                setup={agentSetup}
                teamColors={Object.fromEntries(teams.map((team) => [team.id, team.color]))}
                canChat={isAiConfigured()}
                canEditSettings={canEditSettings}
              />
            </div>
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
