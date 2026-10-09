import {
  AlarmClock,
  CalendarCheck2,
  CalendarDays,
  CircleCheckBig,
  Inbox,
  Sparkles,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDashboard } from '@/modules/reports/queries';
import { TaskList } from '@/modules/tasks/components/task-list';
import { TaskQuickAdd } from '@/modules/tasks/components/task-quick-add';
import { getMyDay } from '@/modules/tasks/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'My Day' };

function Section({
  icon: Icon,
  title,
  count,
  tone,
  children,
}: {
  icon: typeof Inbox;
  title: string;
  count: number;
  tone: 'destructive' | 'primary' | 'muted';
  children: ReactNode;
}) {
  const toneClass = {
    destructive: 'bg-destructive/10 text-destructive-text',
    primary: 'bg-accent text-accent-foreground',
    muted: 'bg-muted text-muted-foreground',
  }[tone];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <span className={`flex size-7 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon aria-hidden className="size-4" />
        </span>
        <CardTitle className="flex-1">{title}</CardTitle>
        <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function MyDayPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'tasks.view');
  const [day, dashboard] = await Promise.all([getMyDay(ctx), getDashboard(ctx)]);
  const total = day.overdue.length + day.today.length;
  const now = new Intl.DateTimeFormat('en-AU', {
    timeZone: ctx.tenant.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="My Day"
        description={
          total === 0
            ? `${now} · You're all caught up.`
            : `${now} · ${total} ${total === 1 ? 'thing needs' : 'things need'} you today${day.overdue.length ? `, ${day.overdue.length} overdue` : ''}.`
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
          <AlarmClock aria-hidden className="size-5 text-destructive-text" />
          <div>
            <p className="text-2xl font-semibold tabular-nums">{day.overdue.length}</p>
            <p className="text-xs text-muted-foreground">Overdue</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
          <CalendarCheck2 aria-hidden className="size-5 text-primary" />
          <div>
            <p className="text-2xl font-semibold tabular-nums">{day.today.length}</p>
            <p className="text-xs text-muted-foreground">Due today</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
          <CircleCheckBig aria-hidden className="size-5 text-positive-text" />
          <div>
            <p className="text-2xl font-semibold tabular-nums">{day.doneToday}</p>
            <p className="text-xs text-muted-foreground">Done today</p>
          </div>
        </div>
      </div>

      {hasPermission(ctx, 'tasks.manage') && (
        <TaskQuickAdd currentUserId={ctx.userId} placeholder="What else is on your list today?" />
      )}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-5">
          {day.overdue.length > 0 && (
            <Section
              icon={AlarmClock}
              title="Overdue"
              count={day.overdue.length}
              tone="destructive"
            >
              <TaskList tasks={day.overdue} timezone={ctx.tenant.timezone} />
            </Section>
          )}
          <Section icon={CalendarCheck2} title="Today" count={day.today.length} tone="primary">
            <TaskList
              tasks={day.today}
              timezone={ctx.tenant.timezone}
              emptyText="Nothing due today."
            />
          </Section>
          <Section icon={CalendarDays} title="Next 7 days" count={day.upcoming.length} tone="muted">
            <TaskList
              tasks={day.upcoming}
              timezone={ctx.tenant.timezone}
              emptyText="Nothing scheduled this week."
            />
          </Section>
          {day.noDate.length > 0 && (
            <Section icon={Inbox} title="No due date" count={day.noDate.length} tone="muted">
              <TaskList tasks={day.noDate} timezone={ctx.tenant.timezone} />
            </Section>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-warning text-warning-text">
                <Sparkles aria-hidden className="size-4" />
              </span>
              <CardTitle>Going quiet</CardTitle>
            </CardHeader>
            <CardContent>
              {!dashboard || dashboard.stale.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every open deal has recent activity. Nice.
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {dashboard.stale.map((deal) => (
                    <li key={deal.id} className="py-2.5">
                      <Link href={`/opportunities/${deal.id}`} className="block hover:text-primary">
                        <span className="block truncate text-sm font-medium">{deal.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {deal.contactName} · {deal.stageName} · quiet for {deal.days} days
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
