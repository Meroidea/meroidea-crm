import { UserPlus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Avatar } from '@/components/data/avatar';
import { EmptyState } from '@/components/data/empty-state';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/data/page-header';
import { StatusCountBar } from '@/components/data/status-count-bar';
import { withParams } from '@/components/data/url';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/hiring/compliance';
import { DepartmentManager, DepartmentSelect } from '@/modules/hiring/components/department-tools';
import { listDepartments, listStaff } from '@/modules/hiring/staff-queries';
import { staffFiltersSchema } from '@/modules/hiring/staff-schemas';
import type { StaffRow } from '@/modules/hiring/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Staff' };

const STATUS: Record<StaffRow['status'], { label: string; className?: string }> = {
  active: { label: 'Active' },
  pending: {
    label: 'Offer pending',
    className: 'border-warning-border bg-warning text-warning-text',
  },
  ended: { label: 'Ended', className: 'text-muted-foreground' },
};

/** Tints cycle through the chart palette so each department keeps a recognisable marker. */
const MARKERS = ['bg-chart-1', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5', 'bg-chart-2'];

export default async function StaffPage({ searchParams }: PageProps<'/staff'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'employees.manage');
  const filters = staffFiltersSchema.parse(await searchParams);
  const [{ rows, counts }, departments] = await Promise.all([
    listStaff(ctx, filters),
    listDepartments(ctx),
  ]);

  const view = filters.view ?? 'current';
  const current = { q: filters.q, department: filters.department, view: filters.view };
  const filtering = Boolean(filters.q || filters.department);
  const items = (
    [
      ['current', 'Current', counts.active + counts.pending, 'primary'],
      ['active', 'Active', counts.active, 'info'],
      ['pending', 'Offer pending', counts.pending, 'chart-3'],
      ['ended', 'Ended', counts.ended, 'muted'],
    ] as const
  ).map(([key, label, count, tone]) => ({
    key,
    label,
    count,
    tone,
    active: view === key,
    href: withParams('/staff', current, { view: key === 'current' ? undefined : key }),
  }));

  const groups = [
    ...departments.map((department, index) => ({
      id: department.id,
      name: department.name,
      marker: MARKERS[index % MARKERS.length] ?? 'bg-chart-1',
      people: rows.filter((row) => row.departmentId === department.id),
    })),
    {
      id: 'none',
      name: departments.length > 0 ? 'Unassigned' : 'Everyone',
      marker: 'bg-muted-foreground/40',
      people: rows.filter(
        (row) => !row.departmentId || !departments.some((d) => d.id === row.departmentId),
      ),
    },
    // While searching or filtering, empty groups are noise; otherwise they show the structure.
  ].filter((group) => group.people.length > 0 || (!filtering && group.id !== 'none'));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Staff"
        description="Everyone you have hired or offered work to, grouped the way your business is organised."
        actions={
          <>
            <DepartmentManager departments={departments} />
            <Button asChild>
              <Link href="/hiring/new">
                <UserPlus aria-hidden /> Hire someone
              </Link>
            </Button>
          </>
        }
      />
      <StatusCountBar label="Staff by status" items={items} />
      <FilterBar
        filters={current}
        searchLabel="Search staff"
        selects={[
          {
            name: 'department',
            label: 'Department',
            allLabel: 'All departments',
            options: [
              ...departments.map((department) => ({
                value: department.id,
                label: department.name,
              })),
              { value: 'none', label: 'Unassigned' },
            ],
          },
        ]}
      />

      {rows.length === 0 && groups.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Users}
              title={filtering || view !== 'current' ? 'Nobody matches' : 'No staff yet'}
              description={
                filtering || view !== 'current'
                  ? 'Try a different search, department or status.'
                  : 'People appear here as soon as you start hiring them.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        groups.map((group) => (
          <section key={group.id} aria-label={group.name} className="rounded-xl border bg-card">
            <header className="flex items-center gap-2.5 border-b px-4 py-3">
              <span aria-hidden className={`size-2.5 rounded-full ${group.marker}`} />
              <h2 className="font-medium">{group.name}</h2>
              <span className="text-sm text-muted-foreground tabular-nums">
                {group.people.length}
              </span>
            </header>
            {group.people.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                Nobody here yet. Use the department picker beside a person to move them in.
              </p>
            ) : (
              <ul className="divide-y">
                {group.people.map((person) => (
                  <li
                    key={person.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                  >
                    <Link
                      href={`/staff/${person.id}`}
                      className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Avatar name={person.displayName} className="size-9 text-xs" />
                      <span className="min-w-0">
                        <span
                          className="block truncate font-medium underline-offset-4 group-hover:underline"
                          data-sensitive
                        >
                          {person.displayName}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {person.positionTitle ?? 'No position yet'}
                          {person.employmentType &&
                            ` · ${EMPLOYMENT_TYPE_LABELS[person.employmentType]}`}
                        </span>
                      </span>
                    </Link>
                    <Badge variant="outline" className={STATUS[person.status].className}>
                      {STATUS[person.status].label}
                    </Badge>
                    <DepartmentSelect
                      employeeId={person.id}
                      employeeName={person.displayName}
                      value={person.departmentId}
                      departments={departments}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
