import {
  CalendarOff,
  CircleDollarSign,
  Clock,
  FileSignature,
  Landmark,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Avatar } from '@/components/data/avatar';
import { Badge } from '@/components/ui/badge';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { checkOffer, EMPLOYMENT_TYPE_LABELS, isBelowMinimum } from '@/modules/hiring/compliance';
import { ContractActions } from '@/modules/hiring/components/contract-actions';
import { ContractBody } from '@/modules/hiring/components/contract-body';
import { PayrollCard } from '@/modules/hiring/components/payroll-card';
import { InviteMember } from '@/modules/access/components/team-tools';
import { listRoleOptions } from '@/modules/access/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { LoginLinkSelect } from '@/modules/payroll/components/payroll-tools';
import {
  EmployeeSwitcher,
  EndEmployment,
  ProfileForm,
} from '@/modules/hiring/components/profile-tools';
import { getEmployee } from '@/modules/hiring/queries';
import { employeeIdSchema } from '@/modules/hiring/schemas';
import { listDepartments, listStaff } from '@/modules/hiring/staff-queries';
import { profileParamsSchema, type ProfileSection } from '@/modules/hiring/staff-schemas';
import type { ContractStatus } from '@/modules/hiring/types';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Staff profile' };

const SECTIONS: { key: ProfileSection; label: string; icon: LucideIcon }[] = [
  { key: 'personal', label: 'Personal', icon: UserRound },
  { key: 'pay', label: 'Pay conditions', icon: CircleDollarSign },
  { key: 'contract', label: 'Contract', icon: FileSignature },
  { key: 'payroll', label: 'Payroll', icon: Landmark },
];

/** Shown greyed out so the shape of the profile is clear; they are not built yet. */
const LATER: { label: string; icon: LucideIcon }[] = [
  { label: 'Time & attendance', icon: Clock },
  { label: 'Leave & availability', icon: CalendarOff },
];

