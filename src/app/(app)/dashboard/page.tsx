import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Coins,
  Gauge,
  KanbanSquare,
  ListChecks,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Upload,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/data/avatar';
import { WorkspaceHome } from '@/components/layout/workspace-home';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { Timeline } from '@/modules/activities/components/timeline';
import { getRecentActivity } from '@/modules/activities/queries';
import { getMyName, getWorkspaceCounts } from '@/modules/members/queries';
import { BarList, Ring, TrendChart } from '@/modules/reports/components/charts';
import { getDashboard } from '@/modules/reports/queries';
import { TaskList } from '@/modules/tasks/components/task-list';
import { getMyDay } from '@/modules/tasks/queries';
import { hasFeature, hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Dashboard' };

function greeting(timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  href,
  aside,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: ReactNode;
  href?: string;
  aside?: ReactNode;
}) {
  const body = (
    <Card className="h-full gap-0 py-4 transition-colors hover:border-primary/40">
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Icon aria-hidden className="size-3.5" /> {label}
          </p>
          <p className="truncate text-2xl font-semibold tracking-tight text-primary tabular-nums">
            {value}
          </p>
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        </div>
        {aside}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link
      href={href}
      className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

function monthLabel(month: string) {
  const [year, value] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year ?? 2026, (value ?? 1) - 1, 1)),
  );
}

