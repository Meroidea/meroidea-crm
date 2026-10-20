'use client';

import { Building2, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  linkContactOrganizationAction,
  unlinkContactOrganizationAction,
} from '@/modules/contacts/actions';
import type { ContactLink } from '@/modules/contacts/types';
import { SearchSelect, type SearchOption } from '@/components/forms/search-select';
import { searchOrganizationOptionsAction } from '@/modules/organizations/actions';

async function searchOrganizations(q: string): Promise<SearchOption[]> {
  const result = await searchOrganizationOptionsAction({ q });
  return result.ok ? result.data : [];
}

export function OrganizationLinks({
  contactId,
  links,
  canPick,
  canEdit,
  organizationLabel,
}: {
  contactId: string;
  links: ContactLink[];
  /** Whether the viewer may look organizations up (organizations.view). */
  canPick: boolean;
  canEdit: boolean;
  organizationLabel: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [organizationId, setOrganizationId] = useState('');
  const [relationship, setRelationship] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(result.error?.message ?? 'Something went wrong.');
        return;
      }
      setAdding(false);
      setOrganizationId('');
      setRelationship('');
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          Not linked to any {organizationLabel.toLowerCase()} yet.
        </p>
      )}
      {links.length > 0 && (
        <ul className="flex flex-col divide-y">
          {links.map((link) => (
            <li key={link.linkId} className="flex items-center gap-3 py-2">
              <Building2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/organizations/${link.organizationId}`}
                  className="block truncate font-medium hover:underline"
                >
                  {link.organizationName}
                </Link>
                <p className="text-xs text-muted-foreground capitalize">{link.relationship}</p>
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Unlink ${link.organizationName}`}
                  disabled={isPending}
                  onClick={() =>
                    run(() => unlinkContactOrganizationAction({ contactId, linkId: link.linkId }))
                  }
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && adding && (
        <form
          className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => linkContactOrganizationAction({ contactId, organizationId, relationship }));
          }}
        >
          <SearchSelect
            ariaLabel={organizationLabel}
            value={organizationId}
            onChange={(value) => setOrganizationId(value)}
            search={searchOrganizations}
            placeholder={`Search for an ${organizationLabel.toLowerCase()}…`}
            exclude={links.map((link) => link.organizationId)}
            disabled={!canPick}
          />
          <Input
            aria-label="Relationship"
            placeholder="Relationship, e.g. employee"
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
            maxLength={60}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !organizationId || !relationship.trim()}
            >
              Link
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}

      {canEdit && !adding && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAdding(true)}
          disabled={!canPick}
        >
          <Plus aria-hidden /> Link {organizationLabel.toLowerCase()}
        </Button>
      )}
      {canEdit && adding && (
        <p className="text-xs text-muted-foreground">
          Not there yet?{' '}
          <Link href="/organizations/new" className="underline">
            Create the {organizationLabel.toLowerCase()}
          </Link>{' '}
          first.
        </p>
      )}
    </div>
  );
}