const CONTRACT_STATUS: Record<ContractStatus, string> = {
  draft: 'Draft — not sent',
  sent: 'Awaiting acceptance',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

const PERSON_STATUS = {
  active: { label: 'Active', className: undefined },
  pending: {
    label: 'Offer pending',
    className: 'border-warning-border bg-warning text-warning-text',
  },
  ended: { label: 'Ended', className: 'text-muted-foreground' },
} as const;

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-b py-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Warnings({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-warning-border">
      <p className="flex items-center gap-2 bg-warning-border/60 px-4 py-2 text-sm font-semibold text-warning-text">
        <TriangleAlert aria-hidden className="size-4" /> {title}
      </p>
      <ul className="list-disc space-y-1 bg-warning py-3 pr-4 pl-9 text-sm text-warning-text">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function StaffProfilePage({ params, searchParams }: PageProps<'/staff/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'employees.manage');
  const parsed = employeeIdSchema.safeParse(await params);
  const employee = parsed.success ? await getEmployee(ctx, parsed.data.id) : null;
  if (!employee) notFound();

  const section = profileParamsSchema.parse(await searchParams).section ?? 'personal';
  const canInvite = hasPermission(ctx, 'users.manage');
  const [departments, staff, members, roleOptions] = await Promise.all([
    listDepartments(ctx),
    listStaff(ctx, { view: 'all' }),
    listActiveMembers(ctx),
    canInvite ? listRoleOptions(ctx) : [],
  ]);
  const today = zonedToday(ctx.tenant.timezone);
  const { contract } = employee;
  const fullName = `${employee.firstName} ${employee.lastName}`;
  const displayName = employee.preferredName ?? fullName;
  const contractor = contract?.employmentType === 'contractor';
  const canSeePayroll = hasPermission(ctx, 'employees.view_sensitive');
  const status = PERSON_STATUS[employee.status];

  const payWarnings = contract
    ? [
        ...(isBelowMinimum(contract)
          ? [
              `The ${contract.payBasis === 'hourly' ? 'hourly rate' : 'salary'} is less than the minimum recorded for their classification (${formatMoney(contract.minimumRate, contract.currency)} an hour).${contract.belowMinimumReason ? ` Reason recorded: ${contract.belowMinimumReason}.` : ''}`,
            ]
          : []),
        ...checkOffer(ctx.tenant.country, contract).warnings,
      ]
    : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
            <Link href="/staff" className="underline-offset-4 hover:underline">
              Staff
            </Link>{' '}
            / <span data-sensitive>{displayName}</span>
          </nav>
          <div className="mt-3 flex items-center gap-4">
            <Avatar name={displayName} className="size-14 text-lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight" data-sensitive>
                {displayName}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={status.className}>
                  {status.label}
                </Badge>
                {contract && <Badge variant="secondary">{contract.positionTitle}</Badge>}
                {contract && (
                  <Badge variant="secondary">
                    {EMPLOYMENT_TYPE_LABELS[contract.employmentType]}
                  </Badge>
                )}
                <Badge variant="secondary">{employee.departmentName ?? 'Unassigned'}</Badge>
              </div>
            </div>
          </div>
        </div>
        <EmployeeSwitcher
          currentId={employee.id}
          section={section}
          people={staff.rows.map((row) => ({ id: row.id, name: row.displayName }))}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[15rem_1fr]">
        <nav
          aria-label="Profile sections"
          className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5 lg:sticky lg:top-20 lg:flex-col lg:self-start lg:overflow-visible"
        >
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              href={`/staff/${employee.id}?section=${key}`}
              aria-current={section === key ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors',
                section === key
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-foreground/80 hover:bg-muted',
              )}
            >
              <Icon aria-hidden className="size-4" /> {label}
            </Link>
          ))}
          {LATER.map(({ label, icon: Icon }) => (
            <span
              key={label}
              aria-disabled
              title="Not built yet"
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground/60"
            >
              <Icon aria-hidden className="size-4" /> {label}
              <span className="ml-auto hidden text-[10px] tracking-wide uppercase lg:inline">
                Later
              </span>
            </span>
          ))}
        </nav>

        <div className="min-w-0 rounded-xl border bg-card p-5 sm:p-6">
          {section === 'personal' && (
            <div className="flex flex-col gap-8">
              <ProfileForm
                // Remounted after a save so the form's baseline is the saved record.
                key={JSON.stringify(employee)}
                employee={employee}
                departments={departments}
                today={today}
              />
              <section className="border-t pt-6">
                <h2 className="font-medium">Employment</h2>
                <div className="mt-3">
                  <Facts
                    rows={[
                      ['Start date', contract ? formatCalendarDate(contract.startDate) : '—'],
                      [
                        'End date',
                        employee.endedOn
                          ? formatCalendarDate(employee.endedOn)
                          : contract?.endDate
                            ? `${formatCalendarDate(contract.endDate)} (contract ends)`
                            : 'None',
                      ],
                      ...(employee.endReason
                        ? [['Reason for leaving', employee.endReason] as [string, string]]
                        : []),
                    ]}
                  />
                </div>
                <div className="mt-5">
                  <LoginLinkSelect
                    employeeId={employee.id}
                    value={employee.userId}
                    members={members}
                  />
                </div>
                {!employee.userId && employee.status === 'active' && canInvite && (
                  <div className="mt-4">
                    <InviteMember
                      roles={roleOptions}
                      employee={{ id: employee.id, fullName, email: employee.email }}
                    />
                  </div>
                )}
                {employee.status === 'active' && (
                  <div className="mt-4 flex justify-end">
                    <EndEmployment employeeId={employee.id} name={displayName} today={today} />
                  </div>
                )}
              </section>
            </div>
          )}

          {section === 'pay' &&
            (contract ? (
              <div className="flex flex-col gap-5">
                <h2 className="text-lg font-semibold">Current pay conditions</h2>
                <Warnings title="Warnings" items={payWarnings} />
                <div className="grid overflow-hidden rounded-xl border sm:grid-cols-[14rem_1fr]">
                  <div className="bg-primary p-5 text-primary-foreground">
                    <p className="text-lg font-semibold">Employment details</p>
                    <p className="mt-1 text-sm text-primary-foreground/80">
                      From {formatCalendarDate(contract.startDate)} onwards
                    </p>
                  </div>
                  <dl className="grid gap-x-6 gap-y-2 bg-muted/50 p-5 text-sm sm:grid-cols-[9rem_1fr]">
                    {(
                      [
                        ['Position', contract.positionTitle],
                        ['Employment type', EMPLOYMENT_TYPE_LABELS[contract.employmentType]],
                        ...(contractor
                          ? [['ABN', contract.contractorAbn ?? '—']]
                          : [
                              [
                                'Award',
                                contract.awardName ?? contract.awardCode ?? 'None recorded',
                              ],
                              ['Classification', contract.classification ?? '—'],
                            ]),
                        [
                          'Hours',
                          contract.hoursPerWeek
                            ? `${contract.hoursPerWeek} a week`
                            : contract.employmentType === 'casual'
                              ? 'As offered'
                              : '—',
                        ],
                      ] as [string, string][]
                    ).map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="font-medium text-primary">{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border">
                    <p className="border-b bg-muted/50 px-4 py-2.5 text-sm font-medium">
                      {contractor ? 'Agreed fee' : 'Agreed rate'}
                    </p>
                    <p className="px-4 py-4">
                      <span className="text-3xl font-semibold tracking-tight tabular-nums">
                        {formatMoney(contract.payRate, contract.currency)}
                      </span>{' '}
                      <span className="text-muted-foreground">
                        {contract.payBasis === 'hourly' ? '/ hour' : '/ year'}
                      </span>
                    </p>
                  </div>
                  {!contractor && (
                    <div className="rounded-xl border">
                      <p className="border-b bg-muted/50 px-4 py-2.5 text-sm font-medium">
                        Minimum for the classification
                      </p>
                      <div className="px-4 py-4">
                        {contract.minimumRate ? (
                          <>
                            <p>
                              <span className="text-3xl font-semibold tracking-tight tabular-nums">
                                {formatMoney(contract.minimumRate, contract.currency)}
                              </span>{' '}
                              <span className="text-muted-foreground">/ hour</span>
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {contract.rateSource === 'fair_work'
                                ? 'From the Fair Work pay database when the contract was created.'
                                : 'Entered by hand when the contract was created; not verified.'}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Not checked for this contract.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Pay conditions come from the contract. To change them, issue a new contract.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No contract has been created for this person.
              </p>
            ))}

          {section === 'contract' &&
            (contract ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Contract</h2>
                  <Badge variant="outline">{CONTRACT_STATUS[contract.status]}</Badge>
                </div>
                {contract.status === 'draft' && (
                  <Warnings
                    title="Check before sending"
                    items={checkOffer(ctx.tenant.country, contract).warnings}
                  />
                )}
                {contract.status === 'draft' && (
                  <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    This wording is a starting template, not legal advice, and has not been reviewed
                    by a lawyer for your business. Have it checked before you rely on it.
                  </p>
                )}
                {contract.status === 'accepted' && (
                  <p className="text-sm">
                    Accepted by <span className="font-medium">{contract.acceptedName}</span> on{' '}
                    {formatDateTime(ctx, contract.acceptedAt)}.
                  </p>
                )}
                {contract.status === 'sent' && (
                  <p className="text-sm text-muted-foreground">
                    Sent {formatDateTime(ctx, contract.sentAt)}
                    {contract.viewedAt
                      ? `, opened ${formatDateTime(ctx, contract.viewedAt)}`
                      : ', not opened yet'}
                    . The link expires {formatDateTime(ctx, contract.tokenExpiresAt)}.
                  </p>
                )}
                {contract.statements.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Given with the contract: {contract.statements.map((s) => s.title).join(', ')}.
                  </p>
                )}
                <ContractActions
                  contractId={contract.id}
                  status={contract.status}
                  email={employee.email}
                />

                {employee.contracts.length > 1 && (
                  <section>
                    <h3 className="text-sm font-medium">History</h3>
                    <ul className="mt-2 divide-y rounded-lg border text-sm">
                      {employee.contracts.map((item) => (
                        <li
                          key={item.id}
                          className="flex flex-wrap justify-between gap-2 px-3 py-2"
                        >
                          <span>
                            {item.positionTitle} · {EMPLOYMENT_TYPE_LABELS[item.employmentType]}
                          </span>
                          <span className="text-muted-foreground">
                            {CONTRACT_STATUS[item.status]} · from{' '}
                            {formatCalendarDate(item.startDate)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="rounded-xl border bg-muted/30 p-5">
                  <p className="mb-4 text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                    {contract.status === 'draft' ? 'Preview' : 'Wording as sent'}
                  </p>
                  <ContractBody body={contract.body} />
                </section>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No contract has been created for this person.
              </p>
            ))}

          {section === 'payroll' && (
            <div className="flex flex-col gap-5">
              <h2 className="text-lg font-semibold">Payroll details</h2>
              {!canSeePayroll ? (
                <p className="text-sm text-muted-foreground">
                  You do not have access to these details.
                </p>
              ) : contractor ? (
                <p className="text-sm text-muted-foreground">
                  Contractors invoice for their work, so no tax, bank or super details are collected
                  here.
                </p>
              ) : employee.payroll ? (
                <>
                  <Warnings
                    title="Warnings"
                    items={
                      employee.payroll.hasTaxFileNumber ? [] : ['No tax file number was provided.']
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    Entered by {employee.firstName} on{' '}
                    {formatDateTime(ctx, employee.payroll.submittedAt)}.
                  </p>
                  <PayrollCard employeeId={employee.id} summary={employee.payroll} />
                </>
              ) : (
                <Warnings
                  title="Warnings"
                  items={[
                    contract?.status === 'accepted'
                      ? 'No tax, bank or super details yet. They enter these themselves through their offer link, straight after accepting.'
                      : 'No tax, bank or super details yet. They are collected once the contract is accepted.',
                  ]}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
