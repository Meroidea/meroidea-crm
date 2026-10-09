import { UserPlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatCalendarDate } from '@/lib/format';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/hiring/compliance';
import { listEmployees } from '@/modules/hiring/queries';
import type { ContractStatus } from '@/modules/hiring/types';
import { requirePermission, requireTenantContext } from '@/server/context';
import { isEncryptionConfigured } from '@/server/crypto';
import { isEmailConfigured } from '@/server/email';
import { isFairWorkConfigured } from '@/server/fair-work';

export const metadata: Metadata = { title: 'Hiring' };

const STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Draft',
  sent: 'Awaiting acceptance',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export default async function HiringPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'employees.manage');
  const people = await listEmployees(ctx);

  const gaps = [
    !isEmailConfigured() &&
      'Email sending is not set up: after sending a contract you will be given a link to pass on yourself.',
    !isFairWorkConfigured() &&
      'The Fair Work pay database is not connected: awards and minimum rates are typed in and not checked.',
    !isEncryptionConfigured() &&
      'No encryption key is set: new hires cannot enter tax, bank and super details yet.',
  ].filter((gap): gap is string => Boolean(gap));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Hiring"
        description="Offers in progress: send the contract and required statements, and track acceptance. Everyone you have hired is under Staff."
        actions={
          <Button asChild>
            <Link href="/hiring/new">
              <UserPlus aria-hidden /> Hire someone
            </Link>
          </Button>
        }
      />

      {gaps.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
          {gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      )}

      <Card>
        <CardContent>
          {people.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="Nobody hired here yet"
              description="Start with the person and the kind of work. You review the contract before anything is sent."
            />
          ) : (
            <ul className="divide-y">
              {people.map((person) => (
                <li key={person.id}>
                  <Link
                    href={`/staff/${person.id}?section=contract`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" data-sensitive>
                        {person.fullName}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {person.positionTitle ?? '—'}
                        {person.employmentType &&
                          ` · ${EMPLOYMENT_TYPE_LABELS[person.employmentType]}`}
                        {person.startDate && ` · starts ${formatCalendarDate(person.startDate)}`}
                      </span>
                    </span>
                    {person.contractStatus && (
                      <Badge variant={person.contractStatus === 'accepted' ? 'default' : 'outline'}>
                        {STATUS_LABELS[person.contractStatus]}
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
