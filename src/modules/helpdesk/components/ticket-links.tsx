'use client';

import { Link2, Unlink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { SearchSelect, type SearchOption } from '@/components/forms/search-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import {
  setTicketOpportunityAction,
  setTicketOrganizationAction,
} from '@/modules/helpdesk/actions';
import { searchOrganizationOptionsAction } from '@/modules/organizations/actions';

async function searchOrganizations(q: string): Promise<SearchOption[]> {
  const result = await searchOrganizationOptionsAction({ q });
  return result.ok ? result.data : [];
}

/**
 * The organization and opportunities a ticket concerns (ADR-069), so whoever works it sees the
 * customer's whole situation. Only what the person may see is listed or offered.
 */
export function TicketLinks({
  ticketId,
  organization,
  canPickOrganization,
  linked,
  candidates,
  canLinkOpportunities,
  labels,
}: {
  ticketId: string;
  organization: { id: string; name: string } | null;
  canPickOrganization: boolean;
  linked: { id: string; name: string; status: string }[];
  candidates: { id: string; name: string }[];
  canLinkOpportunities: boolean;
  labels: { organization: string; opportunity: string; opportunities: string };
}) {
  const { run, error, isPending } = useActionRunner();
  const [choice, setChoice] = useState('');
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">{labels.organization}</p>
        {canPickOrganization ? (
          <SearchSelect
            ariaLabel={labels.organization}
            value={organization?.id ?? ''}
            selectedLabel={organization?.name ?? null}
            placeholder={`Find an ${labels.organization.toLowerCase()}…`}
            clearable
            disabled={isPending}
            search={searchOrganizations}
            onChange={(value) =>
              run(() => setTicketOrganizationAction({ ticketId, organizationId: value || null }))
            }
          />
        ) : (
          <p>{organization?.name ?? 'None'}</p>
        )}
        {organization && (
          <Link
            href={`/organizations/${organization.id}`}
            className="w-fit text-primary underline-offset-4 hover:underline"
          >
            Open the {labels.organization.toLowerCase()}
          </Link>
        )}
      </div>
      {canLinkOpportunities && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">{labels.opportunities}</p>
          {linked.length === 0 && <p className="text-muted-foreground">None linked.</p>}
          <ul className="flex flex-col gap-1">
            {linked.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <Link
                  href={`/opportunities/${item.id}`}
                  className="truncate underline-offset-4 hover:underline"
                >
                  {item.name}
                  {item.status !== 'open' && (
                    <span className="text-muted-foreground"> · {item.status}</span>
                  )}
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Unlink ${item.name}`}
                  disabled={isPending}
                  onClick={() =>
                    run(() =>
                      setTicketOpportunityAction({
                        ticketId,
                        opportunityId: item.id,
                        linked: false,
                      }),
                    )
                  }
                >
                  <Unlink aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          {candidates.length > 0 && (
            <div className="flex items-center gap-1.5">
              <NativeSelect
                aria-label={`Link an ${labels.opportunity.toLowerCase()}`}
                className="h-8"
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">Link an open {labels.opportunity.toLowerCase()}…</option>
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                disabled={!choice || isPending}
                onClick={() =>
                  run(
                    () =>
                      setTicketOpportunityAction({ ticketId, opportunityId: choice, linked: true }),
                    () => setChoice(''),
                  )
                }
              >
                <Link2 aria-hidden /> Link
              </Button>
            </div>
          )}
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