export default async function DashboardPage() {
  const ctx = await requireTenantContext();
  const labels = ctx.tenant.labels;
  // The dashboard below is about sales. A business without those features gets a plain way in
  // to the areas it does have.
  if (!hasFeature(ctx, 'crm')) {
    const firstName = (await getMyName(ctx)).split(' ')[0];
    return (
      <WorkspaceHome
        greeting={`${greeting(ctx.tenant.timezone)}, ${firstName}`}
        businessName={ctx.tenant.name}
        labels={labels}
        permissions={[...ctx.grants.keys()]}
        features={ctx.tenant.features}
      />
    );
  }
  const [name, dashboard, day, activity, counts] = await Promise.all([
    getMyName(ctx),
    getDashboard(ctx),
    hasPermission(ctx, 'tasks.view') ? getMyDay(ctx) : Promise.resolve(null),
    getRecentActivity(ctx, 8),
    getWorkspaceCounts(ctx),
  ]);
  const firstName = name.split(' ')[0];
  const currency = ctx.tenant.currency;
  const money = (value: string, compact = true) =>
    value === '' ? '—' : formatMoney(value, currency, { compact });
  const dueNow = day ? [...day.overdue, ...day.today] : [];

  const setup = [
    {
      done: counts.contacts > 0,
      label: `Add your first ${labels.contact.singular.toLowerCase()}`,
      href: '/contacts/new',
      icon: UserPlus,
    },
    {
      done: counts.opportunities > 0,
      label: `Open an ${labels.opportunity.singular.toLowerCase()}`,
      href: '/opportunities/new',
      icon: Target,
    },
    { done: counts.tasks > 0, label: 'Schedule a follow-up', href: '/my-day', icon: ListChecks },
    {
      done: counts.contacts >= 25,
      label: 'Import your existing list',
      href: '/imports',
      icon: Upload,
    },
  ];
  const setupLeft = setup.filter((step) => !step.done).length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(ctx.tenant.timezone)}, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {dueNow.length > 0
              ? `${dueNow.length} ${dueNow.length === 1 ? 'task needs' : 'tasks need'} you today${day?.overdue.length ? ` — ${day.overdue.length} overdue` : ''}.`
              : 'Nothing overdue. Here is how the business is doing.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasPermission(ctx, 'contacts.create') && (
            <Button asChild variant="outline">
              <Link href="/contacts/new">
                <UserPlus aria-hidden /> {labels.contact.singular}
              </Link>
            </Button>
          )}
          {hasPermission(ctx, 'opportunities.create') && (
            <Button asChild>
              <Link href="/opportunities/new">
                <Plus aria-hidden /> New {labels.opportunity.singular.toLowerCase()}
              </Link>
            </Button>
          )}
        </div>
      </header>

      {setupLeft > 0 && (
        <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-accent to-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles aria-hidden className="size-4 text-primary" /> Get your workspace running
            </CardTitle>
            <CardDescription>
              {setup.length - setupLeft} of {setup.length} done
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {setup.map((step) => (
              <Link
                key={step.label}
                href={step.href}
                className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm transition-colors hover:border-primary/40"
              >
                {step.done ? (
                  <CheckCircle2 aria-hidden className="size-4 shrink-0 text-primary" />
                ) : (
                  <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className={step.done ? 'text-muted-foreground line-through' : 'font-medium'}>
                  {step.label}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {dashboard && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            icon={KanbanSquare}
            label="Open pipeline"
            value={
              dashboard.showMoney
                ? money(dashboard.kpis.openValue)
                : String(dashboard.kpis.openCount)
            }
            sub={`${dashboard.kpis.openCount} open · ${dashboard.kpis.newOpportunities30d} new in 30 days`}
            href="/pipeline"
          />
          <Kpi
            icon={Gauge}
            label="Weighted forecast"
            value={dashboard.showMoney ? money(dashboard.kpis.weightedValue) : '—'}
            sub="Value × stage probability"
            href="/reports"
          />
          <Kpi
            icon={Trophy}
            label="Won this month"
            value={
              dashboard.showMoney
                ? money(dashboard.kpis.wonThisMonthValue)
                : String(dashboard.kpis.wonThisMonthCount)
            }
            sub={`${dashboard.kpis.wonThisMonthCount} won · ${dashboard.kpis.newContacts30d} new ${labels.contact.plural.toLowerCase()} in 30 days`}
            href="/opportunities?status=won"
          />
          <Kpi
            icon={TrendingUp}
            label="Win rate (90 days)"
            value={dashboard.kpis.winRate === null ? '—' : `${dashboard.kpis.winRate}%`}
            sub="Won ÷ (won + lost)"
            href="/reports"
            aside={<Ring value={dashboard.kpis.winRate} label="Win rate" />}
          />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          {dashboard && (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Performance</CardTitle>
                  <CardDescription>Last 6 months</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/reports">
                    Reports <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                <TrendChart
                  barLabel={dashboard.showMoney ? 'Won value' : 'Won'}
                  lineLabel={`New ${labels.opportunity.plural.toLowerCase()}`}
                  points={dashboard.trend.map((point) => ({
                    label: monthLabel(point.month),
                    bar: Number(point.won || 0),
                    line: point.created,
                    barDisplay: money(point.won, false),
                  }))}
                />
              </CardContent>
            </Card>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            {dashboard && (
              <Card>
                <CardHeader>
                  <CardTitle>Pipeline by stage</CardTitle>
                  <CardDescription>Open {labels.opportunity.plural.toLowerCase()}</CardDescription>
                </CardHeader>
                <CardContent>
                  <BarList
                    emptyText={`No open ${labels.opportunity.plural.toLowerCase()} yet.`}
                    rows={dashboard.stages.map((stage) => ({
                      key: stage.id,
                      label: stage.name,
                      value: dashboard.showMoney
                        ? Number(stage.value || 0) || stage.count
                        : stage.count,
                      display: dashboard.showMoney ? money(stage.value) : String(stage.count),
                      hint: dashboard.showMoney ? `${stage.count}` : undefined,
                      color: stage.color,
                    }))}
                  />
                </CardContent>
              </Card>
            )}
            {dashboard && (
              <Card>
                <CardHeader>
                  <CardTitle>Where business comes from</CardTitle>
                  <CardDescription>
                    New {labels.opportunity.plural.toLowerCase()}, last 90 days
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <BarList
                    emptyText="Sources appear once opportunities are created."
                    rows={dashboard.sources.map((source) => ({
                      key: source.name,
                      label: source.name,
                      value: source.count,
                      display: String(source.count),
                      hint: source.won ? `${source.won} won` : undefined,
                      color: 'chart-3',
                    }))}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Calls, notes and changes across your records</CardDescription>
            </CardHeader>
            <CardContent>
              <Timeline
                items={activity}
                timezone={ctx.tenant.timezone}
                showRecord
                emptyText="Activity appears here as your team logs calls, notes and stage moves."
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {day && (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>My tasks today</CardTitle>
                  <CardDescription>
                    {day.overdue.length} overdue · {day.today.length} today · {day.doneToday} done
                  </CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/my-day">
                    My Day <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                <TaskList
                  tasks={dueNow.slice(0, 6)}
                  timezone={ctx.tenant.timezone}
                  emptyText="You're all caught up for today."
                />
              </CardContent>
            </Card>
          )}

          {dashboard && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-warning-border" /> Going quiet
                </CardTitle>
                <CardDescription>
                  Open deals with no activity past their stage’s limit
                </CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard.stale.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Everything has recent activity.</p>
                ) : (
                  <ul className="flex flex-col divide-y">
                    {dashboard.stale.map((deal) => (
                      <li key={deal.id}>
                        <Link
                          href={`/opportunities/${deal.id}`}
                          className="flex items-center gap-3 py-2.5 hover:text-primary"
                        >
                          <Avatar name={deal.ownerName ?? 'Unassigned'} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{deal.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {deal.contactName} · {deal.stageName}
                            </span>
                          </span>
                          <span className="shrink-0 rounded bg-warning px-1.5 py-0.5 text-xs font-medium text-warning-text tabular-nums">
                            {deal.days}d
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {dashboard && dashboard.leaderboard.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coins aria-hidden className="size-4 text-primary" /> Top closers
                </CardTitle>
                <CardDescription>Won in the last 90 days</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-3">
                  {dashboard.leaderboard.map((person, index) => (
                    <li key={person.name} className="flex items-center gap-3">
                      <span className="w-4 text-xs font-semibold text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <Avatar name={person.name} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {person.name}
                      </span>
                      <span className="text-sm tabular-nums">
                        {dashboard.showMoney ? money(person.won) : ''}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {person.count} won
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users aria-hidden className="size-4 text-primary" /> Workspace
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 text-center">
              {[
                [counts.contacts, labels.contact.plural, '/contacts'],
                [counts.opportunities, labels.opportunity.plural, '/opportunities'],
                [counts.members, 'People', '/settings?tab=team'],
              ].map(([value, label, href]) => (
                <Link
                  key={String(label)}
                  href={String(href)}
                  className="rounded-lg bg-muted/50 px-2 py-3 hover:bg-accent"
                >
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                  <p className="truncate text-xs text-muted-foreground">{label}</p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
