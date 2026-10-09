import { Building, KanbanSquare, Radio, Users, XCircle, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getPipelineConfig } from '@/modules/pipelines/queries';
import { LeadSourceList, LostReasonList } from '@/modules/settings/components/settings-lists';
import { StageEditor } from '@/modules/settings/components/stage-editor';
import { TeamTable } from '@/modules/settings/components/team-table';
import { WorkspaceForm } from '@/modules/settings/components/workspace-form';
import { getSettingsLists } from '@/modules/settings/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Settings' };

const TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'general', label: 'Workspace', icon: Building },
  { key: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { key: 'sources', label: 'Lead sources', icon: Radio },
  { key: 'lost', label: 'Lost reasons', icon: XCircle },
  { key: 'team', label: 'Team', icon: Users },
];

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'settings.manage');
  const params = await searchParams;
  const tab = TABS.find((candidate) => candidate.key === params.tab)?.key ?? 'general';
  const [lists, pipeline] = await Promise.all([getSettingsLists(ctx), getPipelineConfig(ctx)]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="Settings"
        description="Shape the workspace around how your business works — no developer needed."
      />
      <div className="grid gap-5 md:grid-cols-[13rem_1fr]">
        <nav
          aria-label="Settings sections"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:px-0"
        >
          {TABS.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              href={`/settings?tab=${key}`}
              aria-current={tab === key ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                tab === key
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon aria-hidden className="size-4" /> {label}
            </Link>
          ))}
        </nav>

        <Card>
          {tab === 'general' && (
            <>
              <CardHeader>
                <CardTitle>Workspace</CardTitle>
                <CardDescription>Name, timezone and money defaults.</CardDescription>
              </CardHeader>
              <CardContent>
                <WorkspaceForm
                  initial={{
                    name: ctx.tenant.name,
                    timezone: ctx.tenant.timezone,
                    currency: ctx.tenant.currency,
                    country: ctx.tenant.country ?? '',
                  }}
                />
              </CardContent>
            </>
          )}
          {tab === 'pipeline' && (
            <>
              <CardHeader>
                <CardTitle>{pipeline.name} pipeline</CardTitle>
                <CardDescription>
                  Rename and reorder stages, set win probability (drives the weighted forecast) and
                  how many quiet days make a deal “stale”. Hidden stages keep their history.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StageEditor stages={pipeline.stages} />
              </CardContent>
            </>
          )}
          {tab === 'sources' && (
            <>
              <CardHeader>
                <CardTitle>Lead sources</CardTitle>
                <CardDescription>
                  Where business comes from. Used on contacts, opportunities and the source reports.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LeadSourceList items={lists.sources} />
              </CardContent>
            </>
          )}
          {tab === 'lost' && (
            <>
              <CardHeader>
                <CardTitle>Lost reasons</CardTitle>
                <CardDescription>Asked every time something is marked lost.</CardDescription>
              </CardHeader>
              <CardContent>
                <LostReasonList items={lists.reasons} />
              </CardContent>
            </>
          )}
          {tab === 'team' && (
            <>
              <CardHeader>
                <CardTitle>Team</CardTitle>
                <CardDescription>
                  People who can sign in and what their role lets them do. Each person chooses their
                  own password from a one-time link.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TeamTable
                  members={lists.members}
                  roles={lists.roles}
                  canManage={hasPermission(ctx, 'users.manage')}
                  currentUserId={ctx.userId}
                />
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
